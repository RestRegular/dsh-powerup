import assert from 'node:assert/strict';

import {
  PROGRESS_MODES,
  ProgressError,
  buildProgressContext,
  finishReport,
  normalizeProgressReport,
  parseProgressReport,
} from '../lib/progress-tool.js';
import { createProgressManager } from '../lib/progress-manager.js';

// ---------------------------------------------------------------------------
// Context extraction
// ---------------------------------------------------------------------------
const surface = {
  events: [
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'Build the feature' }] } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [
      { type: 'text', text: 'Starting now' },
      { type: 'tool-call', name: 'read', arguments: '{}' },
    ] } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Halfway' }] } } },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'Keep going' }] } },
  ],
};
const context = buildProgressContext(surface, {});
assert.match(context, /User: Build the feature/u);
assert.match(context, /\[called read\]/u);
assert.match(context, /Assistant: Halfway/u);
assert.match(context, /User: Keep going/u);

assert.equal(buildProgressContext({ events: [{ type: 'x', data: {} }] }, {}), '');
assert.equal(buildProgressContext({ events: [
  { role: 'user', content: [{ type: 'text', text: 'hi' }] },
] }, {}), 'User: hi');
assert.equal(buildProgressContext(surface, { limit: 10 }).length <= 10, true, 'respects the char limit');

// ---------------------------------------------------------------------------
// Parsing + normalization
// ---------------------------------------------------------------------------
assert.deepEqual(PROGRESS_MODES, ['checklist', 'phases', 'milestones', 'tree']);

const report = parseProgressReport('```json\n{"mode":"checklist","title":"T","summary":"S","percent":42,"steps":[{"title":"A","status":"in-progress"},{"title":"","status":"done"}],"blockers":["needs X"],"display":[{"kind":"text","text":"hello"},{"kind":"bars","items":[{"label":"P","value":150}]}]}\n```');
assert.equal(report.mode, 'checklist');
assert.equal(report.percent, 42);
assert.equal(report.steps.length, 1, 'drops empty-title steps');
assert.equal(report.steps[0].status, 'in-progress');
assert.deepEqual(report.blockers, ['needs X']);
assert.equal(report.display[0].kind, 'text');
assert.equal(report.display[1].items[0].value, 100, 'clamps bar percentages');

assert.throws(() => parseProgressReport('not json'), /INVALID_JSON/u);
assert.throws(() => parseProgressReport(''), /EMPTY/u);
assert.throws(() => parseProgressReport('[]'), /INVALID_SHAPE/u);

const phases = normalizeProgressReport({
  mode: 'phases',
  phases: [{ name: 'P1', status: 'done', steps: [{ title: 's1', status: 'done' }] }],
  percent: '80',
});
assert.equal(phases.mode, 'phases');
assert.equal(phases.percent, 80);
assert.equal(phases.phases[0].steps[0].title, 's1');
assert.equal(normalizeProgressReport({ mode: 'unknown', percent: -5 }).percent, 0, 'clamps percent');
assert.equal(normalizeProgressReport({ mode: 'unknown' }).mode, 'checklist', 'falls back to checklist');

assert.throws(() => finishReport('x', { kind: 'error' }), /LLM_FAILED/u);
assert.throws(() => finishReport('x', { kind: 'aborted' }), /LLM_FAILED/u);
assert.throws(() => finishReport('x', { kind: 'max-tokens' }), /TRUNCATED/u);
assert.equal(finishReport('x', { kind: 'stop' }), 'x');

// ---------------------------------------------------------------------------
// generateProgress with a fake llm service
// ---------------------------------------------------------------------------
const { generateProgress } = await import('../lib/progress-tool.js');
const fakeLlm = {
  async prepareCall(config, signal) {
    return {
      config: { ...config, temperature: 0 },
      async *stream(options) {
        assert.equal(options.purpose, 'task-progress');
        assert.equal(options.provider, config.provider);
        assert.equal(options.system.includes('JSON'), true);
        assert.match(options.messages[0].content[0].text, /Session transcript/u);
        assert.equal(typeof signal, 'object');
        yield { type: 'text-delta', index: 0, text: '{"mode":"milestones","milestones":' };
        yield { type: 'text-delta', index: 0, text: '[{"name":"M1","status":"done"}],"percent":100}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    };
  },
};
const generated = await generateProgress({
  llm: fakeLlm,
  route: { provider: 'deepseek', model: 'deepseek-chat' },
  context: 'User: hi',
  signal: new AbortController().signal,
});
assert.equal(generated.mode, 'milestones');
assert.equal(generated.milestones[0].name, 'M1');

await assert.rejects(
  generateProgress({ llm: {}, route: { provider: 'x', model: 'y' }, context: '' }),
  /LLM_UNAVAILABLE/u,
);

// ---------------------------------------------------------------------------
// Manager state machine
// ---------------------------------------------------------------------------
const fakeQuery = {
  async inspectSession(sessionId, read) {
    return read({ requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) });
  },
  async readSurface() { return surface; },
};
const manager = createProgressManager({
  getLlm: () => fakeLlm,
  getSessionQuery: () => fakeQuery,
  resolveRoute: () => ({ provider: 'fallback', model: 'fallback' }),
  timeoutMs: 5000,
});
assert.equal(manager.poll('s').status, 'idle');
const started = manager.start('s');
assert.equal(started.status, 'running');
// Wait for the background call to settle.
await new Promise((resolve) => setTimeout(resolve, 60));
const done = manager.poll('s');
assert.equal(done.status, 'done', `expected done, got ${done.status}: ${done.error ?? ''}`);
assert.equal(done.report.percent, 100);
assert.equal(manager.cancel('s').status, 'idle');

const noRoute = createProgressManager({
  getLlm: () => fakeLlm,
  getSessionQuery: () => ({
    async inspectSession(_id, read) { return read({ requestHeader: () => undefined }); },
    async readSurface() { return { events: [] }; },
  }),
  resolveRoute: () => undefined,
  timeoutMs: 5000,
});
noRoute.start('n');
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(noRoute.poll('n').status, 'error');
assert.match(noRoute.poll('n').error, /NO_ROUTE/u);

console.log('progress: ok');
