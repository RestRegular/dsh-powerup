/**
 * dsh-powerup — a plain model question call, without an Agent.
 *
 * This is deliberately NOT an Agent turn: it uses `ctx.llm.prepareCall` +
 * `call.stream` directly, so no systemPrompt sections, tools, skills, memory or
 * background job machinery are involved. The caller supplies the text (and
 * optionally text extracted from files); the answer is streamed back as plain
 * text and is never written into any session log.
 *
 * Pure JS, no DSH imports at module load, so the offline suites can exercise it.
 */

/** Default instruction: keep the answer focused and tool-free. */
export const DIRECT_ASK_SYSTEM_PROMPT = [
  'You are answering a single, direct question for the user.',
  'Answer concisely and accurately in the same language as the question.',
  'You have no tools, no skills, and no agent loop — do not pretend to run commands, browse, or modify files.',
  'If the user included file excerpts, treat them as reference text only.',
].join('\n');

/** Upper bound for the question text sent to the model. */
export const DIRECT_ASK_INPUT_LIMIT = 24_000;

/** Default output cap for a one-shot answer. */
export const DIRECT_ASK_MAX_TOKENS = 2048;

/** Max characters of the first question used to generate a title. */
export const TITLE_INPUT_LIMIT = 800;
/** Hard cap for title generation tokens. */
export const TITLE_MAX_TOKENS = 64;
/** Max characters kept for a generated/edited title. */
export const TITLE_LIMIT = 60;

/**
 * Generate a short conversation title from its first message, with a strict
 * token cap. Returns a plain string (never throws to the caller UI).
 */
