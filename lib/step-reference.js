/**
 * Power-Up step references.
 *
 * A reference copied from the Trajectory context menu has the shape
 *
 *   dsh-step:<session-id>/<step-id>
 *
 * and identifies one unit of a session log:
 *
 *   turn.<turn>.step.<step>   one assistant step: every raw event between
 *                             `step/start` and `step/end` (assistant message,
 *                             tool calls, tool results, attempts)
 *   call.<call-id>            one tool call plus its result
 *   seq.<n>                   one raw event
 *   index.<n>                 a synthetic ledger row with no stable identity
 *
 * The model-facing `powerup_step_read` tool resolves a reference through
 * `ctx.sessionQuery`, so an agent only needs the copied string.
 */

/** Reference scheme, including the trailing colon. */
export const STEP_REF_PREFIX = 'dsh-step:';

/** Reference scheme without the separator. */
export const STEP_REF_SCHEME = 'dsh-step';

/** Model-facing tool that resolves these references. */
export const STEP_READ_TOOL_NAME = 'powerup_step_read';

/** Neighbor bound; matches the session-query default `readWindowMax`. */
export const MAX_CONTEXT_EVENTS = 50;

/** The raw event types that snapshot the whole request envelope. */
const REQUEST_EVENT_TYPES = new Set(['request/header']);

/** A reference that cannot be parsed or resolved. */
export class StepReferenceError extends Error {
  /**
   * @param {string} code stable machine code, included in the message
   * @param {string} message model-readable explanation
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`);
    this.name = 'StepReferenceError';
    this.code = code;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Build the reference an agent can paste back into `powerup_step_read`.
 * @param {string} sessionId
 * @param {string} stepId normalized step id
 * @returns {string}
 */
export function formatStepReference(sessionId, stepId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new StepReferenceError('STEP_REF_INVALID', 'a step reference needs a session id');
  }
  if (typeof stepId !== 'string' || stepId.trim() === '') {
    throw new StepReferenceError('STEP_REF_INVALID', 'a step reference needs a step id');
  }
  return `${STEP_REF_PREFIX}${sessionId.trim()}/${stepId.trim()}`;
}

/**
 * Split a reference into its session id and step id.
 * @param {string} ref
 * @returns {{ sessionId: string, stepId: string }}
 */
export function parseStepReference(ref) {
  if (typeof ref !== 'string') {
    throw new StepReferenceError('STEP_REF_INVALID', 'a step reference is a string copied from the Trajectory menu');
  }
  const text = ref.trim();
  if (!text.toLowerCase().startsWith(STEP_REF_PREFIX)) {
    throw new StepReferenceError(
      'STEP_REF_INVALID',
      `a step reference starts with ${STEP_REF_PREFIX} (use Copy step reference in the Trajectory menu)`,
    );
  }
  const rest = text.slice(STEP_REF_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new StepReferenceError('STEP_REF_INVALID', 'a step reference is dsh-step:<sessionId>/<stepId>');
  }
  const sessionId = rest.slice(0, slash).trim();
  const stepId = rest.slice(slash + 1).trim();
  if (sessionId === '' || stepId === '') {
    throw new StepReferenceError('STEP_REF_INVALID', 'a step reference is dsh-step:<sessionId>/<stepId>');
  }
  return { sessionId, stepId };
}

/** @param {string} text */
function canonicalStepId(text) {
  let match = /^turn\.(\d+)\.step\.(\d+)$/u.exec(text);
  if (match !== null) return `turn.${Number(match[1])}.step.${Number(match[2])}`;
  match = /^call\.(.+)$/u.exec(text);
  if (match !== null) {
    let callId = match[1];
    try {
      callId = decodeURIComponent(callId);
    } catch {
      /* Keep the literal text. */
    }
    return `call.${encodeURIComponent(callId)}`;
  }
  match = /^seq\.(\d+)$/u.exec(text);
  if (match !== null) return `seq.${Number(match[1])}`;
  match = /^index\.(\d+)$/u.exec(text);
  if (match !== null) return `index.${Number(match[1])}`;
  return '';
}

/**
 * Turn anything a row exposes — the DOM row key (`encodeURIComponent` of the
 * trajectory record id, optionally with a `\0summary\0` fold suffix), a raw
 * record id, or an already-normalized step id — into the canonical step id.
 * @param {string} value
 * @returns {string} canonical id, or `''` when the value carries no usable identity
 */
