import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import {
  STEP_READ_TOOL_NAME,
  STEP_REF_PREFIX,
  StepReferenceError,
  formatStepReference,
  normalizeStepId,
  parseStepId,
  parseStepReference,
  readStepReference,
  resolveStepRange,
  stepIdOf,
} from '../lib/step-reference.js';
import { STEP_READ_DESCRIPTION, createStepReadTool } from '../lib/step-tool.js';

// The Host half imports the DSH tool DSL. Map it to a local stub so the suite
// runs outside a DSH installation; every other specifier resolves normally.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: new URL('./dsh-tools-stub.mjs', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// ---------------------------------------------------------------------------
// Reference codec
// ---------------------------------------------------------------------------
assert.equal(STEP_REF_PREFIX, 'dsh-step:');
assert.equal(STEP_READ_TOOL_NAME, 'powerup_step_read');

assert.equal(formatStepReference('session-1', 'turn.0.step.0'), 'dsh-step:session-1/turn.0.step.0');
assert.deepEqual(parseStepReference('  dsh-step:session-1/turn.0.step.0  '), {
  sessionId: 'session-1',
  stepId: 'turn.0.step.0',
});
assert.throws(() => formatStepReference('', 'seq.1'), StepReferenceError);
assert.throws(() => formatStepReference('session-1', ''), StepReferenceError);
assert.throws(() => parseStepReference('turn.0.step.0'), /STEP_REF_INVALID/u);
assert.throws(() => parseStepReference('dsh-step:session-1'), /STEP_REF_INVALID/u);
assert.throws(() => parseStepReference('dsh-step:/seq.1'), /STEP_REF_INVALID/u);
assert.throws(() => parseStepReference(null), /STEP_REF_INVALID/u);

// The DOM row key is `encodeURIComponent(recordId)`; folded summaries append a
// raw `\0summary\0<kind>` suffix that must be dropped.
assert.equal(normalizeStepId(encodeURIComponent('assistant\u00000\u00000')), 'turn.0.step.0');
assert.equal(normalizeStepId('assistant\u0000turn\u00000\u0000step\u00001'), 'turn.0.step.1');
assert.equal(
  normalizeStepId(`${encodeURIComponent('assistant\u00003\u00002')}\u0000summary\u0000assistant`),
  'turn.3.step.2',
);
assert.equal(normalizeStepId(encodeURIComponent('tool\u0000call\u0000call_abc')), 'call.call_abc');
assert.equal(normalizeStepId(encodeURIComponent('tool\u0000call\u0000a/b')), 'call.a%2Fb');
assert.equal(normalizeStepId(encodeURIComponent('tool\u0000seq\u000012')), 'seq.12');
assert.equal(normalizeStepId('index.4'), 'index.4');
assert.equal(normalizeStepId(encodeURIComponent('user\u0000index\u00005')), 'index.5');
assert.equal(normalizeStepId('assistant'), '');
assert.equal(normalizeStepId(''), '');
assert.equal(normalizeStepId(null), '');

assert.deepEqual(parseStepId('turn.0.step.0'), { kind: 'step', turn: 0, step: 0 });
assert.deepEqual(parseStepId('call.call_abc'), { kind: 'call', callId: 'call_abc' });
assert.deepEqual(parseStepId('call.a%2Fb'), { kind: 'call', callId: 'a/b' });
assert.deepEqual(parseStepId('seq.12'), { kind: 'seq', seq: 12 });
assert.deepEqual(parseStepId('index.4'), { kind: 'index', index: 4 });
assert.equal(parseStepId('nonsense'), null);
assert.deepEqual(parseStepId(encodeURIComponent('tool\u0000call\u0000call_abc')), { kind: 'call', callId: 'call_abc' });
assert.equal(stepIdOf(parseStepId('call.a/b')), 'call.a%2Fb');
assert.equal(stepIdOf(null), '');

