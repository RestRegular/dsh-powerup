/**
 * Power-Up task-progress side call.
 *
 * A session's progress is summarized by a SEPARATE model call that never enters
 * the conversation log and never touches the running agent's turn or abort
 * signal. The Host reads the session's recent surface messages, resolves the
 * same provider/model the session last used, asks the model for a structured
 * JSON progress report, and caches the latest report in memory for the Client
 * panel to poll.
 *
 * Everything in this module is plain JS so it can be exercised by the offline
 * tests without a DSH installation. It never imports `@deepseek-ai/*` at module
 * load; the Host passes the `llm` service in at call time.
 */

/** Default cooperative deadline for one side call. */
export const PROGRESS_TIMEOUT_MS = 45_000;

/** Upper bound on characters of session text fed into the side call. */
export const PROGRESS_CONTEXT_LIMIT = 24_000;

/** Max output tokens for the summary. */
export const PROGRESS_MAX_TOKENS = 900;

/** Number of recent surface messages considered. */
export const PROGRESS_MESSAGE_LIMIT = 60;

/** Cache TTL for a finished report, in milliseconds. */
export const PROGRESS_CACHE_TTL_MS = 5 * 60_000;

/** Report is considered stale for the overlay after this long. */
export const PROGRESS_STALE_MS = 60_000;

/** The JSON schema modes the model may choose from. */
export const PROGRESS_MODES = ['checklist', 'phases', 'milestones', 'tree'];

/**
 * The single instruction sent to the side model. It deliberately lets the
 * model choose a structure that fits the task instead of forcing one shape.
 */
export const PROGRESS_SYSTEM_PROMPT = [
  'You are a task-progress reporter embedded in DeepSeek Harness.',
  'You will be given a compact transcript of a work session that is still in progress.',
  'Produce ONE JSON object and nothing else — no prose, no markdown fences.',
  'Pick the structure that best fits the task and set "mode" accordingly:',
  '  - "checklist": a to-do list with discrete steps. Use "steps": [{"title","status","detail"}], status one of pending|in-progress|done|blocked.',
  '  - "phases": ordered work phases. Use "phases": [{"name","status","detail","steps"?:[{"title","status"}]}].',
  '  - "milestones": goal-oriented milestones. Use "milestones": [{"name","status","detail","criteria"?}].',
  '  - "tree": hierarchical subtasks (e.g. subagents or nested work). Use "root": {"title","status","children"?:[...]}.',
  'Every mode also requires: "title" (short), "summary" (1-2 sentences), "percent" (integer 0-100), "blockers" (string array).',
  'You MAY add a "display" field to show extra information the user will see directly in the panel.',
  '"display" is an array of blocks. Each block is either',
  '  {"kind":"text","text":"..."}  (plain text, line breaks preserved), or',
  '  {"kind":"kv","items":[{"label":"...","value":"..."}]}, or',
  '  {"kind":"callout","tone":"info"|"warn"|"success","text":"..."}, or',
  '  {"kind":"bars","items":[{"label":"...","value":0-100}]}, or',
  '  {"kind":"code","language":"...","text":"..."}.',
  'Keep "display" concise and genuinely useful; omit it when the structured fields already say everything.',
  'Be honest: if work has not started, say so; never invent progress. Base the report only on the transcript.',
].join('\n');