export async function generateTitle({ llm, route, firstMessage, signal }) {
  if (llm === null || typeof llm !== 'object' || typeof llm.prepareCall !== 'function') {
    throw new DirectAskError('LLM_UNAVAILABLE', 'the llm service is unavailable');
  }
  if (route === null || typeof route !== 'object' || typeof route.provider !== 'string' || typeof route.model !== 'string') {
    throw new DirectAskError('NO_ROUTE', 'no provider/model route is available');
  }
  const text = cleanAskText(firstMessage, TITLE_INPUT_LIMIT);
  if (text === '') throw new DirectAskError('EMPTY', 'the first message is empty');
  const config = {
    provider: route.provider,
    model: route.model,
    maxTokens: TITLE_MAX_TOKENS,
  };
  const call = await llm.prepareCall(config, signal);
  const options = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: `给下面这条用户消息起一个简短标题（不超过 ${TITLE_LIMIT} 个字符），只输出标题本身，不要引号或解释：\n\n${text}` }] }],
    system: 'You write very short conversation titles. Output only the title, no quotes, no punctuation wrapper.',
    purpose: 'powerup-direct-ask-title',
    ...(signal === undefined ? {} : { signal }),
  };
  let raw = '';
  let finish;
  for await (const chunk of call.stream(options)) {
    if (signal?.aborted) throw new DirectAskError('ABORTED', 'title generation cancelled');
    if (chunk === null || typeof chunk !== 'object') continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text;
    else if (chunk.type === 'finish') finish = chunk.reason;
  }
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    throw new DirectAskError('LLM_FAILED', `the title call ${finish.kind ?? 'failed'}`);
  }
  // Normalize: strip quotes, collapse whitespace, cap length.
  const title = raw.trim().replace(/^["'「『]|["'」』]$/gu, '').replace(/\s+/gu, ' ').trim().slice(0, TITLE_LIMIT);
  return { title: title || text.slice(0, TITLE_LIMIT), finish };
}

/** Error with a stable machine code. */
export class DirectAskError extends Error {
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`, options);
    this.name = 'DirectAskError';
    this.code = code;
  }
}

/** Bound and clean arbitrary input text. */
export function cleanAskText(value, limit = DIRECT_ASK_INPUT_LIMIT) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/gu, '').trim().slice(0, limit);
}

/**
 * Build the user message body from a question plus optional context blocks
 * (e.g. file excerpts the user chose to attach).
 * @param {{question: string, context?: Array<{name?: string, text: string}>}} input
 * @returns {string}
 */
export function buildAskPrompt(input = {}) {
  const question = cleanAskText(input.question);
  const blocks = Array.isArray(input.context) ? input.context : [];
  const parts = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    const text = cleanAskText(block.text, 12_000);
    if (text === '') continue;
    const name = typeof block.name === 'string' && block.name.trim() !== ''
      ? block.name.trim().slice(0, 200)
      : 'attachment';
    parts.push(`--- file: ${name} ---\n${text}`);
  }
  if (parts.length > 0) {
    return `${parts.join('\n\n')}\n\n--- question ---\n${question}`;
  }
  return question;
}

/**
 * Perform one direct model answer. No session log writes, no Agent activation.
 *
 * @param {object} options
 * @param {object} options.llm Host `ctx.llm` service
 * @param {{provider: string, model: string, reasoningEffort?: string}} options.route
 * @param {string} options.prompt assembled prompt from {@link buildAskPrompt}
 * @param {Array<{role:'user'|'assistant', text:string}>} [options.history] prior turns for continuous Q&A
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{text: string, finish: string|undefined}>}
 */
export async function directAsk({ llm, route, prompt, history, signal, maxTokens }) {
  if (llm === null || typeof llm !== 'object' || typeof llm.prepareCall !== 'function') {
    throw new DirectAskError('LLM_UNAVAILABLE', 'the llm service is unavailable');
  }
  if (route === null || typeof route !== 'object' || typeof route.provider !== 'string' || typeof route.model !== 'string') {
    throw new DirectAskError('NO_ROUTE', 'no provider/model route is available');
  }
  const question = cleanAskText(prompt);
  if (question === '') throw new DirectAskError('EMPTY', 'the question is empty');
  const config = {
    provider: route.provider,
    model: route.model,
    ...(typeof route.reasoningEffort === 'string' ? { reasoningEffort: route.reasoningEffort } : {}),
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : DIRECT_ASK_MAX_TOKENS,
  };
  const call = await llm.prepareCall(config, signal);
  // Flatten the whole conversation into ONE user message. DSH's message
  // pipeline requires a full `id`/`role`/`content`/`source` shape on every
  // message; hand-built assistant messages (without a valid model source) are
  // rejected by the adapter on the second turn ("LLM_FAILED"). Sending a single
  // user message with the prior turns as text keeps every call stateless and
  // robust — the same approach the proven progress side-call uses.
  const sections = [];
  for (const turn of Array.isArray(history) ? history : []) {
    if (turn === null || typeof turn !== 'object') continue;
    const label = turn.role === 'assistant' ? 'Assistant' : turn.role === 'user' ? 'User' : null;
    if (label === null) continue;
    const text = cleanAskText(turn.text);
    if (text === '') continue;
    sections.push(`${label}: ${text}`);
  }
  const combined = sections.length > 0
    ? `${sections.join('\n\n')}\n\nUser: ${question}`
    : question;
  const options = {
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: combined }] }],
    system: DIRECT_ASK_SYSTEM_PROMPT,
    purpose: 'powerup-direct-ask',
    ...(signal === undefined ? {} : { signal }),
  };
  let text = '';
  let finish;
  for await (const chunk of call.stream(options)) {
    if (signal?.aborted) throw new DirectAskError('ABORTED', 'the direct ask was cancelled');
    if (chunk === null || typeof chunk !== 'object') continue;
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    else if (chunk.type === 'finish') finish = chunk.reason;
  }
  if (finish?.kind === 'error' || finish?.kind === 'aborted') {
    throw new DirectAskError('LLM_FAILED', `the model call ${finish.kind ?? 'failed'}`);
  }
  if (finish?.kind === 'max-tokens') {
    throw new DirectAskError('TRUNCATED', 'the model hit its token limit before finishing');
  }
  return { text, finish };
}