// ---------------------------------------------------------------------------
// Resolution against a raw event log
// ---------------------------------------------------------------------------
const events = [
  { type: 'turn/start', seq: 0, data: { turn: 0 } },
  { type: 'step/start', seq: 1, data: { turn: 0, step: 0 } },
  { type: 'request/header', seq: 2, data: { header: { tools: [{ name: 'bash' }] }, reason: 'initial' } },
  { type: 'request/context', seq: 3, data: { provider: 'deepseek', model: 'deepseek-flash' } },
  {
    type: 'assistant/message',
    seq: 4,
    data: {
      turn: 0,
      step: 0,
      message: { role: 'assistant' },
      stream: [],
      blocks: [{ kind: 'tool-call', callId: 'call_abc' }, { kind: 'tool-call', callId: 'call_nested' }],
    },
  },
  { type: 'tool/call', seq: 5, data: { turn: 0, step: 0, callId: 'call_abc', name: 'bash', arguments: '{"cmd":"ls"}' } },
  {
    type: 'tool/result',
    seq: 6,
    data: {
      turn: 0,
      step: 0,
      message: { role: 'tool', toolCallId: 'call_abc', source: { kind: 'tool', callId: 'call_abc' } },
    },
  },
  { type: 'step/end', seq: 7, data: { turn: 0, step: 0 } },
  { type: 'turn/end', seq: 8, data: { turn: 0, reason: { kind: 'completed' } } },
  { type: 'step/start', seq: 9, data: { turn: 0, step: 1 } },
  { type: 'request/header', seq: 10, data: { header: {}, reason: 'change' } },
  { type: 'assistant/message', seq: 11, data: { turn: 0, step: 1, message: { role: 'assistant' }, stream: [] } },
  { type: 'step/end', seq: 12, data: { turn: 0, step: 1 } },
];

assert.deepEqual(resolveStepRange(events, parseStepId('turn.0.step.0')), {
  startIndex: 1,
  endIndex: 7,
  resolved: { kind: 'step', turn: 0, step: 0 },
});
assert.deepEqual(resolveStepRange(events, parseStepId('turn.0.step.1')), {
  startIndex: 9,
  endIndex: 12,
  resolved: { kind: 'step', turn: 0, step: 1 },
});
assert.deepEqual(resolveStepRange(events, parseStepId('call.call_abc')), {
  startIndex: 5,
  endIndex: 6,
  resolved: { kind: 'call', callId: 'call_abc', turn: 0, step: 0 },
});
assert.deepEqual(resolveStepRange(events, parseStepId('seq.4')), {
  startIndex: 4,
  endIndex: 4,
  resolved: { kind: 'seq', seq: 4 },
});
// A nested run_code sub-call has no raw tool/call event; the owning step answers.
assert.deepEqual(resolveStepRange(events, parseStepId('call.call_nested')), {
  startIndex: 1,
  endIndex: 7,
  resolved: { kind: 'step', turn: 0, step: 0, viaCallId: 'call_nested' },
});
assert.equal(resolveStepRange(events, parseStepId('call.call_missing')), null);
assert.equal(resolveStepRange(events, parseStepId('turn.9.step.9')), null);
assert.equal(resolveStepRange([], parseStepId('seq.1')), null);
assert.throws(
  () => resolveStepRange(events, parseStepId('index.4')),
  (error) => error instanceof StepReferenceError && error.code === 'STEP_REF_SYNTHETIC',
);

// A live step has no `step/end` yet; the last matching event closes the range.
const streaming = events.slice(0, 6);
assert.deepEqual(resolveStepRange(streaming, parseStepId('turn.0.step.0')), {
  startIndex: 1,
  endIndex: 5,
  resolved: { kind: 'step', turn: 0, step: 0 },
});

// ---------------------------------------------------------------------------
// readStepReference (fake ctx.sessionQuery)
// ---------------------------------------------------------------------------
function fakeSessionQuery(log = events, options = {}) {
  return {
    calls: [],
    async readSession(sessionId) {
      this.calls.push(['readSession', sessionId]);
      if (options.readError !== undefined) throw new Error(options.readError);
      return { session: { id: sessionId, cwd: 'D:\\project' }, inheritedEventCount: 0, events: log };
    },
    async readTitle(sessionId) {
      this.calls.push(['readTitle', sessionId]);
      if (options.titleError === true) throw new Error('title failed');
      return options.title === undefined ? undefined : { title: options.title, eventSeq: 1, updatedAt: 1, messageSeqs: [], source: { kind: 'fallback' } };
    },
  };
}

