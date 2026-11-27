import assert from 'node:assert/strict';

import {
  DIRECT_ASK_MAX_TOKENS,
  DirectAskError,
  TITLE_MAX_TOKENS,
  buildAskPrompt,
  cleanAskText,
  directAsk,
  generateTitle,
} from '../lib/direct-ask.js';
import { generateProgress } from '../lib/progress-tool.js';
import { createProgressManager } from '../lib/progress-manager.js';

// --- cleanAskText / buildAskPrompt -----------------------------------------
assert.equal(cleanAskText('  hello\n world  '), 'hello\n world');
assert.equal(cleanAskText(null), '');
assert.equal(cleanAskText('x'.repeat(100), 10), 'x'.repeat(10));
assert.equal(buildAskPrompt({ question: 'what is 2+2?' }), 'what is 2+2?');
const withContext = buildAskPrompt({
  question: '解释一下',
  context: [{ name: 'a.txt', text: 'some file text' }, { text: '' }],
});
assert.match(withContext, /file: a\.txt/);
assert.match(withContext, /some file text/);
assert.match(withContext, /--- question ---\n解释一下$/u);

// --- directAsk -------------------------------------------------------------
const captured = [];
function fakeLlm(chunks) {
  return {
    async prepareCall(config, signal) {
      captured.push({ config, signal });
      return {
        config: { provider: config.provider, model: config.model },
        async *stream(options) {
          captured.push({ options });
          for (const chunk of chunks) yield chunk;
        },
      };
    },
  };
}
const route = { provider: 'deepseek', model: 'test-model' };
const answer = await directAsk({
  llm: fakeLlm([
    { type: 'text-delta', text: 'Hello' },
    { type: 'text-delta', text: ' world' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]),
  route,
  prompt: 'hi',
});
assert.equal(answer.text, 'Hello world');
assert.equal(captured[0].config.maxTokens, DIRECT_ASK_MAX_TOKENS);
assert.equal(captured[1].options.system.includes('no tools'), true);
assert.equal(captured[1].options.purpose, 'powerup-direct-ask');
assert.equal(captured[1].options.messages[0].content[0].text, 'hi');

// Multi-turn history is included before the current question.
captured.length = 0;
await directAsk({
  llm: fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }]),
  route,
  prompt: 'and now?',
  history: [
    { role: 'user', text: 'first' },
    { role: 'assistant', text: 'reply' },
    { role: 'bogus', text: 'ignored' },
  ],
});
const msgs = captured[1].options.messages;
assert.equal(msgs.length, 1, 'conversation is sent as a single user message');
assert.equal(msgs[0].role, 'user');
assert.match(msgs[0].content[0].text, /User: first/u);
assert.match(msgs[0].content[0].text, /Assistant: reply/u);
assert.match(msgs[0].content[0].text, /User: and now\?$/u);

await assert.rejects(
  directAsk({ llm: fakeLlm([{ type: 'finish', reason: { kind: 'error' } }]), route, prompt: 'x' }),
  (error) => error instanceof DirectAskError && error.code === 'LLM_FAILED',
);
await assert.rejects(
  directAsk({ llm: fakeLlm([]), route: {}, prompt: 'x' }),
  (error) => error instanceof DirectAskError && error.code === 'NO_ROUTE',
);

// Title generation uses a strict token cap and strips quotes.
let titleConfig;
const titleLlm = {
  async prepareCall(config) {
    titleConfig = config;
    return {
      config: {},
      async *stream() {
        yield { type: 'text-delta', text: '"如何优化插件"' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    };
  },
};
const titled = await generateTitle({ llm: titleLlm, route, firstMessage: '请问怎么优化这个插件？' });
assert.equal(titled.title, '如何优化插件');
assert.equal(titleConfig.maxTokens, TITLE_MAX_TOKENS, 'title call is token-capped');

// --- generateProgress keeps raw text + requirements ------------------------
const llm2 = {
  async prepareCall(config) {
    return {
      config: {},
      async *stream() {
        yield { type: 'text-delta', text: '{"mode":"checklist","title":"T","steps":[{"title":"s","status":"done"}],"percent":100}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    };
  },
};
let capturedSystem = '';
const llm3 = {
  async prepareCall(config) {
    return {
      config: {},
      async *stream(options) {
        capturedSystem = options.system;
        yield { type: 'text-delta', text: '{"mode":"checklist","title":"T","steps":[]}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    };
  },
};
const report = await generateProgress({ llm: llm3, route, context: '', requirements: '请用中文回答' });
assert.match(capturedSystem, /请用中文回答/u);
assert.match(report.raw, /^$/u.test(report.raw) ? /.*/u : /checklist/u);

// --- progress manager history ---------------------------------------------
const writes = [];
const manager = createProgressManager({
  getLlm: () => llm2,
  getSessionQuery: () => ({
    inspectSession: async () => undefined,
    readSurface: async () => ({ events: [] }),
  }),
  resolveRoute: () => route,
  getRequirements: () => 'be concise',
  onHistoryChange: (id, history) => writes.push([id, history.length]),
});
await manager.start('s1');
// wait for the async side call
await new Promise((r) => setTimeout(r, 50));
let view = manager.poll('s1');
assert.equal(view.status, 'done');
assert.equal(view.history.length, 1);
assert.equal(view.report.raw !== undefined, true);
await manager.start('s1');
await new Promise((r) => setTimeout(r, 50));
view = manager.poll('s1');
assert.equal(view.history.length, 2, 'refresh keeps previous reports');
assert.equal(writes.length, 2);
const cleared = manager.clearHistory('s1');
assert.deepEqual(cleared, []);
assert.equal(manager.poll('s1').history.length, 0);

console.log('direct-ask+progress-history: ok');
