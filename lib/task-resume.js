/**
 * dsh-powerup — task-aware restart / shutdown helpers.
 *
 * Plain JS, dependency-free so the offline suites can exercise it. The Host
 * passes live services in at call time; nothing here imports `@deepseek-ai/*`
 * at module load.
 *
 * Two responsibilities:
 *   1. Snapshot unfinished work (live running Agents plus running background
 *      jobs) so a restart/close request can refuse the normal path.
 *   2. Persist a small "pending resume" queue to disk when a forced restart /
 *      close is requested with `resume: true`, and replay it on the next
 *      successful application startup by sending each session a continuation
 *      prompt through `sessionController.prompt` (which resumes cold sessions).
 */

/** Central store file name, next to prompts.json / mask-rules.json. */
export const TASK_RESUME_FILE = 'task-resume.json';

/** Default continuation prompt; the user sees it as a real user message. */
export const DEFAULT_RESUME_PROMPT = '继续之前未完成的任务。';

/** Max number of records kept in the queue, so a corrupt file cannot explode startup. */
const MAX_RECORDS = 500;

/** Max characters kept for a session title in the queue. */
const TITLE_LIMIT = 200;

/**
 * Clamp arbitrary text to a single line of bounded length (control chars gone).
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string}
 */
export function cleanText(value, limit = TITLE_LIMIT) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Collect unfinished work from live Host services.
 * @param {{agents?: any, jobs?: any}} services
 * @returns {Array<{id: string, title: string, kind: 'agent'|'job', running: boolean}>}
 */
export function collectRunningTasks(services = {}) {
  const tasks = [];
  const agents = services.agents;
  try {
    const list = typeof agents?.list === 'function' ? agents.list() : [];
    for (const agent of Array.isArray(list) ? list : []) {
      if (agent === null || typeof agent !== 'object') continue;
      // Cold sessions are never `running`; only the live driver knows.
      if (agent.status !== 'running') continue;
      const id = typeof agent.id === 'string' ? agent.id : agent.session?.id;
      if (typeof id !== 'string' || id === '') continue;
      tasks.push({
        id,
        title: taskTitle(agent),
        kind: 'agent',
        running: true,
      });
    }
  } catch {
    /* A service that is still warming up contributes no tasks. */
  }
  const jobs = services.jobs;
  try {
    const list = typeof jobs?.list === 'function' ? jobs.list() : [];
    for (const job of Array.isArray(list) ? list : []) {
      if (job === null || typeof job !== 'object') continue;
      if (job.status !== 'running') continue;
      const id = typeof job.id === 'string' ? job.id : '';
      if (id === '') continue;
      // Avoid duplicating the same work when a job view carries its owner.
      if (tasks.some((task) => task.id === id)) continue;
      tasks.push({
        id,
        title: cleanText(job.title ?? job.kind ?? 'background job', TITLE_LIMIT),
        kind: 'job',
        running: true,
      });
    }
  } catch {
    /* Optional service. */
  }
  return tasks.slice(0, MAX_RECORDS);
}

/** Best-effort human label for one live Agent. */
function taskTitle(agent) {
  try {
    const title = agent.session?.title?.();
    if (typeof title === 'string' && title.trim() !== '') return cleanText(title);
  } catch {
    /* fall through */
  }
  return 'session';
}

/**
 * Read the pending-resume queue from a JSON file.
 * @param {string} filePath
 * @returns {Array<object>}
 */
export function readResumeQueue(filePath, readFile) {
  try {
    const parsed = JSON.parse(readFile(filePath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record) => record !== null && typeof record === 'object'
      && typeof record.sessionId === 'string' && record.sessionId !== '').slice(0, MAX_RECORDS);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    return [];
  }
}

/**
 * Build one resume record.
 * @param {{sessionId: string, title?: string, prompt?: string, forcedAt?: number}} input
 * @returns {{sessionId: string, requestId: string, title: string, prompt: string, createdAt: number}}
 */