const query = fakeSessionQuery(events, { title: 'Fix the flaky test' });
const payload = await readStepReference(query, 'dsh-step:session-1/turn.0.step.0');
assert.deepEqual(query.calls, [['readSession', 'session-1'], ['readTitle', 'session-1']]);
assert.equal(payload.reference, 'dsh-step:session-1/turn.0.step.0');
assert.deepEqual(payload.session, { id: 'session-1', cwd: 'D:\\project', title: 'Fix the flaky test' });
assert.deepEqual(payload.target, { kind: 'step', id: 'turn.0.step.0', turn: 0, step: 0 });
assert.deepEqual(payload.resolved, { kind: 'step', turn: 0, step: 0 });
assert.deepEqual(payload.range, {
  startSeq: 1,
  endSeq: 7,
  eventCount: 7,
  returned: 6,
  before: 0,
  after: 0,
});
assert.deepEqual(payload.events.map((event) => event.seq), [1, 3, 4, 5, 6, 7], 'request/header is omitted');
assert.match(payload.note ?? '', /requests=true/u);
assert.equal(payload.events[0].data.turn, 0);

const withRequests = await readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/turn.0.step.0', { requests: true });
assert.deepEqual(withRequests.events.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7]);
assert.equal(withRequests.note, undefined);

const padded = await readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/call.call_abc', {
  before: 2,
  after: 1,
});
assert.deepEqual(padded.events.map((event) => event.seq), [3, 4, 5, 6, 7]);
assert.equal(padded.range.before, 2);
assert.equal(padded.range.after, 1);
assert.equal(padded.range.eventCount, 5);

const clamped = await readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/seq.1', {
  before: 999,
  after: -5,
});
assert.equal(clamped.range.before, 50);
assert.equal(clamped.range.after, 0);
assert.equal(clamped.events[0].seq, 0, 'the window clamps to the log start');

const noTitle = await readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/turn.0.step.0');
assert.equal('title' in noTitle.session, false);

const brokenTitle = await readStepReference(
  fakeSessionQuery(events, { titleError: true }),
  'dsh-step:session-1/turn.0.step.0',
);
assert.equal(brokenTitle.session.id, 'session-1', 'a title failure never fails the read');

await assert.rejects(
  () => readStepReference(fakeSessionQuery(events, { readError: 'missing' }), 'dsh-step:session-9/turn.0.step.0'),
  (error) => error instanceof StepReferenceError && error.code === 'STEP_REF_SESSION_UNAVAILABLE',
);
await assert.rejects(
  () => readStepReference(fakeSessionQuery([]), 'dsh-step:session-1/turn.0.step.0'),
  (error) => error.code === 'STEP_REF_EMPTY_SESSION',
);
await assert.rejects(
  () => readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/turn.7.step.0'),
  (error) => error.code === 'STEP_REF_UNRESOLVED' && /turn\.7\.step\.0/u.test(error.message),
);
await assert.rejects(
  () => readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/index.3'),
  (error) => error.code === 'STEP_REF_SYNTHETIC',
);
await assert.rejects(
  () => readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/nonsense'),
  (error) => error.code === 'STEP_REF_INVALID_STEP_ID',
);
await assert.rejects(
  () => readStepReference(fakeSessionQuery(events), 'not-a-reference'),
  (error) => error.code === 'STEP_REF_INVALID',
);
await assert.rejects(
  () => readStepReference(undefined, 'dsh-step:session-1/seq.1'),
  (error) => error.code === 'STEP_REF_SESSION_QUERY_UNAVAILABLE',
);

// Cancellation reaches the reader before any work starts.
const aborted = new AbortController();
aborted.abort();
await assert.rejects(
  () => readStepReference(fakeSessionQuery(events), 'dsh-step:session-1/seq.1', {}, aborted.signal),
);

// ---------------------------------------------------------------------------
// Model-facing tool definition
// ---------------------------------------------------------------------------
const definitions = [];
const defineTool = (definition) => {
  definitions.push(definition);
  return definition;
};
const tool = createStepReadTool(defineTool, {
  getSessionQuery: () => fakeSessionQuery(events, { title: 'Fix the flaky test' }),
});
assert.equal(definitions.length, 1);
assert.equal(tool.name, 'powerup_step_read');
assert.equal(tool.name, STEP_READ_TOOL_NAME);
assert.equal(tool.description, STEP_READ_DESCRIPTION);
assert.match(tool.description, /dsh-step:<sessionId>\/<stepId>/u);
assert.equal(tool.parameters.ref.type, 'string');
assert.equal(tool.parameters.ref.required, true);
assert.equal(tool.parameters.before.type, 'integer');
assert.equal(tool.parameters.after.type, 'integer');
assert.equal(tool.parameters.requests.type, 'boolean');
assert.equal(tool.isConcurrencySafe(), true);
assert.deepEqual(tool.output.render({}, 'hello'), [{ type: 'text', text: 'hello' }]);

