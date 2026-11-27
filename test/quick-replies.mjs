import assert from 'node:assert/strict';

import {
  QUICK_REPLIES_LIMIT,
  QUICK_REPLIES_TOOL_NAME,
  createQuickRepliesStore,
  createQuickRepliesTool,
  normalizeQuickReplies,
} from '../lib/quick-replies.js';

// --- normalization ---------------------------------------------------------
assert.deepEqual(normalizeQuickReplies(null), []);
assert.deepEqual(normalizeQuickReplies('not a list'), []);
const normalized = normalizeQuickReplies([
  { label: '  A  ', message: '  first  ' },
  { title: 'B', text: 'second' },
  { label: '', message: 'no label' },
  { label: 'C', message: '' },
  { label: 'D', message: 'dup' },
  { label: 'E', message: 'dup' },
  null,
  'x',
]);
assert.deepEqual(normalized, [
  { label: 'A', message: 'first' },
  { label: 'B', message: 'second' },
  { label: 'D', message: 'dup' },
  { label: 'E', message: 'dup' },
]);
assert.equal(normalizeQuickReplies(
  Array.from({ length: QUICK_REPLIES_LIMIT + 5 }, (_, i) => ({ label: `L${i}`, message: `M${i}` })),
).length, QUICK_REPLIES_LIMIT);

// --- store -----------------------------------------------------------------
const files = new Map();
let versionSeq = 0;
const deps = {
  file: '/state/quick-replies.json',
  readFile: (path) => files.get(path) ?? (() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; })(),
  writeFile: (path, data) => files.set(path, data),
  mkdir: () => {},
  dirname: (path) => path.slice(0, path.lastIndexOf('/')),
  now: () => 1234,
  uuid: () => `v${++versionSeq}`,
};
const store = createQuickRepliesStore(deps);
assert.deepEqual(store.read('s1'), { options: [], version: '' });
const set = store.set('s1', [{ label: 'Yes', message: 'go' }]);
assert.equal(set.options.length, 1);
assert.equal(store.read('s1').version, set.version);
assert.equal(store.read('s1').options[0].label, 'Yes');

// Stale clears do not erase newer options.
assert.equal(store.clearIfVersion('s1', 'old-version'), false);
assert.equal(store.read('s1').options.length, 1);
const newer = store.set('s1', [{ label: 'No', message: 'stop' }]);
assert.equal(store.clearIfVersion('s1', set.version), false, 'old version cannot clear newer options');
assert.equal(store.read('s1').options[0].label, 'No');
assert.equal(store.clearIfVersion('s1', newer.version), true);
assert.deepEqual(store.read('s1'), { options: [], version: '' });

// An empty set removes the record entirely.
store.set('s2', [{ label: 'X', message: 'x' }]);
store.set('s2', []);
assert.deepEqual(store.read('s2'), { options: [], version: '' });

// --- tool definition -------------------------------------------------------
let definition;
const defineTool = (value) => { definition = value; return value; };
const toolStore = createQuickRepliesStore(deps);
createQuickRepliesTool(defineTool, {
  getSessionId: () => 'fallback-session',
  getStore: () => toolStore,
});
assert.equal(definition.name, QUICK_REPLIES_TOOL_NAME);
assert.match(definition.description, /tappable reply options/i);

const exec = { agent: { id: 'agent-session' }, signal: { aborted: false } };
const text = await definition.execute({ options: [{ label: 'Go', message: 'please continue' }] }, exec);
assert.match(text, /Published 1 quick reply option/);
assert.equal(toolStore.read('agent-session').options[0].message, 'please continue');
assert.equal(toolStore.read('fallback-session').options.length, 0, 'agent id takes precedence');

const cleared = await definition.execute({ options: [] }, exec);
assert.match(cleared, /cleared/);
assert.equal(toolStore.read('agent-session').options.length, 0);

console.log('quick-replies: ok');