export function normalizeStepId(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text === '') return '';
  const known = canonicalStepId(text);
  if (known !== '') return known;
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* The value is already raw. */
  }
  const summaryCut = decoded.indexOf('\u0000summary\u0000');
  if (summaryCut !== -1) decoded = decoded.slice(0, summaryCut);
  const parts = decoded.split('\u0000');
  if (parts.length < 3) return '';
  if (parts[0] === 'assistant') {
    // `assistant\0turn\0T\0step\0S` (older shape) and `assistant\0T\0S`.
    const turn = Number(parts[1] === 'turn' ? parts[2] : parts[1]);
    const step = Number(parts[1] === 'turn' ? parts[4] : parts[2]);
    if (Number.isInteger(turn) && Number.isInteger(step) && turn >= 0 && step >= 0) {
      return `turn.${turn}.step.${step}`;
    }
    return '';
  }
  if (parts[1] === 'call' && parts[2] !== '') return `call.${encodeURIComponent(parts[2])}`;
  if (parts[1] === 'seq' && Number.isInteger(Number(parts[2]))) return `seq.${Number(parts[2])}`;
  if (parts[1] === 'index' && Number.isInteger(Number(parts[2]))) return `index.${Number(parts[2])}`;
  return '';
}

/**
 * Parse a canonical step id into the descriptor the resolver understands.
 * @param {string} stepId
 * @returns {{ kind: 'step', turn: number, step: number }
 *   | { kind: 'call', callId: string }
 *   | { kind: 'seq', seq: number }
 *   | { kind: 'index', index: number }
 *   | null}
 */
export function parseStepId(stepId) {
  const normalized = normalizeStepId(stepId);
  if (normalized === '') return null;
  let match = /^turn\.(\d+)\.step\.(\d+)$/u.exec(normalized);
  if (match !== null) return { kind: 'step', turn: Number(match[1]), step: Number(match[2]) };
  match = /^call\.(.+)$/u.exec(normalized);
  if (match !== null) {
    let callId = match[1];
    try {
      callId = decodeURIComponent(callId);
    } catch {
      /* Keep the literal text. */
    }
    return { kind: 'call', callId };
  }
  match = /^seq\.(\d+)$/u.exec(normalized);
  if (match !== null) return { kind: 'seq', seq: Number(match[1]) };
  match = /^index\.(\d+)$/u.exec(normalized);
  if (match !== null) return { kind: 'index', index: Number(match[1]) };
  return null;
}

/**
 * Canonical id for a parsed step descriptor.
 * @param {ReturnType<typeof parseStepId>} step
 * @returns {string}
 */
export function stepIdOf(step) {
  if (step === null || step === undefined) return '';
  if (step.kind === 'step') return `turn.${step.turn}.step.${step.step}`;
  if (step.kind === 'call') return `call.${encodeURIComponent(step.callId)}`;
  if (step.kind === 'seq') return `seq.${step.seq}`;
  if (step.kind === 'index') return `index.${step.index}`;
  return '';
}

/** @param {unknown} event @param {number} turn @param {number} step */
function belongsToStep(event, turn, step) {
  const data = event?.data;
  return data !== null && typeof data === 'object' && data.turn === turn && data.step === step;
}

/**
 * The toolCallId a `tool/result` event answers.
 * @param {any} data
 * @returns {string}
 */
function resultCallId(data) {
  const message = data?.message;
  if (message !== null && typeof message === 'object') {
    if (typeof message.toolCallId === 'string' && message.toolCallId !== '') return message.toolCallId;
    const callId = message.source?.callId;
    if (typeof callId === 'string' && callId !== '') return callId;
  }
  if (typeof data?.callId === 'string' && data.callId !== '') return data.callId;
  return '';
}

/**
 * Depth-bounded scan for a call id, used only for nested sub-calls that never
 * become their own raw `tool/call` event.
 * @param {unknown} value
 * @param {string} callId
 * @param {Set<unknown>} seen
 * @param {number} depth
 * @returns {boolean}
 */
function mentionsCallId(value, callId, seen, depth) {
  if (depth > 9 || value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value.callId === callId || value.toolCallId === callId) return true;
  for (const key of Object.keys(value)) {
    if (key === 'schema' || key === 'tools' || key === 'system') continue;
    if (mentionsCallId(value[key], callId, seen, depth + 1)) return true;
  }
  return false;
}