export function createResumeRecord(input, randomUUID) {
  const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : '';
  if (sessionId === '') throw new TypeError('sessionId is required');
  const prompt = cleanText(input.prompt, 4000) || DEFAULT_RESUME_PROMPT;
  return {
    sessionId,
    requestId: typeof randomUUID === 'function' ? randomUUID() : `resume-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: cleanText(input.title),
    prompt,
    createdAt: Number.isFinite(input.forcedAt) ? input.forcedAt : Date.now(),
  };
}

/**
 * Append resume records to the queue, deduplicated by sessionId.
 * @param {Array<object>} queue
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export function mergeResumeQueue(queue, records) {
  const merged = Array.isArray(queue) ? queue.slice() : [];
  const seen = new Set(merged.map((record) => record.sessionId));
  for (const record of Array.isArray(records) ? records : []) {
    if (record === null || typeof record !== 'object') continue;
    if (typeof record.sessionId !== 'string' || record.sessionId === '') continue;
    if (seen.has(record.sessionId)) continue;
    seen.add(record.sessionId);
    merged.push(record);
  }
  return merged.slice(-MAX_RECORDS);
}

/**
 * Cancel each running live Agent and kill each running job. Best effort: the
 * restart proceeds even if one cancellation fails.
 * @param {{agents?: any, jobs?: any}} services
 * @param {string} [reason]
 * @returns {{cancelledAgents: string[], killedJobs: string[], errors: string[]}}
 */
export function stopUnfinishedTasks(services = {}, reason = 'dsh-powerup forced app action') {
  const result = { cancelledAgents: [], killedJobs: [], errors: [] };
  const agents = services.agents;
  try {
    const list = typeof agents?.list === 'function' ? agents.list() : [];
    for (const agent of Array.isArray(list) ? list : []) {
      if (agent?.status !== 'running') continue;
      const id = typeof agent.id === 'string' ? agent.id : agent.session?.id;
      try {
        if (typeof agent.cancel !== 'function') continue;
        agent.cancel({ kind: 'user', reason }, { keepInbox: false });
        if (typeof id === 'string' && id !== '') result.cancelledAgents.push(id);
      } catch (error) {
        result.errors.push(`agent ${id ?? '?'}: ${String(error?.message ?? error)}`);
      }
    }
  } catch (error) {
    result.errors.push(`agents: ${String(error?.message ?? error)}`);
  }
  const jobs = services.jobs;
  try {
    const list = typeof jobs?.list === 'function' ? jobs.list() : [];
    for (const job of Array.isArray(list) ? list : []) {
      if (job?.status !== 'running') continue;
      const id = typeof job.id === 'string' ? job.id : '';
      if (id === '') continue;
      try {
        const owner = typeof job.sessionId === 'string' ? job.sessionId : typeof job.owner === 'string' ? job.owner : undefined;
        jobs.kill(id, owner, reason);
        result.killedJobs.push(id);
      } catch (error) {
        result.errors.push(`job ${id}: ${String(error?.message ?? error)}`);
      }
    }
  } catch (error) {
    result.errors.push(`jobs: ${String(error?.message ?? error)}`);
  }
  return result;
}

/**
 * Replay pending resumes once startup is committed. Each prompt is sent
 * through `sessionController.prompt`, which resumes a cold session internally.
 * A record is removed from the queue only after its prompt is accepted.
 *
 * @param {{sessionController?: any, readFile: Function, writeFile: Function, mkdir: Function, dirname: Function, randomUUID: Function, logger?: Function}} deps
 * @returns {Promise<{delivered: string[], failed: Array<{sessionId: string, error: string}>, remaining: number}>}
 */
export async function replayPendingResumes(deps) {
  const { readFile, writeFile, mkdir, dirname, randomUUID } = deps;
  const filePath = deps.filePath;
  const queue = readResumeQueue(filePath, readFile);
  if (queue.length === 0) return { delivered: [], failed: [], remaining: 0 };

  const result = { delivered: [], failed: [], remaining: 0 };
  const pending = [];
  const controller = deps.sessionController;

  for (const record of queue) {
    if (controller === null || typeof controller?.prompt !== 'function') {
      pending.push(record);
      continue;
    }
    const signal = deps.signal ?? new AbortController().signal;
    try {
      await controller.prompt({
        requestId: randomUUID(),
        sessionId: record.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: record.prompt || DEFAULT_RESUME_PROMPT }],
      }, signal);
      result.delivered.push(record.sessionId);
    } catch (error) {
      result.failed.push({ sessionId: record.sessionId, error: String(error?.message ?? error) });
      pending.push(record);
      if (typeof deps.logger === 'function') {
        deps.logger(`[dsh-powerup] resume prompt failed for ${record.sessionId}: ${String(error?.message ?? error)}`);
      }
    }
  }

  result.remaining = pending.length;
  try {
    mkdir(dirname(filePath), { recursive: true });
    writeFile(filePath, JSON.stringify(pending, null, 2) + '\n', 'utf8');
  } catch (error) {
    if (typeof deps.logger === 'function') {
      deps.logger(`[dsh-powerup] could not persist resume queue: ${String(error?.message ?? error)}`);
    }
  }
  return result;
}
