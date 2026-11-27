/**
 * Per-session state machine for Power-Up's task-progress side call.
 *
 * The manager is deliberately tiny and dependency-free: the Host injects the
 * `llm`, `sessionQuery` and a route resolver, and the Client drives it through
 * three verbs (start / poll / cancel). Nothing here writes to a session log.
 */

import {
  PROGRESS_CACHE_TTL_MS,
  PROGRESS_STALE_MS,
  ProgressError,
  buildProgressContext,
  generateProgress,
} from './progress-tool.js';

/** Cooperative deadline wrapper for one generation. */
function deadline(signal, ms) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new ProgressError('TIMEOUT', 'the progress call timed out')), ms);
  timer.unref?.();
  const dispose = () => {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  };
  return { signal: controller.signal, dispose };
}

/**
 * @param {{ getLlm: () => any, getSessionQuery: () => any, resolveRoute: (sessionId: string) => any, timeoutMs?: number }} options
 */
export function createProgressManager(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('createProgressManager requires options');
  const getLlm = options.getLlm;
  const getSessionQuery = options.getSessionQuery;
  const resolveRoute = options.resolveRoute;
  if (typeof getLlm !== 'function' || typeof getSessionQuery !== 'function' || typeof resolveRoute !== 'function') {
    throw new TypeError('createProgressManager needs getLlm, getSessionQuery and resolveRoute');
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 45_000;

  /** @type {Map<string, {status:string, startedAt:number, updatedAt:number, report?:object, error?:string, controller?:AbortController}>} */
  const states = new Map();

  function stateOf(sessionId) {
    return states.get(sessionId) ?? { status: 'idle', startedAt: 0, updatedAt: Date.now() };
  }

  /** Return a client-safe view of a session's state. */
  function view(sessionId) {
    const state = stateOf(sessionId);
    const result = {
      status: state.status,
      updatedAt: state.updatedAt,
      startedAt: state.startedAt,
      stale: false,
    };
    if (state.report !== undefined) result.report = state.report;
    if (state.error !== undefined) result.error = state.error;
    if (state.status === 'done') result.stale = Date.now() - state.updatedAt > PROGRESS_STALE_MS;
    if (state.status === 'idle' && Date.now() - state.updatedAt > PROGRESS_CACHE_TTL_MS) {
      result.status = 'expired';
    }
    return result;
  }

  function cancel(sessionId) {
    const state = states.get(sessionId);
    if (state?.controller !== undefined) {
      try { state.controller.abort(new ProgressError('CANCELLED', 'the progress call was cancelled')); } catch { /* ignore */ }
    }
    states.set(sessionId, { ...state, status: 'idle', controller: undefined, updatedAt: Date.now() });
    return view(sessionId);
  }

  function start(sessionId) {
    // Cancel any previous in-flight call before starting a fresh one.
    const previous = states.get(sessionId);
    if (previous?.controller !== undefined) {
      try { previous.controller.abort(new ProgressError('SUPERSEDED', 'a newer progress call replaced this one')); } catch { /* ignore */ }
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    states.set(sessionId, { status: 'running', startedAt, updatedAt: startedAt, controller });

    const scope = deadline(controller.signal, timeoutMs);
    (async () => {
      try {
        const llm = getLlm();
        const query = getSessionQuery();
        const route = resolveRoute(sessionId);
        if (query === null || typeof query !== 'object') {
          throw new ProgressError('QUERY_UNAVAILABLE', 'the sessionQuery service is unavailable');
        }
        const [config, surface] = await Promise.all([
          typeof query.inspectSession === 'function'
            ? query.inspectSession(sessionId, (session) => session?.requestHeader?.()?.config ?? undefined, scope.signal)
            : Promise.resolve(undefined),
          typeof query.readSurface === 'function'
            ? query.readSurface(sessionId)
            : Promise.resolve({ events: [] }),
        ]);
        const resolved = (config !== undefined && typeof config?.provider === 'string' && typeof config?.model === 'string')
          ? config
          : (typeof route === 'object' && route !== null ? route : undefined);
        if (resolved === undefined || typeof resolved.provider !== 'string' || typeof resolved.model !== 'string') {
          throw new ProgressError('NO_ROUTE', 'could not resolve a provider/model for this session');
        }
        const context = buildProgressContext(surface, {});
        const report = await generateProgress({ llm, route: resolved, context, signal: scope.signal });
        const current = states.get(sessionId);
        if (current?.controller !== controller) return; // superseded by a newer call
        states.set(sessionId, {
          status: 'done',
          startedAt,
          updatedAt: Date.now(),
          report,
        });
      } catch (error) {
        const current = states.get(sessionId);
        if (current?.controller !== controller) return;
        if (scope.signal.aborted && !(error instanceof ProgressError)) return; // cancelled silently
        states.set(sessionId, {
          status: 'error',
          startedAt,
          updatedAt: Date.now(),
          error: String(error?.message ?? error),
        });
      } finally {
        scope.dispose();
      }
    })().catch(() => { /* never let a side call crash the Host */ });

    return view(sessionId);
  }

  return {
    start,
    poll: (sessionId) => view(sessionId),
    cancel,
    /** Exposed for tests only. */
    __test: { states, deadline },
  };
}