/**
 * Index range of every raw event that belongs to one turn/step.
 * @param {readonly any[]} events
 * @param {number} turn
 * @param {number} step
 * @returns {{ startIndex: number, endIndex: number, resolved: object } | null}
 */
function findStepRange(events, turn, step) {
  let first = -1;
  let start = -1;
  let end = -1;
  let last = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!belongsToStep(event, turn, step)) continue;
    if (first === -1) first = index;
    last = index;
    if (event.type === 'step/start' && start === -1) start = index;
    if (event.type === 'step/end') end = index;
  }
  if (first === -1) return null;
  const from = start === -1 ? first : start;
  const to = end === -1 ? last : end;
  return {
    startIndex: Math.min(from, to),
    endIndex: Math.max(from, to),
    resolved: { kind: 'step', turn, step },
  };
}

/**
 * Locate the raw event range behind a parsed step id.
 * @param {readonly any[]} events raw session events, ascending by seq
 * @param {ReturnType<typeof parseStepId>} step
 * @returns {{ startIndex: number, endIndex: number, resolved: object } | null}
 */
export function resolveStepRange(events, step) {
  if (!Array.isArray(events) || events.length === 0) return null;
  if (step === null || step === undefined) return null;
  if (step.kind === 'index') {
    throw new StepReferenceError(
      'STEP_REF_SYNTHETIC',
      'this ledger row has a synthetic index id (no stable event or call identity), so it cannot be resolved',
    );
  }
  if (step.kind === 'seq') {
    const index = events.findIndex((event) => event?.seq === step.seq);
    return index === -1 ? null : { startIndex: index, endIndex: index, resolved: { kind: 'seq', seq: step.seq } };
  }
  if (step.kind === 'call') {
    let callIndex = -1;
    let resultIndex = -1;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event?.type === 'tool/call' && event.data?.callId === step.callId) {
        if (callIndex === -1) callIndex = index;
        continue;
      }
      if (event?.type === 'tool/result' && resultCallId(event.data) === step.callId) resultIndex = index;
    }
    if (callIndex !== -1 || resultIndex !== -1) {
      const from = callIndex === -1 ? resultIndex : callIndex;
      const to = resultIndex === -1 ? callIndex : Math.max(resultIndex, callIndex);
      const owner = events[from]?.data;
      const resolved = { kind: 'call', callId: step.callId };
      if (Number.isInteger(owner?.turn)) resolved.turn = owner.turn;
      if (Number.isInteger(owner?.step)) resolved.step = owner.step;
      return {
        startIndex: Math.min(from, to),
        endIndex: Math.max(from, to),
        resolved,
      };
    }
    // A nested sub-call (PTC/run_code child) is not its own raw event; fall
    // back to the step that owns it so the step still answers the reference.
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!mentionsCallId(event, step.callId, new Set(), 0)) continue;
      const data = event?.data;
      if (Number.isInteger(data?.turn) && Number.isInteger(data?.step)) {
        const range = findStepRange(events, data.turn, data.step);
        if (range !== null) {
          return {
            startIndex: range.startIndex,
            endIndex: range.endIndex,
            resolved: { kind: 'step', turn: data.turn, step: data.step, viaCallId: step.callId },
          };
        }
      }
      return {
        startIndex: index,
        endIndex: index,
        resolved: { kind: 'event', seq: event.seq, viaCallId: step.callId },
      };
    }
    return null;
  }
  return findStepRange(events, step.turn, step.step);
}

/** @param {unknown} value @param {number} fallback */
function neighborCount(value, fallback = 0) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(MAX_CONTEXT_EVENTS, Math.trunc(number)));
}

/**
 * JSON-safe copy: bigint becomes a string and cycles become `[circular]`.
 * @param {unknown} value
 * @param {Set<unknown>} [seen]
 * @returns {unknown}
 */
export function toJsonSafe(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? String(value) : value;
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => toJsonSafe(entry, seen));
  if (value instanceof Map) {
    const out = {};
    for (const [key, entry] of value.entries()) out[String(key)] = toJsonSafe(entry, seen);
    return out;
  }
  if (value instanceof Set) return [...value].map((entry) => toJsonSafe(entry, seen));
  const out = {};
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (typeof entry === 'function') continue;
    out[key] = toJsonSafe(entry, seen);
  }
  return out;
}