const rendered = await tool.execute({ ref: 'dsh-step:session-1/turn.0.step.0' }, {});
const decoded = JSON.parse(rendered);
assert.equal(decoded.reference, 'dsh-step:session-1/turn.0.step.0');
assert.equal(decoded.session.title, 'Fix the flaky test');
assert.deepEqual(decoded.events.map((event) => event.seq), [1, 3, 4, 5, 6, 7]);

const withoutRequest = await tool.execute({ ref: 'dsh-step:session-1/seq.2', requests: true }, {});
assert.deepEqual(JSON.parse(withoutRequest).events.map((event) => event.seq), [2]);

await assert.rejects(() => tool.execute({ ref: 'nope' }, {}), /STEP_REF_INVALID/u);

const unavailable = createStepReadTool(defineTool, { getSessionQuery: () => undefined });
await assert.rejects(
  () => unavailable.execute({ ref: 'dsh-step:session-1/seq.1' }, {}),
  /STEP_REF_SESSION_QUERY_UNAVAILABLE/u,
);
assert.throws(() => createStepReadTool(undefined, { getSessionQuery: () => undefined }), TypeError);
assert.throws(() => createStepReadTool(defineTool, {}), TypeError);

// The resolver serialises data it cannot round-trip through JSON.
const bigintEvents = [{ type: 'x', seq: 0, data: { big: 10n, cyclic: null } }];
bigintEvents[0].data.cyclic = bigintEvents[0].data;
const bigintQuery = fakeSessionQuery(bigintEvents);
const bigintPayload = await readStepReference(bigintQuery, 'dsh-step:session-1/seq.0');
assert.equal(bigintPayload.events[0].data.big, '10');
assert.equal(bigintPayload.events[0].data.cyclic, '[circular]');

// ---------------------------------------------------------------------------
// Host wiring: apply() registers the tool once tools + sessionQuery exist
// ---------------------------------------------------------------------------
const { apply } = await import(new URL('../index.js', import.meta.url).href);
assert.equal(typeof apply, 'function');

function fakeContext(services) {
  const injections = [];
  return {
    injections,
    inject(deps, callback) {
      const ready = deps.every((name) => services[name] !== undefined);
      injections.push({ deps, ready });
      if (!ready) return () => {};
      const scope = {
        get(name) { return services[name]; },
        effect(fn) { return fn(); },
      };
      const disposer = callback(scope);
      return typeof disposer === 'function' ? disposer : () => {};
    },
  };
}

const registered = [];
const fakeTools = {
  register(definition) {
    registered.push(definition);
    return () => {
      const index = registered.indexOf(definition);
      if (index !== -1) registered.splice(index, 1);
    };
  },
};
const wiringQuery = fakeSessionQuery(events, { title: 'Wired step' });
const wiredCtx = fakeContext({
  webServer: { register: () => () => {} },
  tools: fakeTools,
  sessionQuery: wiringQuery,
});
apply(wiredCtx);
assert.deepEqual(wiredCtx.injections.map((entry) => entry.deps), [['webServer'], ['tools', 'sessionQuery']]);
assert.equal(registered.length, 1, 'one tool is registered');
assert.equal(registered[0].name, STEP_READ_TOOL_NAME);
const wiredOut = JSON.parse(await registered[0].execute({ ref: 'dsh-step:session-1/seq.5' }, {}));
assert.equal(wiredOut.reference, 'dsh-step:session-1/seq.5');
assert.deepEqual(wiredOut.events.map((event) => event.seq), [5]);
assert.equal(wiredOut.session.title, 'Wired step');

// A host without the tool registry (or without sessionQuery) stays quiet.
const bareRegistered = [];
apply(fakeContext({ webServer: { register: () => () => {} } }));
assert.equal(bareRegistered.length, 0);

const halfCtx = fakeContext({ tools: { register: (definition) => { bareRegistered.push(definition); return () => {}; } } });
apply(halfCtx);
assert.equal(bareRegistered.length, 0, 'sessionQuery is required before registering');

console.log('host: ok');