/** Error with a stable machine code. */
export class ProgressError extends Error {
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`);
    this.name = 'ProgressError';
    this.code = code;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Accept either a live Session or a SessionSurfaceSnapshot and return a compact
 * transcript of recent user/assistant text (tool names noted, arguments dropped).
 * @param {object} session
 * @param {{provider: string, model: string, maxTokens?: number}} route
 * @returns {string}
 */
export function buildProgressContext(session, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : PROGRESS_CONTEXT_LIMIT;
  const messageLimit = Number.isFinite(options.messageLimit) ? options.messageLimit : PROGRESS_MESSAGE_LIMIT;
  const events = Array.isArray(session?.events) ? session.events : [];
  const chunks = [];
  let used = 0;
  const selected = events.length > messageLimit ? events.slice(-messageLimit) : events;
  for (const event of selected) {
    if (event === null || typeof event !== 'object') continue;
    let role = '';
    let message = null;
    if (event.type === 'user/message') {
      role = 'User';
      message = event.data;
    } else if (event.type === 'assistant/message') {
      role = 'Assistant';
      message = event.data?.message;
    } else if (event.role === 'user' || event.role === 'assistant') {
      role = event.role === 'user' ? 'User' : 'Assistant';
      message = event;
    }
    if (message === null || typeof message !== 'object') continue;
    const parts = [];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text.trim());
      } else if (block.type === 'tool-call') {
        const name = typeof block.name === 'string' ? block.name : 'tool';
        parts.push(`[called ${name}]`);
      } else if (block.type === 'tool-result') {
        parts.push('[tool result]');
      }
    }
    const text = parts.filter(Boolean).join('\n').trim();
    if (text === '') continue;
    const line = `${role}: ${text}`;
    if (used + line.length > limit) break;
    chunks.push(line);
    used += line.length;
  }
  return chunks.join('\n\n').slice(0, limit);
}

/**
 * Strip accidental markdown fences and parse the model text as one JSON object.
 * @param {string} text
 * @returns {object}
 */
export function parseProgressReport(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ProgressError('EMPTY', 'the model returned an empty progress report');
  }
  let cleaned = text.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fence !== null) cleaned = fence[1].trim();
  let value;
  try {
    value = JSON.parse(cleaned);
  } catch (error) {
    throw new ProgressError('INVALID_JSON', 'the model did not return valid JSON', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProgressError('INVALID_SHAPE', 'the progress report must be a JSON object');
  }
  return normalizeProgressReport(value);
}

/**
 * Normalize/validate a parsed report into a stable shape for the UI. Unknown
 * fields are dropped, missing fields get safe defaults, and the mode is checked
 * against the declared set.
 * @param {object} value
 * @returns {object}
 */
export function normalizeProgressReport(value) {
  const mode = PROGRESS_MODES.includes(value?.mode) ? value.mode : 'checklist';
  const statusOf = (x) => ['pending', 'in-progress', 'done', 'blocked'].includes(x) ? x : 'pending';
  const text = (x, max = 4000) => typeof x === 'string' ? x.trim().slice(0, max) : '';
  const list = (x) => Array.isArray(x) ? x.filter((v) => v !== null && typeof v === 'object') : [];
  const listStrings = (x) => Array.isArray(x) ? x : [];

  const steps = list(value.steps).map((s) => ({
    title: text(s.title, 240),
    status: statusOf(s.status),
    detail: text(s.detail, 1200),
  })).filter((s) => s.title !== '');
  const phases = list(value.phases).map((p) => ({
    name: text(p.name, 240),
    status: statusOf(p.status),
    detail: text(p.detail, 1200),
    steps: list(p.steps).map((s) => ({
      title: text(s.title, 240),
      status: statusOf(s.status),
    })).filter((s) => s.title !== ''),
  })).filter((p) => p.name !== '');
  const milestones = list(value.milestones).map((m) => ({
    name: text(m.name, 240),
    status: statusOf(m.status),
    detail: text(m.detail, 1200),
    criteria: text(m.criteria, 600),
  })).filter((m) => m.name !== '');
  const normalizeNode = (node, depth = 0) => {
    if (depth > 6 || node === null || typeof node !== 'object') return null;
    return {
      title: text(node.title ?? node.name, 240),
      status: statusOf(node.status),
      detail: text(node.detail, 800),
      children: list(node.children).map((c) => normalizeNode(c, depth + 1)).filter(Boolean),
    };
  };
  const tree = normalizeNode(value.root) ?? normalizeNode(value.tree) ?? null;

  const display = list(value.display).map((block) => {
    if (block.kind === 'text') return { kind: 'text', text: text(block.text, 8000) };
    if (block.kind === 'kv') {
      return {
        kind: 'kv',
        items: list(block.items).map((item) => ({
          label: text(item.label, 160),
          value: text(item.value, 1200),
        })).filter((item) => item.label !== ''),
      };
    }
    if (block.kind === 'callout') {
      return {
        kind: 'callout',
        tone: ['info', 'warn', 'success'].includes(block.tone) ? block.tone : 'info',
        text: text(block.text, 2000),
      };
    }
    if (block.kind === 'bars') {
      return {
        kind: 'bars',
        items: list(block.items).map((item) => ({
          label: text(item.label, 160),
          value: Math.max(0, Math.min(100, Math.round(Number(item.value) || 0))),
        })).filter((item) => item.label !== ''),
      };
    }
    if (block.kind === 'code') {
      return { kind: 'code', language: text(block.language, 40), text: text(block.text, 8000) };
    }
    return null;
  }).filter(Boolean);

  const percentRaw = Number(value.percent);
  return {
    mode,
    title: text(value.title, 240) || 'Task progress',
    summary: text(value.summary, 2400),
    percent: Number.isFinite(percentRaw) ? Math.max(0, Math.min(100, Math.round(percentRaw))) : 0,
    blockers: listStrings(value.blockers).map((b) => text(b, 600)).filter(Boolean),
    steps,
    phases,
    milestones,
    tree,
    display,
    updatedAt: Date.now(),
  };
}

/**
 * Assemble accumulated text chunks and check the terminal finish reason.
 * @param {string} text
 * @param {{kind: string} | undefined} finish
 * @returns {string}
 */
export function finishReport(text, finish) {
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    throw new ProgressError('LLM_FAILED', `the side model call ${finish.kind ?? 'failed'}`);
  }
  if (finish?.kind === 'max-tokens') {
    throw new ProgressError('TRUNCATED', 'the side model hit its token limit before finishing');
  }
  return text;
}

/**
 * Perform the side call. The caller supplies the `llm` service, the route, the
 * transcript and its own AbortSignal; this function writes nothing durable.
 *
 * @param {object} options
 * @param {object} options.llm the Host `ctx.llm` service
 * @param {{provider: string, model: string, reasoningEffort?: string, maxTokens?: number}} options.route
 * @param {string} options.context compact transcript
 * @param {string} [options.requirements] extra user-authored requirements appended to the system prompt
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} a normalized progress report (with `raw` = original model text)
 */
export async function generateProgress({ llm, route, context, requirements, signal }) {
  if (llm === null || typeof llm !== 'object' || typeof llm.prepareCall !== 'function') {
    throw new ProgressError('LLM_UNAVAILABLE', 'the llm service is unavailable');
  }
  if (route === null || typeof route !== 'object' || typeof route.provider !== 'string' || typeof route.model !== 'string') {
    throw new ProgressError('NO_ROUTE', 'no provider/model route is available for this session');
  }
  const config = {
    provider: route.provider,
    model: route.model,
    ...(typeof route.reasoningEffort === 'string' ? { reasoningEffort: route.reasoningEffort } : {}),
    maxTokens: Number.isFinite(route.maxTokens) ? route.maxTokens : PROGRESS_MAX_TOKENS,
  };
  const call = await llm.prepareCall(config, signal);
  const prompt = [
    'Session transcript (may be truncated):',
    '---',
    context || '(no recent user or assistant text)',
    '---',
    'Return only the JSON progress object described in your instructions.',
  ].join('\n');
  const extra = typeof requirements === 'string' && requirements.trim() !== ''
    ? `\n\nAdditional requirements from the user (follow them strictly):\n${requirements.trim()}`
    : '';
  const options = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    system: PROGRESS_SYSTEM_PROMPT + extra,
    purpose: 'task-progress',
    ...(signal === undefined ? {} : { signal }),
  };
  let text = '';
  let finish;
  for await (const chunk of call.stream(options)) {
    if (signal?.aborted) throw new ProgressError('ABORTED', 'the progress call was cancelled');
    if (chunk === null || typeof chunk !== 'object') continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text;
    } else if (chunk.type === 'finish') {
      finish = chunk.reason;
    }
  }
  const cleanedText = finishReport(text, finish);
  const report = parseProgressReport(cleanedText);
  // Keep the exact model output so the user can inspect it later. History is a
  // user-produced artifact and must never be silently discarded.
  report.raw = cleanedText;
  return report;
}