/**
 * Read everything one step reference points at.
 *
 * @param {any} sessionQuery `ctx.sessionQuery`
 * @param {string} ref the copied `dsh-step:` reference
 * @param {{ before?: number, after?: number, requests?: boolean }} [options]
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} the JSON payload the tool renders
 */
export async function readStepReference(sessionQuery, ref, options = {}, signal) {
  const { sessionId, stepId } = parseStepReference(ref);
  const normalized = normalizeStepId(stepId);
  const step = parseStepId(normalized);
  if (step === null) {
    throw new StepReferenceError(
      'STEP_REF_INVALID_STEP_ID',
      `"${stepId}" is not a known step id (expected turn.<t>.step.<s>, call.<id>, seq.<n>, or index.<n>)`,
    );
  }
  if (step.kind === 'index') {
    throw new StepReferenceError('STEP_REF_SYNTHETIC', 'synthetic index rows cannot be resolved');
  }
  if (sessionQuery === null || sessionQuery === undefined || typeof sessionQuery.readSession !== 'function') {
    throw new StepReferenceError('STEP_REF_SESSION_QUERY_UNAVAILABLE', 'this host does not expose ctx.sessionQuery');
  }
  signal?.throwIfAborted?.();

  let snapshot;
  try {
    snapshot = await sessionQuery.readSession(sessionId);
  } catch (error) {
    const detail = String(error?.message ?? error);
    throw new StepReferenceError(
      'STEP_REF_SESSION_UNAVAILABLE',
      `could not read session "${sessionId}" (${detail})`,
      { cause: error },
    );
  }
  signal?.throwIfAborted?.();

  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  if (events.length === 0) {
    throw new StepReferenceError('STEP_REF_EMPTY_SESSION', `session "${sessionId}" has no raw events`);
  }
  const range = resolveStepRange(events, step);
  if (range === null) {
    throw new StepReferenceError(
      'STEP_REF_UNRESOLVED',
      `no event in session "${sessionId}" matches ${stepIdOf(step)}`,
    );
  }

  const before = neighborCount(options.before);
  const after = neighborCount(options.after);
  const start = Math.max(0, range.startIndex - before);
  const end = Math.min(events.length - 1, range.endIndex + after);
  const includeRequests = options.requests === true;
  const selected = [];
  for (let index = start; index <= end; index += 1) {
    const event = events[index];
    if (!includeRequests && REQUEST_EVENT_TYPES.has(event?.type)) continue;
    selected.push(toJsonSafe(event));
  }

  let title = '';
  if (typeof sessionQuery.readTitle === 'function') {
    try {
      const snapshotTitle = await sessionQuery.readTitle(sessionId);
      if (typeof snapshotTitle?.title === 'string') title = snapshotTitle.title;
    } catch {
      /* A missing title never fails the read. */
    }
  }
  signal?.throwIfAborted?.();

  const payload = {
    reference: formatStepReference(String(snapshot?.session?.id ?? sessionId), stepIdOf(step)),
    session: {
      id: String(snapshot?.session?.id ?? sessionId),
      ...(typeof snapshot?.session?.cwd === 'string' && snapshot.session.cwd !== '' ? { cwd: snapshot.session.cwd } : {}),
      ...(title === '' ? {} : { title }),
    },
    target: { kind: step.kind, id: stepIdOf(step), ...describeStep(step) },
    resolved: range.resolved,
    range: {
      startSeq: events[start].seq,
      endSeq: events[end].seq,
      eventCount: end - start + 1,
      returned: selected.length,
      before,
      after,
    },
    events: selected,
  };
  if (!includeRequests && selected.length !== end - start + 1) {
    payload.note = 'request/header snapshots (the full system prompt and tool schemas) are omitted; pass requests=true to include them';
  }
  return payload;
}

/** @param {Exclude<ReturnType<typeof parseStepId>, null>} step */
function describeStep(step) {
  if (step.kind === 'step') return { turn: step.turn, step: step.step };
  if (step.kind === 'call') return { callId: step.callId };
  if (step.kind === 'seq') return { seq: step.seq };
  return { index: step.index };
}
