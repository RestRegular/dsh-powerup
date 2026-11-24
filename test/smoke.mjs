import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
// Minimal browser + React doubles. The Client half is a classic script that
// registers a factory; this harness exercises the real module body without a
// DOM or a browser.
// ---------------------------------------------------------------------------
let hookCursor = 0;
let hookState = [];

function resetHooks() {
  hookCursor = 0;
  hookState = [];
}

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return {
      type,
      props: {
        ...(props ?? {}),
        children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
      },
    };
  },
  useState(initial) {
    const index = hookCursor++;
    if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? initial() : initial;
    return [hookState[index], (next) => {
      hookState[index] = typeof next === 'function' ? next(hookState[index]) : next;
    }];
  },
  useEffect() { hookCursor++; },
  useLayoutEffect() { hookCursor++; },
  useRef(initial) {
    const index = hookCursor++;
    if (!(index in hookState)) hookState[index] = { current: initial };
    return hookState[index];
  },
  useCallback(fn) { hookCursor++; return fn; },
  useMemo(fn) { hookCursor++; return fn(); },
};

globalThis.window = {
  __ModuleLoader__: {
    factories: new Map(),
    entries: new Map(),
    load({ id, factory }) { this.entries.set(id, factory); },
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 900,
};

globalThis.document = {
  createElement() {
    return {
      style: {},
      textContent: '',
      setAttribute() {},
      appendChild() {},
      remove() {},
    };
  },
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
};

Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
});
globalThis.Element = class Element {};
globalThis.Node = class Node {};

const clientPath = path.join(root, 'client.js');
const source = fs.readFileSync(clientPath, 'utf8');
assert.ok(source.includes("window.__ModuleLoader__.load"), 'client.js uses the ModuleLoader contract');
assert.ok(!/\bconst MODULE_ID\b[\s\S]{0,40}\n(?!\s*\/\/)/.test(source.split('\n')[0] ?? ''), 'top-level bindings are wrapped');
assert.equal(typeof source, 'string');

// Execute the classic script. It registers exactly one factory.
new Function(source)();
const loader = window.__ModuleLoader__;
assert.ok(loader.entries.has('@restregular/dsh-powerup'), 'module id is registered');
const factory = loader.entries.get('@restregular/dsh-powerup');
assert.equal(typeof factory, 'function');

const portalCalls = [];
const ReactDOM = {
  createPortal(node, container) {
    portalCalls.push(container);
    return { portal: node, container };
  },
};
const requireStub = (id) => {
  if (id === 'react') return React;
  if (id === 'react-dom') return ReactDOM;
  throw new Error(`unexpected require: ${id}`);
};

let moduleExports;
let dictionary = null;
const registrations = [];
const effects = [];
const slots = {
  inject(_key, callback) {
    const disposer = callback();
    return () => { if (typeof disposer === 'function') disposer(); };
  },
  register(options, component) {
    registrations.push({ options, component });
    return () => {};
  },
};
const locale = {
  register(_ns, dicts) { dictionary = dicts; return () => {}; },
  bind() {
    return (key, params) => {
      const table = dictionary?.zh ?? {};
      const template = table[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
    };
  },
  subscribe() { return () => {}; },
};
const sessions = { fork: async () => 'child-session' };
const workspace = { openSession() {} };
const layout = { selectPanel() {} };
const pluginBundles = [
  { name: '@acme/dsh-widget', official: false, installed: true, enabled: true, removable: true, version: '1.2.3', availability: 'profile', rows: [] },
  { name: '@restregular/dsh-powerup', official: false, installed: true, enabled: true, removable: true, version: '0.1.0', availability: 'profile', rows: [] },
];
const fakeJobsState = {
  rows: {
    'session-1': [
      { id: 'bash-live', kind: 'bash', label: 'sleep 600', status: 'running', startedAt: 10 },
      { id: 'bash-done', kind: 'bash', label: 'git status', status: 'completed', startedAt: 5, finishedAt: 9 },
    ],
  },
  getSnapshot() { return { rows: this.rows, observed: {} }; },
  subscribe() { return () => {}; },
};
const fakeJobs = { state: fakeJobsState, kill() { throw new Error('not used in the smoke test'); } };
const pluginManager = {
  async listBundles() { return { ok: true, value: pluginBundles }; },
  async listPlugins() { return { ok: true, value: [] }; },
  async registries() {
    return { ok: true, value: { registry: null, fallbackRegistries: ['https://registry.npmmirror.com/'], resolved: 'https://registry.npmjs.org/' } };
  },
  async inspect() { return { ok: true, value: { status: 'accepted', kind: 'registry', bundle: true } }; },
  async removeBundle() { return { ok: true, value: { application: 'applied' } }; },
  async installBundle() { return { ok: true, value: { application: 'applied', bundle: '@acme/dsh-widget', version: '1.3.0' } }; },
  async setBundleEnabled() { return { ok: true, value: { application: 'applied' } }; },
};
const remote = { $on() { return () => {}; } };
const scopes = [];
const ctx = {
  get(name) {
    if (name === 'slots') return slots;
    if (name === 'locale') return locale;
    if (name === 'sessions') return sessions;
    if (name === 'uiWorkspace') return workspace;
    if (name === 'layout') return layout;
    return undefined;
  },
  inject(deps, callback) {
    const scope = {
      get(name) {
        if (name === 'remote.pluginManager') return pluginManager;
        if (name === 'remote') return remote;
        if (name === 'jobs') return fakeJobs;
        return ctx.get(name);
      },
      effect(fn, label) {
        return ctx.effect(fn, label);
      },
    };
    scopes.push({ deps, scope });
    const disposer = callback(scope);
    return typeof disposer === 'function' ? disposer : () => {};
  },
  effect(fn, label) {
    const cleanup = fn();
    effects.push({ label, cleanup });
    return cleanup;
  },
};

moduleExports = factory(requireStub);
assert.equal(typeof moduleExports.apply, 'function');
assert.deepEqual(moduleExports.inject, ['slots', 'locale']);
moduleExports.apply(ctx);

assert.equal(registrations.length, 7, 'seven slot registrations');
const bySlot = new Map(registrations.map((entry) => [entry.options.name, entry]));
for (const slot of ['sidebar.panellist', 'main', 'shell.overlay', 'conversation.session.header.utilities', 'conversation.hero.options']) {
  assert.ok(bySlot.has(slot), `registered ${slot}`);
}
assert.equal(bySlot.get('conversation.hero.options').options.id, 'powerup-prompts');
assert.equal(bySlot.get('sidebar.panellist').options.id, 'powerup');
assert.equal(bySlot.get('main').options.key, 'powerup');
const overlayIds = registrations.filter((entry) => entry.options.name === 'shell.overlay').map((entry) => entry.options.id).sort();
assert.deepEqual(overlayIds, ['powerup-context-menu', 'powerup-job-stop', 'powerup-plugin-update'], 'context menu, stop reason, and update overlay');
assert.ok(registrations.some((entry) => entry.options.id === 'powerup-plugin-update'), 'plugin update overlay registered');
assert.ok(scopes.some((entry) => entry.deps.includes('remote.pluginManager')), 'update overlay waits for the plugin manager remote');
assert.ok(scopes.some((entry) => entry.deps.includes('jobs')), 'stop overlay waits for the client jobs service');

// Sidebar icon: the host passes size/active; the component must stay a 16-grid
// currentColor line drawing.
resetHooks();
const iconHost = moduleExports.__test.PowerUpLineIcon({ size: 20 });
assert.equal(typeof iconHost.type, 'function');
const iconTree = iconHost.type(iconHost.props);
assert.equal(iconTree.type, 'svg');
assert.equal(iconTree.props.width, 20);
assert.equal(iconTree.props.viewBox, '0 0 16 16');
const iconChildren = iconTree.props.children;
assert.ok(iconChildren.some((child) => child?.props?.stroke === 'currentColor'));
assert.ok(!iconChildren.some((child) => child?.type === 'rect'), 'line icon has no tile frame');
assert.ok(!JSON.stringify(iconTree).includes('#'), 'line icon has no fixed color');

// Page renders with the default settings.
resetHooks();
const page = moduleExports.__test.PowerUpPage({ ctx });
assert.equal(page.type, 'div');
assert.ok(JSON.stringify(page).includes('dsh-powerup-hero'));
assert.ok(JSON.stringify(page).includes('dsh-powerup-card-detail'), 'the page exposes per-feature detail rows');
assert.ok(JSON.stringify(page).includes('dsh-powerup-setting'), 'the page exposes the one-click update defaults');

// Overlay renders nothing until a context menu opens, but the component body
// must be valid in the root overlay slot.
resetHooks();
const overlay = moduleExports.__test.PowerUpOverlay({ ctx });
assert.equal(overlay, null);

// Bridge renders nothing and publishes through its layout effect.
resetHooks();
const bridge = moduleExports.__test.PowerUpBridge({
  sessionId: 'session-1',
  useTrajectory: (selector) => selector({ requests: [], eventNodes: [] }),
  inputActions: {},
});
assert.equal(bridge, null);

// Hero prompt picker: renders a trigger, resolves the workspace, and fills or
// sends the prompt through the slot's inputActions. The management tab renders
// cards and a create form.
resetHooks();
const hero = moduleExports.__test.HeroPromptsControl({
  sessionId: 'session-1',
  inputActions: { setDraft() {}, submit() {}, persistDraft() {}, focus() {} },
  useWorkspaces: (selector) => selector({ items: [{ workspaceId: 'ws-1', sessionIds: ['session-1'] }] }),
});
assert.ok(hero !== null && hero.props.className.includes('dsh-powerup-prompt-trigger'), 'hero renders the trigger');
assert.ok(JSON.stringify(hero).includes('dsh-powerup-prompt-trigger-label'));
resetHooks();
const manager = moduleExports.__test.PromptManager({ ctx });
assert.ok(manager.type === 'div' || manager.type === undefined, 'manager renders a tree');

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
const { resolveForkSeq, markdownQuote, jsonSafe, rowKeyParts, DICT, CSS } = moduleExports.__test;

function rowWithKey(key) {
  return {
    getAttribute(name) {
      if (name === 'data-trajectory-row-key') return encodeURIComponent(key);
      if (name === 'data-kind') return key.split('\u0000')[0] ?? '';
      return null;
    },
    querySelector(selector) {
      if (selector === 'td:nth-child(2)') {
        return {
          querySelector: () => ({ getAttribute: () => 'hello\nworld' }),
          innerText: 'hello\nworld',
        };
      }
      if (selector === '[data-role-kind]') return { textContent: 'User' };
      return null;
    },
  };
}

const translate = (key) => DICT.en[key] ?? key;
const translateParams = (key, params) => {
  const template = DICT.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/gu, (match, name) => name in params ? String(params[name]) : match);
};

const assistantRow = rowWithKey(`assistant\u00003\u00002`);
assert.equal(
  resolveForkSeq(assistantRow, { requests: [{ purpose: 'assistant', turn: 3, step: 2, resultSeq: 42 }] }),
  42,
);
assert.equal(resolveForkSeq(rowWithKey(`tool\u0000seq\u000010`), {}), 10);
assert.equal(
  resolveForkSeq(rowWithKey(`tool\u0000call\u0000abc`), { eventNodes: [{ seq: 7, blocks: [{ callId: 'abc' }] }] }),
  7,
);
assert.equal(resolveForkSeq(rowWithKey(`tool\u0000index\u00005`), {}), null);

assert.equal(rowKeyParts(assistantRow).length, 3);
assert.equal(
  markdownQuote(rowWithKey(`user\u0000seq\u00009`), translate),
  '> **User**\n> hello\n> world',
);

// Step references: the copied string is session id + a resolvable step id.
assert.equal(moduleExports.__test.rowRecordId(assistantRow), 'assistant\u00003\u00002');
assert.equal(moduleExports.__test.rowStepId(assistantRow), 'turn.3.step.2');
assert.equal(moduleExports.__test.rowStepId(rowWithKey(`tool\u0000call\u0000call_abc`)), 'call.call_abc');
assert.equal(moduleExports.__test.rowStepId(rowWithKey(`tool\u0000seq\u000010`)), 'seq.10');
assert.equal(moduleExports.__test.rowStepId(rowWithKey(`user\u0000index\u00005`)), '');
assert.equal(
  moduleExports.__test.rowRecordId(rowWithKey(`assistant\u00003\u00002\u0000summary\u0000assistant`)),
  'assistant\u00003\u00002',
  'a folded summary suffix is not part of the record identity',
);
assert.equal(
  moduleExports.__test.rowStepReference('session-1', 'turn.3.step.2'),
  'dsh-step:session-1/turn.3.step.2',
);
assert.equal(moduleExports.__test.rowStepReference('', 'turn.3.step.2'), '');

const notices = [];
const rowItems = moduleExports.__test.buildRowItems(
  rowWithKey(`user\u0000index\u00005`),
  { requests: [], eventNodes: [] },
  translate,
  'session-1',
  ctx,
  (message) => notices.push(message),
);
assert.deepEqual(
  rowItems.filter((item) => item.type !== 'separator').map((item) => item.id),
  ['copy', 'quote', 'insert', 'inspect', 'fork', 'stepref', 'session'],
);
assert.equal(rowItems.find((item) => item.id === 'copy').label, 'Copy content');
assert.equal(rowItems.find((item) => item.id === 'fork').disabled, true);
assert.equal(rowItems.find((item) => item.id === 'stepref').label, 'Copy step reference');
assert.equal(rowItems.find((item) => item.id === 'stepref').disabled, true, 'index rows have no stable step id');
assert.equal(rowItems.find((item) => item.id === 'session').disabled, false);

const copied = [];
const savedClipboard = globalThis.navigator.clipboard;
Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: { writeText: async (value) => { copied.push(value); } },
  configurable: true,
});
const referenceItems = moduleExports.__test.buildRowItems(
  assistantRow,
  { requests: [{ purpose: 'assistant', turn: 3, step: 2, resultSeq: 42 }], eventNodes: [] },
  translate,
  'session-1',
  ctx,
  () => {},
);
const stepRefItem = referenceItems.find((item) => item.id === 'stepref');
assert.equal(stepRefItem.disabled, false);
await stepRefItem.run();
assert.deepEqual(copied, ['dsh-step:session-1/turn.3.step.2']);
Object.defineProperty(globalThis.navigator, 'clipboard', { value: savedClipboard, configurable: true });

const forkable = moduleExports.__test.buildRowItems(
  assistantRow,
  { requests: [{ purpose: 'assistant', turn: 3, step: 2, resultSeq: 42 }], eventNodes: [] },
  translate,
  'session-1',
  ctx,
  () => {},
);
assert.equal(forkable.find((item) => item.id === 'fork').disabled, false);
assert.equal(forkable.find((item) => item.id === 'fork').hint, 'inclusive');

const sessionItems = moduleExports.__test.buildSessionItems(undefined, undefined, translate, ctx, () => {});
assert.equal(sessionItems.find((item) => item.id === 'export').disabled, true);
assert.equal(sessionItems.find((item) => item.id === 'session').disabled, true);

const circular = { name: 'root', big: 10n, map: new Map([['k', 1]]), set: new Set([2]) };
circular.self = circular;
const safe = jsonSafe(circular, new Set());
assert.equal(safe.name, 'root');
assert.equal(safe.big, '10');
assert.equal(safe.map.k, 1);
assert.deepEqual(safe.set, [2]);
assert.equal(safe.self, '[circular]');

// Theme contract: no literal text/surface colors; the switch follows the host
// token convention remembered from dsh-memory (including label-primary-foreground).
assert.ok(CSS.includes('--dsw-alias-interactive-bg-hover'), 'hover token');
assert.ok(CSS.includes('--dsw-alias-switch-thumb'), 'switch thumb token');
assert.ok(CSS.includes('--dsw-alias-label-primary-foreground'), 'switch on-thumb token');
assert.ok(CSS.includes('--dsw-alias-brand-primary'), 'switch on-track token');
assert.ok(CSS.includes('--dsw-alias-label-primary'), 'primary text token');
assert.ok(!CSS.includes('body[data-ds-dark-theme]'), 'no manual dark-theme override');
assert.ok(!/background\s*:\s*#/.test(CSS), 'no literal background colors');
assert.ok(!/color\s*:\s*#/.test(CSS), 'no literal text colors');
assert.ok(CSS.includes('.dsh-powerup-update-option{box-sizing:border-box'), 'menu option padding is inside its width');
assert.ok(CSS.includes('.dsh-powerup-update-version{box-sizing:border-box'), 'version row padding is inside its width');
assert.ok(CSS.includes('overflow-x:hidden'), 'floating panels never scroll horizontally');
assert.ok(CSS.includes('.dsh-powerup-update-quick{'), 'the one-click button has its own accent style');
assert.ok(CSS.includes('.dsh-powerup-settings'), 'the page renders the one-click default rows');
assert.ok(CSS.includes('--dsw-alias-state-warn-label'), 'the one-click accent uses a host token');
assert.ok(CSS.includes('.dsh-powerup-jobstop{position:fixed;z-index:1400'), 'the stop panel sits above host popovers');
const stopRule = /\.dsh-powerup-jobstop\{([^}]*)\}/u.exec(CSS)?.[1] ?? '';
assert.ok(stopRule.includes('background:var(--dsw-alias-bg-layer-2)'), 'the stop panel uses the host dialog surface');
assert.ok(stopRule.includes('border-radius:var(--dsw-radius-panel)'), 'the stop panel uses the host panel radius');
assert.ok(stopRule.includes('box-shadow:var(--dsw-elevation-prominent)'), 'the stop panel uses the host dialog elevation');
assert.ok(
  /\.dsh-powerup-jobstop-confirm\{[^}]*border:\.5px solid color-mix\(in srgb,var\(--dsw-alias-state-error-primary\) 45%,transparent\)[^}]*background:color-mix\(in srgb,var\(--dsw-alias-state-error-primary\) 12%,transparent\)[^}]*color:var\(--dsw-alias-state-error-primary\)/u.test(CSS),
  'the stop confirm button reuses the host armed-stop treatment',
);
assert.ok(CSS.includes('--dsw-specific-menu'), 'the job kind chip uses the host menu token');
assert.ok(
  /\.dsh-powerup-jobstop-input\{[^}]*height:34px[^}]*border:\.5px solid var\(--dsw-alias-border-l4\)[^}]*border-radius:var\(--dsw-radius-md\)/u.test(CSS),
  'the reason input reuses the host input treatment',
);

// ---------------------------------------------------------------------------
// Sidebar launcher
// ---------------------------------------------------------------------------
const launcher = moduleExports.__test;

// The saved order/folders reconcile with the panels that exist right now.
assert.deepEqual(launcher.normalizeLauncherState(null, ['a', 'b', 'c']), { order: ['a', 'b', 'c'], groups: {} });
assert.deepEqual(
  launcher.normalizeLauncherState({ order: ['c'], groups: {} }, ['a', 'b', 'c']),
  { order: ['c', 'a', 'b'], groups: {} },
  'panels without a saved position are appended in host order',
);
const grouped = launcher.normalizeLauncherState(
  { order: ['b', 'group:g1'], groups: { g1: { id: 'g1', name: '工具', items: ['a', 'c'] } } },
  ['a', 'b', 'c'],
);
assert.deepEqual(grouped.order, ['b', 'group:g1']);
assert.deepEqual(grouped.groups.g1, { id: 'g1', name: '工具', items: ['a', 'c'] });
const cleaned = launcher.normalizeLauncherState(
  {
    order: ['missing', 'group:gone', 'a', 'a'],
    groups: { gone: { id: 'gone', name: '', items: [] }, kept: { id: 'kept', name: '', items: ['b', 'unknown', 'b'] } },
  },
  ['a', 'b'],
);
assert.deepEqual(cleaned.order, ['a', 'group:kept'], 'dropped folders and unknown panels leave the order, and a folder missing from it is restored');
assert.deepEqual(cleaned.groups.kept.items, ['b'], 'unknown and duplicate group members are dropped');
assert.deepEqual(launcher.normalizeLauncherState({ order: 'nope', groups: [] }, []), { order: [], groups: {} });

// The synthetic tiles (__more / __chat / __restart / __close) stay in the
// order and, exactly like host panels, can join a folder.
assert.equal(launcher.LAUNCHER_CHAT_KEY, '__chat');
assert.equal(launcher.LAUNCHER_RESTART_KEY, '__restart');
assert.equal(launcher.LAUNCHER_CLOSE_KEY, '__close');
assert.ok(launcher.LAUNCHER_RESTART_ICON.includes('<svg'), 'the restart tile ships its own glyph');
assert.ok(launcher.LAUNCHER_CLOSE_ICON.includes('<svg'), 'the close tile ships its own glyph');
const syntheticGrouped = launcher.normalizeLauncherState(
  { order: ['__chat'], groups: { g: { id: 'g', name: '操作', items: ['__more', '__restart', '__close'] } } },
  ['__chat', '__restart', '__close', '__more', 'a'],
);
assert.deepEqual(syntheticGrouped.groups.g.items, ['__more', '__restart', '__close'], 'synthetic tiles can join a folder');
assert.deepEqual(syntheticGrouped.order, ['__chat', 'a', 'group:g'], 'group members leave the grid order; the folder is kept');
const syntheticMixed = launcher.normalizeLauncherState(
  { order: ['a'], groups: { g: { id: 'g', name: '组', items: ['a', '__chat', '__more'] } } },
  ['__chat', '__close', '__more', 'a'],
);
assert.deepEqual(syntheticMixed.groups.g.items, ['a', '__chat', '__more']);
assert.deepEqual(syntheticMixed.order, ['__close', 'group:g'], 'unplaced tiles and a folder missing from the order are appended');
const unknownSynthetic = launcher.normalizeLauncherState(
  { order: ['a'], groups: { g: { id: 'g', name: '', items: ['a', '__ghost'] } } },
  ['__chat', 'a'],
);
assert.deepEqual(unknownSynthetic.groups.g.items, ['a'], 'unknown synthetic keys never become members');

// Ungroup expands the folder exactly where it sat, keeping member order.
assert.deepEqual(
  launcher.dissolveGroupOrder(['a', 'group:g', 'b'], 'group:g', ['x', 'y']),
  ['a', 'x', 'y', 'b'],
  'dissolving a folder inserts its members at the folder position, in folder order',
);
assert.deepEqual(
  launcher.dissolveGroupOrder(['a', 'b'], 'group:gone', ['x']),
  ['a', 'b', 'x'],
  'a folder missing from the order still appends its members',
);
assert.deepEqual(
  launcher.dissolveGroupOrder(['a', 'group:g', 'b'], 'group:g', ['__chat', 'a', 'x', 'x', '']),
  ['a', '__chat', 'x', 'b'],
  'synthetic members come back with their folder; duplicates and blank keys are skipped',
);
assert.deepEqual(launcher.dissolveGroupOrder(undefined, 'group:g', undefined), []);

// The core starts and stops safely without a real host sidebar.
const core = launcher.createLauncherCore({
  t: (key) => key,
  isEnabled: () => true,
  read: () => null,
  write: () => {},
  listPanels: () => [],
});
assert.equal(typeof core.start, 'function');
core.start();
core.sync();
core.stop();

// ---------------------------------------------------------------------------
// Host row shapes. 0.2.2 wraps every panel row in a cell element
// (div.panelEntry, plus its unpin overlay) and the More row in span.moreAnchor,
// so a row is no longer a direct button child of the panel list.
// ---------------------------------------------------------------------------
const COMPOUND_ATTR = /\[([a-zA-Z-]+)(?:(\*?=)"([^"]*)")?\]/gu;
const COMPOUND_NOT = /:not\(([^)]*)\)/gu;

function classListOf(node) {
  return {
    contains: (name) => node.className.split(/\s+/u).includes(name),
    add: (name) => { node.className = `${node.className} ${name}`.trim(); },
    remove: (name) => { node.className = node.className.split(/\s+/u).filter((part) => part !== name).join(' '); },
  };
}

function attributeValue(node, name) {
  if (name === 'class') return node.className;
  return node.attrs[name];
}

/** Parse one compound selector (`tag[a][b*="c"]:not([d])`) into a matcher. */
function parseCompound(text) {
  const notParts = [];
  for (const match of text.matchAll(COMPOUND_NOT)) notParts.push(parseCompound(match[1]));
  const bare = text.replace(COMPOUND_NOT, '');
  const tagMatch = /^[a-zA-Z][\w-]*/u.exec(bare);
  const tag = tagMatch === null ? null : tagMatch[0].toUpperCase();
  const tests = [];
  for (const match of bare.matchAll(COMPOUND_ATTR)) {
    const [, name, operator, value] = match;
    if (operator === undefined) tests.push((node) => attributeValue(node, name) !== undefined);
    else if (operator === '*=') tests.push((node) => (attributeValue(node, name) ?? '').includes(value));
    else tests.push((node) => attributeValue(node, name) === value);
  }
  return { tag, tests, notParts };
}

function nodeMatches(node, compound) {
  if (compound.tag !== null && node.tag !== compound.tag) return false;
  if (!compound.tests.every((test) => test(node))) return false;
  return !compound.notParts.some((part) => nodeMatches(node, part));
}

function descendantsOf(node) {
  const found = [];
  for (const child of node.children) found.push(child, ...descendantsOf(child));
  return found;
}

class FakeNode {
  constructor(tag, className = '') {
    this.tag = tag.toUpperCase();
    this.tagName = this.tag;
    this.className = className;
    this.attrs = {};
    this.children = [];
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.classList = classListOf(this);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    if (name === 'class') this.className = String(value);
    else this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return name === 'class' ? this.className : this.attrs[name] ?? null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    if (name === 'class') this.className = '';
    else delete this.attrs[name];
  }

  querySelector(selector) {
    for (const part of selector.split(',')) {
      const trimmed = part.trim();
      const scoped = trimmed.startsWith(':scope >');
      const compound = parseCompound(scoped ? trimmed.slice(8).trim() : trimmed);
      const pool = scoped ? this.children : descendantsOf(this);
      for (const node of pool) {
        if (nodeMatches(node, compound)) return node;
      }
    }
    return null;
  }
}

/** Build the 0.2.2+ sidebar shape: cell wrappers around row buttons. */
function buildHostNav(labels, { moreLabel = '更多' } = {}) {
  const nav = new FakeNode('nav', 'wtg9ga_panelList');
  const rows = [];
  labels.forEach((label, index) => {
    const cell = new FakeNode('div', index === 0 ? 'wtg9ga_panelEntry wtg9ga_panelEntryWide' : 'wtg9ga_panelEntry wtg9ga_panelEntryWide');
    const row = new FakeNode('button', 'wtg9ga_panelRow');
    row.setAttribute('aria-label', label);
    row.appendChild(new FakeNode('span', 'wtg9ga_panelGlyph'));
    row.appendChild(new FakeNode('span', 'wtg9ga_panelTitle wtg9ga_wide'));
    cell.appendChild(row);
    if (index > 0) {
      const unpin = new FakeNode('button', 'wtg9ga_panelUnpin');
      unpin.setAttribute('aria-label', `取消固定 ${label}`);
      cell.appendChild(unpin);
    }
    nav.appendChild(cell);
    rows.push({ cell, row });
  });
  const anchor = new FakeNode('span', '_root_70kcw_1 wtg9ga_moreAnchor');
  const moreRow = new FakeNode('button', 'wtg9ga_panelRow');
  moreRow.setAttribute('aria-label', moreLabel);
  moreRow.setAttribute('aria-haspopup', 'menu');
  moreRow.setAttribute('aria-expanded', 'false');
  moreRow.appendChild(new FakeNode('span', 'wtg9ga_panelGlyph'));
  moreRow.appendChild(new FakeNode('span', 'wtg9ga_panelTitle'));
  anchor.appendChild(moreRow);
  nav.appendChild(anchor);
  return { nav, rows, anchor, moreRow };
}

const hostLabels = ['插件', '技能中心', '插件市场', '随身访问', '自动化任务', '记忆系统', 'Power-Up'];
const hostIds = ['plugins', 'skill-center', 'dsh-market', 'pocket', 'schedules', 'memory', 'powerup'];
const shaped = buildHostNav(hostLabels);
const shapedCore = launcher.createLauncherCore({
  t: (key) => key,
  isEnabled: () => true,
  read: () => null,
  write: () => {},
  listPanels: () => hostLabels.map((label, index) => ({ id: hostIds[index], label })),
});
const shapedTiles = shapedCore.__debug.collectHostTiles(shaped.nav);
assert.equal(shapedTiles.length, hostLabels.length + 1, 'every host row becomes a tile, including More');
assert.deepEqual(
  shapedTiles.map((tile) => tile.key),
  [...hostIds, launcher.LAUNCHER_MORE_KEY],
  'panel rows keep their slot ids and only the menu row is More',
);
assert.equal(shapedTiles.filter((tile) => tile.isMore).length, 1, 'exactly one row is the More launcher');
assert.equal(shapedTiles.at(-1).isMore, true);
assert.equal(shapedTiles.at(-1).gridEl, shaped.anchor, 'the More cell is the wrapper, not the row button');
assert.equal(shapedTiles[0].gridEl, shaped.rows[0].cell, 'a panel cell is the wrapper that holds the unpin overlay');
assert.equal(shapedTiles[0].buttonEl, shaped.rows[0].row, 'the row button stays the click target');
assert.equal(shaped.rows[0].cell.getAttribute('data-powerup-grid'), 'plugins', 'the cell carries the grid key');
assert.equal(shaped.rows[0].cell.hasAttribute('data-powerup-more'), false, 'panel cells are not marked as More');
assert.equal(shaped.anchor.hasAttribute('data-powerup-more'), true, 'the menu cell is marked as More');
assert.equal(shapedCore.__debug.detectWide(shapedTiles), true, 'a labelled cell row is the wide sidebar');
assert.equal(shapedCore.__debug.rowOpensMenu(shaped.rows[0].row, shaped.rows[0].cell), false, 'a plain row is not a menu');
assert.equal(shapedCore.__debug.rowOpensMenu(shaped.moreRow, shaped.anchor), true, 'aria-haspopup marks the menu row');

// A row button without the wrapper class still resolves through the menu attrs.
const bareMore = new FakeNode('button', 'panelRow');
bareMore.setAttribute('aria-label', 'More');
bareMore.setAttribute('aria-haspopup', 'menu');
const bareNav = new FakeNode('nav', 'wtg9ga_panelList');
bareNav.appendChild(bareMore);
const bareTiles = shapedCore.__debug.collectHostTiles(bareNav);
assert.equal(bareTiles.length, 1);
assert.equal(bareTiles[0].key, launcher.LAUNCHER_MORE_KEY, 'a bare menu button is still More');
assert.equal(bareTiles[0].gridEl, bareMore, 'a bare row is its own grid cell');

// The launcher stylesheet keeps the adaptive column rule and the flyout layer.
assert.ok(launcher.LAUNCHER_CSS.includes('repeat(auto-fill,minmax(58px,1fr))'), 'the grid derives columns from the sidebar width');
assert.ok(launcher.LAUNCHER_CSS.includes('flex-direction:column'), 'tiles stack the icon above the label');
assert.ok(launcher.LAUNCHER_CSS.includes('.dsh-powerup-folder-pop{position:fixed'), 'the folder flyout floats above the sidebar');
assert.ok(launcher.LAUNCHER_CSS.includes('.dsh-powerup-drag-ghost'), 'drag feedback keeps a ghost tile');
assert.ok(launcher.LAUNCHER_CSS.includes('.dsh-powerup-synth{'), 'the synthetic chat/restart tiles share one grid style');
assert.ok(launcher.LAUNCHER_CSS.includes('.dsh-powerup-synth-label'), 'synthetic tiles keep their stacked caption');
// The grid styles the cell (the wrapper that also holds the unpin overlay) and
// the row button inside it, because 0.2.2 rows are no longer direct children.
assert.ok(launcher.LAUNCHER_CSS.includes('>[data-powerup-grid]'), 'grid cells are keyed on the wrapper marker, not on a bare row');
assert.ok(launcher.LAUNCHER_CSS.includes('[class*="panelUnpin"]{display:none!important}'), 'the unpin overlay is hidden inside the grid');
assert.ok(launcher.LAUNCHER_CSS.includes('>[data-powerup-grid]>button:not([class*="panelUnpin"])'), 'the row button inside a cell becomes the tile face');
assert.ok(!launcher.LAUNCHER_CSS.includes('>[data-powerup-more]>button'), 'no rule still assumes a bare button row');
for (const key of ['page.launcherTitle', 'page.launcherDesc', 'page.launcherToggle', 'page.launcherToggleHint', 'launcher.groupDefault', 'launcher.count', 'launcher.renameHint', 'launcher.dissolve', 'launcher.removeItem', 'launcher.backToConversation', 'launcher.restart', 'launcher.restartHint', 'launcher.close', 'launcher.closeHint', 'close.title', 'close.desc', 'close.cancel', 'close.confirm', 'close.closing', 'close.failed', 'close.unsupported']) {
  assert.ok(DICT.zh[key] !== undefined, `zh dictionary has ${key}`);
  assert.ok(DICT.en[key] !== undefined, `en dictionary has ${key}`);
}

// ---------------------------------------------------------------------------
// Session title switcher
// ---------------------------------------------------------------------------
const switcher = moduleExports.__test;

// Only host-reported running sessions appear, in host list order; the current
// session is flagged and falls back through title -> displayTitle -> id.
assert.deepEqual(
  switcher.runningSessionRows({
    ids: ['a', 'b', 'c', 'd'],
    byId: {
      a: { running: true, displayTitle: 'Alpha' },
      b: { running: false, displayTitle: 'Beta' },
      c: { running: true, title: 'Gamma title', displayTitle: '' },
      d: { running: true },
    },
  }, 'c'),
  [
    { id: 'a', title: 'Alpha', current: false },
    { id: 'c', title: 'Gamma title', current: true },
    { id: 'd', title: 'd', current: false },
  ],
  'idle sessions are excluded and titles fall back sensibly',
);
assert.deepEqual(switcher.runningSessionRows(null, undefined), [], 'a missing snapshot yields no rows');
assert.deepEqual(
  switcher.runningSessionRows({ ids: ['x', 'x'], byId: { x: { running: true, displayTitle: 'X' } } }, undefined),
  [{ id: 'x', title: 'X', current: false }],
  'duplicate ids are emitted once',
);

// The switcher stylesheet floats above host popovers, uses only theme tokens,
// and marks the title as clickable without a fixed text colour.
assert.ok(switcher.SESSION_SWITCH_CSS.includes('[data-powerup-session-title]{cursor:pointer'), 'the title advertises a pointer cursor');
assert.ok(switcher.SESSION_SWITCH_CSS.includes('.dsh-powerup-session-pop{position:fixed;z-index:1500'), 'the dropdown floats above host popovers');
assert.ok(switcher.SESSION_SWITCH_CSS.includes('background:var(--dsw-alias-bg-layer-2)'), 'the dropdown uses the host dialog surface');
assert.ok(switcher.SESSION_SWITCH_CSS.includes('border-radius:var(--dsw-radius-panel'), 'the dropdown uses the host panel radius');
assert.ok(switcher.SESSION_SWITCH_CSS.includes('--dsw-elevation-stroke-color'), 'the dropdown uses the host elevation stroke');
assert.ok(switcher.SESSION_SWITCH_CSS.includes('gap:4px'), 'session options have spacing');
assert.ok(!/color\s*:\s*#/.test(switcher.SESSION_SWITCH_CSS), 'no literal text colours');

// Workspace prefix + truncation: options read "<workspace> · <title>", capped
// at 40 code points with an ellipsis and never splitting an astral emoji.
const workspaceOf = (id) => id === 'a' ? '研究项目' : '';
assert.deepEqual(
  switcher.runningSessionRows({
    ids: ['a', 'b'],
    byId: { a: { running: true, displayTitle: 'Alpha' }, b: { running: true, displayTitle: 'Beta' } },
  }, undefined, workspaceOf),
  [
    { id: 'a', title: '研究项目 · Alpha', current: false },
    { id: 'b', title: 'Beta', current: false },
  ],
  'known workspaces prefix the label, unknown ones fall back to the bare title',
);
const longLabel = switcher.runningSessionRows(
  { ids: ['x'], byId: { x: { running: true, displayTitle: '标题'.repeat(60) } } },
  undefined,
  () => '工作区',
)[0].title;
assert.ok([...longLabel].length <= 40, 'the option label is truncated to the max length');
assert.ok(longLabel.endsWith('\u2026'), 'a truncated label ends with an ellipsis');
assert.deepEqual(
  switcher.buildWorkspaceIndex(
    { items: [
      { workspaceId: 'w1', title: 'Alpha', sessionIds: ['s1'], path: '/x/alpha' },
      { workspaceId: 'w2', title: 'default-workspace', sessionIds: [], path: '/x/default-workspace' },
    ] },
    (title) => title === 'default-workspace' ? 'Default' : title,
  ),
  { bySession: { s1: 'Alpha' }, byPath: { alpha: 'Alpha', 'default-workspace': 'Default' } },
  'workspaces index by session id and normalized path leaf, mapping the default name',
);
for (const key of ['sessionSwitch.title', 'sessionSwitch.empty', 'sessionSwitch.hint']) {
  assert.ok(DICT.zh[key] !== undefined, `zh dictionary has ${key}`);
  assert.ok(DICT.en[key] !== undefined, `en dictionary has ${key}`);
}

// The core starts/stops safely without a real header; clicking a synthetic
// title builds a dropdown of the supplied rows and delegates the selection.
const openedSessions = [];
let switchCore;
switchCore = switcher.createSessionSwitcherCore({
  t: (key) => DICT.en[key] ?? key,
  listRows: () => [
    { id: 'session-1', title: 'One', current: false },
    { id: 'session-2', title: 'Two', current: false },
  ],
  openSession: (id) => { openedSessions.push(id); },
});
assert.equal(typeof switchCore.start, 'function');
assert.equal(typeof switchCore._runningSessionRows, 'function');

// An open dropdown survives host re-renders: it re-anchors onto the replaced
// title instead of closing, and only a real view switch (no title left) or an
// outside click dismisses it. This mirrors the host's own background-jobs
// popover, which streams content without closing.
{
  const handlers = { document: new Map(), window: new Map() };
  const listen = (map) => (type, fn) => {
    const list = map.get(type) ?? [];
    list.push(fn);
    map.set(type, list);
  };
  const unlisten = (map) => (type, fn) => {
    map.set(type, (map.get(type) ?? []).filter((entry) => entry !== fn));
  };
  const fire = (map, type, event) => {
    for (const fn of [...(map.get(type) ?? [])]) fn(event);
  };
  const header = { tag: 'HEADER', attrs: { 'data-window-drag': '' } };
  const makeTitle = (sessionId) => {
    const title = {
      isConnected: true,
      header,
      className: 'host_crumbCurrent',
      attrs: { 'data-powerup-session-title': '' },
      style: {},
      classList: { add() {}, remove() {} },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      getAttribute(name) { return this.attrs[name] ?? null; },
      hasAttribute(name) { return name in this.attrs; },
      getBoundingClientRect: () => ({ left: 320, top: 12, right: 520, bottom: 36, width: 200, height: 24 }),
      contains: () => false,
      closest(selector) {
        if (selector === '[data-powerup-session-title]') return this;
        if (selector === 'nav[class*="crumbs"]') return { tag: 'nav' };
        if (selector === 'header[data-window-drag]') return this.header;
        if (selector === '[data-conversation-session]') return { getAttribute: () => sessionId };
        return null;
      },
    };
    return title;
  };
  let titles = [];
  let currentId = 'session-1';
  let headerNodes = [header];
  let rows = [{ id: 'session-2', title: 'Two', current: false }];
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  const savedRaf = globalThis.requestAnimationFrame;
  const savedObserver = globalThis.MutationObserver;
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
  globalThis.MutationObserver = undefined;
  globalThis.window = {
    ...savedWindow,
    innerWidth: 1280,
    innerHeight: 900,
    addEventListener: listen(handlers.window),
    removeEventListener: unlisten(handlers.window),
    setTimeout: (fn) => { fn(); return 0; },
  };
  globalThis.document = {
    ...savedDocument,
    body: {
      appendChild(node) { node.isConnected = true; },
    },
    createElement: () => ({
      className: '',
      style: {},
      children: [],
      isConnected: false,
      classList: { add() {}, remove() {} },
      setAttribute() {},
      getAttribute() { return null; },
      appendChild(child) { this.children.push(child); },
      append() { for (const child of arguments) this.children.push(child); },
      addEventListener() {},
      contains: () => false,
      remove() { this.isConnected = false; },
    }),
    querySelectorAll: (selector) => (selector === 'header[data-window-drag]'
      ? headerNodes.map(() => ({ querySelectorAll: () => titles }))
      : []),
    querySelector: (selector) => (selector === '[data-conversation-session]'
      ? { getAttribute: () => currentId }
      : null),
    addEventListener: listen(handlers.document),
    removeEventListener: unlisten(handlers.document),
  };

  const core = switcher.createSessionSwitcherCore({
    t: (key) => DICT.en[key] ?? key,
    currentSessionId: () => currentId,
    listRows: () => rows,
    openSession: () => {},
  });
  titles = [makeTitle('session-1')];
  core.start();
  assert.equal(core.getMarked().length, 1, 'the live title is marked');

  fire(handlers.document, 'click', {
    button: 0,
    clientX: 400,
    clientY: 24,
    target: titles[0],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(core.getPopup() !== null, 'clicking the title opens the dropdown');
  const firstAnchor = core.getPopup().anchor;

  // The host re-renders the crumb: a new node, same session, plus churn.
  titles[0].isConnected = false;
  const replacement = makeTitle('session-1');
  titles = [replacement];
  core.sync();
  assert.ok(core.getPopup() !== null, 'a host re-render keeps the dropdown open');
  assert.equal(core.getPopup().anchor, replacement, 'the dropdown re-anchors onto the new title');

  // A session starting or stopping changes the rows: the open panel follows
  // the new list instead of being closed and reopened.
  const savedNow = Date.now;
  let clock = savedNow();
  Date.now = () => clock;
  rows = [
    { id: 'session-2', title: 'Two', current: false },
    { id: 'session-3', title: 'Three', current: false },
  ];
  clock += 1000;
  core.sync();
  assert.equal(core.getPopup().rows.length, 2, 'a running session appears in the open list');
  Date.now = savedNow;

  // A switch to another session is a view switch: the dropdown closes.
  currentId = 'session-2';
  titles = [makeTitle('session-2')];
  core.sync();
  assert.equal(core.getPopup(), null, 'switching sessions closes the dropdown');

  // Reopen, then an outside press closes it as before.
  titles = [makeTitle('session-2')];
  core.sync();
  fire(handlers.document, 'click', {
    button: 0,
    clientX: 400,
    clientY: 24,
    target: titles[0],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(core.getPopup() !== null);
  fire(handlers.document, 'pointerdown', { target: { closest: () => null, contains: () => false } });
  assert.equal(core.getPopup(), null, 'an outside press still dismisses the dropdown');

  // Streaming content scrolls the transcript; that must not dismiss either.
  titles = [makeTitle('session-2')];
  core.sync();
  fire(handlers.document, 'click', {
    button: 0,
    clientX: 400,
    clientY: 24,
    target: titles[0],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(core.getPopup() !== null);
  fire(handlers.window, 'scroll', { target: { closest: () => null, contains: () => false } });
  assert.ok(core.getPopup() !== null, 'scrolling the transcript keeps the dropdown open');

  // The header itself disappears (session closed / another view): this is a
  // real switch, so the retries run out and the dropdown closes.
  const gone = core.getPopup().anchor;
  gone.isConnected = false;
  titles = [];
  core.sync();
  assert.equal(core.getPopup(), null, 'a vanished header closes the dropdown');

  // A title click is a toggle, never a reopen of a replaced anchor.
  titles = [makeTitle('session-2')];
  core.sync();
  fire(handlers.document, 'click', {
    button: 0,
    clientX: 400,
    clientY: 24,
    target: titles[0],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.ok(core.getPopup() !== null);
  fire(handlers.document, 'click', {
    button: 0,
    clientX: 400,
    clientY: 24,
    target: titles[0],
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(core.getPopup(), null, 'a second title click closes the dropdown');
  assert.ok(firstAnchor !== replacement);
  core.stop();
  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
  globalThis.requestAnimationFrame = savedRaf;
  globalThis.MutationObserver = savedObserver;
}

// Workspace locate button: starts/stops safely, and the locate glyph is a
// currentColor line drawing (no fixed color) like the other host icons.
const locateCore = switcher.createLocateSessionCore({
  t: (key) => key,
  currentSessionId: () => 'session-1',
  isEnabled: () => true,
});
assert.equal(typeof locateCore.start, 'function');
assert.equal(typeof locateCore.locate, 'function');
locateCore.start();
locateCore.locate();
locateCore.stop();
const locateIcon = switcher.LocateIcon({ size: 18 });
assert.equal(typeof locateIcon.type, 'function');
const locateTree = locateIcon.type(locateIcon.props);
assert.equal(locateTree.type, 'svg');
assert.equal(locateTree.props.width, 18);
assert.ok(JSON.stringify(locateTree).includes('currentColor'), 'locate icon inherits the host color');
assert.ok(switcher.LOCATE_CSS.includes('[data-sidebar-workspace-header] .dsh-powerup-locate'), 'locate button anchors on the workspace header');
// The host clips the toolbar action row at 60px (two 28px buttons + 4px gap),
// which hides a third button entirely; the marker must lift that cap but not
// fight the host's search-expanded collapse.
assert.ok(
  switcher.LOCATE_CSS.includes('[data-powerup-locate-actions]:not([class*="headerActionsHidden"]){max-width:none}'),
  'the marked action row is widened so the locate button stays visible',
);
assert.ok(
  !/\[data-powerup-locate-actions\][^{]*\{max-width:none[^}]*!important/.test(switcher.LOCATE_CSS),
  'the widening does not use !important against host styles',
);

// The button marks its action row so the widening rule can reach it, and the
// marker leaves with the button (no stale marker on a re-rendered row).
const markerWrites = [];
const fakeRow = {
  attributes: new Map(),
  children: [],
  setAttribute(name, value) {
    this.attributes.set(name, value);
    markerWrites.push(['set', name, value]);
  },
  removeAttribute(name) {
    this.attributes.delete(name);
    markerWrites.push(['remove', name]);
  },
  hasAttribute(name) {
    return this.attributes.has(name);
  },
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    child.isConnected = true;
  },
  querySelector: () => null,
};
const fakeHeader = { querySelector: (sel) => (sel.includes('headerActions') ? fakeRow : null) };
const realDocument = globalThis.document;
globalThis.document = {
  ...realDocument,
  querySelector: (sel) => (sel === '[data-sidebar-workspace-header]' ? fakeHeader : null),
  createElement: () => ({
    style: {},
    textContent: '',
    setAttribute() {},
    addEventListener() {},
    remove() { this.isConnected = false; },
  }),
};
const markedCore = switcher.createLocateSessionCore({
  t: (key) => key,
  currentSessionId: () => 'session-1',
  isEnabled: () => true,
});
markedCore.start();
assert.equal(fakeRow.attributes.get('data-powerup-locate-actions'), '', 'the action row is marked');
assert.equal(fakeRow.children.length, 1, 'the locate button is appended to the action row');
markedCore.stop();
assert.equal(fakeRow.attributes.has('data-powerup-locate-actions'), false, 'stopping removes the marker');
globalThis.document = realDocument;

// ---------------------------------------------------------------------------
// Plugin update helpers
// ---------------------------------------------------------------------------
const update = moduleExports.__test;

// Every feature defaults on; a stored false (from older settings or the page
// switches) wins. The legacy `enabled` flag migrates to `contextMenu`.
const ALL_ON_SETTINGS = {
  contextMenu: true, launcher: true, sessionSwitch: true, jobStop: true,
  update: true, locateSession: true, workspacePrompts: true,
  oneClickEnable: true, oneClickRestart: true,
};
const savedGetItem = globalThis.localStorage.getItem;
globalThis.localStorage.getItem = () => null;
assert.deepEqual(update.readSettings(), ALL_ON_SETTINGS);
globalThis.localStorage.getItem = () => '{"enabled":false}';
assert.deepEqual(update.readSettings(), { ...ALL_ON_SETTINGS, contextMenu: false }, 'the legacy enabled flag migrates to contextMenu');
globalThis.localStorage.getItem = () => JSON.stringify({
  contextMenu: false, launcher: false, sessionSwitch: false, jobStop: false,
  update: false, locateSession: false, workspacePrompts: false,
  oneClickEnable: false, oneClickRestart: false,
});
assert.deepEqual(update.readSettings(), {
  contextMenu: false, launcher: false, sessionSwitch: false, jobStop: false,
  update: false, locateSession: false, workspacePrompts: false,
  oneClickEnable: false, oneClickRestart: false,
});
globalThis.localStorage.getItem = savedGetItem;

// Workspace prompts: storage shape, scoping, label fallback, and workspace
// resolution from the live workspace snapshot.
{
  const store = update;
  const savedSetItem = globalThis.localStorage.setItem;
  const savedGet = globalThis.localStorage.getItem;
  let stored = '[]';
  globalThis.localStorage.getItem = (key) => (key === store.PROMPTS_KEY ? stored : null);
  globalThis.localStorage.setItem = (key, value) => { if (key === store.PROMPTS_KEY) stored = value; };
  assert.deepEqual(store.readPrompts(), [], 'prompts default to an empty list');
  const list = [
    { id: 'a', title: 'Build', text: 'do the build', workspaceId: 'ws-1' },
    { id: 'b', title: '', text: 'a fairly long reusable prompt body', workspaceId: '' },
    { id: 'c', title: 'Other', text: 'other workspace', workspaceId: 'ws-2' },
    { id: '', title: 'Missing id', text: 'x', workspaceId: 'ws-1' },
  ];
  globalThis.localStorage.getItem = (key) => (key === store.PROMPTS_KEY ? JSON.stringify(list) : null);
  const parsed = store.readPrompts();
  assert.equal(parsed.length, 4, 'malformed ids are regenerated, records retained');
  assert.ok(parsed[3].id.length > 0);
  assert.deepEqual(store.promptsForWorkspace(parsed, 'ws-1').map((p) => p.id), ['a', 'b', parsed[3].id], 'global + matching workspace only');
  assert.deepEqual(store.promptsForWorkspace(parsed, 'ws-3').map((p) => p.id), ['b'], 'global prompt visible everywhere');
  const t = (key) => ({ 'prompts.summaryFallback': 'Untitled prompt' })[key] ?? key;
  assert.equal(store.promptLabel(parsed[0], t), 'Build', 'title wins');
  assert.equal(store.promptLabel(parsed[1], t), 'a fairly long reus…', 'body is truncated to first characters');
  assert.equal(store.promptLabel({ title: '', text: '' }, t), 'Untitled prompt', 'fallback label');
  const snapshot = { items: [{ workspaceId: 'ws-9', sessionIds: ['s-1'] }, { workspaceId: 'ws-2', sessionIds: ['s-2'] }] };
  assert.equal(store.resolveWorkspaceIdFromSnapshot(snapshot, 's-1'), 'ws-9');
  assert.equal(store.resolveWorkspaceIdFromSnapshot(snapshot, 'unknown'), '');
  store.writePrompts([list[0]]);
  assert.equal(JSON.parse(stored).length, 1, 'writePrompts persists');
  globalThis.localStorage.getItem = savedGet;
  globalThis.localStorage.setItem = savedSetItem;
}

// Both install paths use the version in the dialog input, so reinstall and
// downgrade are allowed; only a concrete version enables the action.
assert.equal(update.installVersion({ version: '2.1.0' }), '2.1.0');
assert.equal(update.installVersion({ version: 'v1.2.3' }), '1.2.3');
assert.equal(update.installVersion({ version: '' }), '');
assert.equal(update.installVersion({ version: 'latest' }), '');
assert.equal(update.installVersion({}), '');
const usedUpdateKeys = new Set([...source.matchAll(/t\('(update\.[A-Za-z.]+)'/gu)].map((match) => match[1]));
for (const key of usedUpdateKeys) {
  assert.ok(DICT.zh[key] !== undefined, `zh dictionary has ${key}`);
  assert.ok(DICT.en[key] !== undefined, `en dictionary has ${key}`);
}
const usedRestartKeys = new Set([...source.matchAll(/t\('(restart\.[A-Za-z.]+)'/gu)].map((match) => match[1]));
for (const key of usedRestartKeys) {
  assert.ok(DICT.zh[key] !== undefined, `zh dictionary has ${key}`);
  assert.ok(DICT.en[key] !== undefined, `en dictionary has ${key}`);
}
for (const key of [
  'page.oneClickTitle', 'page.oneClickDesc', 'page.oneClickEnable', 'page.oneClickEnableHint',
  'page.oneClickRestart', 'page.oneClickRestartHint',
  'update.oneClick', 'update.oneClickTitle', 'update.oneClickHint', 'update.oneClickDefaults',
  'update.doneAutoClose', 'update.oneClickNoVersion',
  'update.oneClickEnableFailed', 'update.oneClickSkippedEnable', 'update.on', 'update.off',
  'action.stepRef', 'action.stepRefHint', 'menu.stepRef', 'menu.noStepRef', 'toast.stepRefCopied',
]) {
  assert.ok(DICT.zh[key] !== undefined, `zh dictionary has ${key}`);
  assert.ok(DICT.en[key] !== undefined, `en dictionary has ${key}`);
}
assert.deepEqual(
  update.sortVersions(['1.0.0', '1.10.0', '1.2.0', '1.2.0-beta.1', '1.2.0-beta.2', 'not-a-version']),
  ['1.10.0', '1.2.0', '1.2.0-beta.2', '1.2.0-beta.1', '1.0.0', 'not-a-version'],
);
assert.equal(update.versionTagKind('1.0.0', '1.0.0', '1.0.0'), 'current-latest', 'one combined tag when current is latest');
assert.equal(update.versionTagKind('1.0.0', '1.0.0', '2.0.0'), 'current');
assert.equal(update.versionTagKind('2.0.0', '1.0.0', '2.0.0'), 'latest');
assert.equal(update.versionTagKind('1.5.0', '1.0.0', '2.0.0'), null);

const belowAnchor = { getBoundingClientRect: () => ({ left: 100, top: 300, bottom: 338, width: 300, height: 38 }) };
const below = update.popoverPlacement(belowAnchor, 280, 260);
assert.equal(below.left, 100);
assert.equal(below.width, 300);
assert.equal(below.top, 344, 'panel sits 6px below the anchor');
assert.ok(below.maxHeight >= 120);
const aboveAnchor = { getBoundingClientRect: () => ({ left: 100, top: 800, bottom: 838, width: 300, height: 38 }) };
const above = update.popoverPlacement(aboveAnchor, 280, 260);
assert.equal(above.top, undefined, 'panel flips above near the viewport bottom');
assert.ok(above.bottom > 0);
assert.equal(update.normalizeRegistry('https://registry.example.com'), 'https://registry.example.com/');
assert.equal(update.registryHost('https://registry.npmmirror.com/'), 'registry.npmmirror.com');

const registryChoices = update.buildRegistryChoices(
  { registry: null, fallbackRegistries: ['https://registry.npmmirror.com/'], resolved: 'https://registry.npmjs.org/' },
  { kind: 'custom', url: 'https://npm.example.com' },
  null,
  translate,
);
assert.equal(registryChoices.length, 3);
assert.equal(registryChoices[0].value, null);
assert.equal(registryChoices[1].label, 'Mainland China mirror');
assert.equal(registryChoices[2].hint, 'npm.example.com');
const picked = update.pickRegistryChoice(registryChoices, { kind: 'custom', url: 'https://npm.example.com/' }, null);
assert.equal(picked.key, 'https://npm.example.com/');
assert.equal(update.lookupRegistries(registryChoices, registryChoices[1]).length, 3);

const starredDefault = { key: 'default', value: null, url: 'https://registry.npmjs.org/', label: 'Default registry', hint: 'registry.npmjs.org' };
const starredChoices = update.buildRegistryChoices(
  { registry: null, fallbackRegistries: ['https://registry.npmmirror.com/'], resolved: 'https://registry.npmjs.org/' },
  { kind: 'custom', url: 'https://npm.example.com' },
  starredDefault,
  translate,
);
const starredPick = update.pickRegistryChoice(starredChoices, { kind: 'custom', url: 'https://npm.example.com/' }, starredDefault);
assert.equal(starredPick.value, null, 'the starred default wins over the Add dialog memory');
assert.equal(update.matchStoredChoice(starredChoices, starredDefault)?.key, 'default');

globalThis.localStorage.getItem = () => '{"kind":"offered","registry":null}';
assert.deepEqual(update.readRememberedRegistry(), { kind: 'offered', registry: null });
globalThis.localStorage.getItem = () => JSON.stringify(starredDefault);
assert.deepEqual(update.readDefaultRegistry(), starredDefault);
update.writeDefaultRegistry(starredDefault);
globalThis.localStorage.getItem = () => 'not json';
assert.equal(update.readRememberedRegistry(), null);
assert.equal(update.readDefaultRegistry(), null);
globalThis.localStorage.getItem = () => null;

const originalFetch = globalThis.fetch;
let requestedUrl = null;
globalThis.fetch = async (url) => {
  requestedUrl = String(url);
  return {
    ok: true,
    async json() {
      return { versions: { '1.0.0': {}, '2.0.0': {} }, 'dist-tags': { latest: '2.0.0' } };
    },
  };
};
const fetchedVersions = await update.fetchRegistryVersions('https://registry.npmmirror.com', '@acme/widget', undefined);
assert.equal(requestedUrl, 'https://registry.npmmirror.com/@acme/widget');
assert.deepEqual(fetchedVersions.versions, ['2.0.0', '1.0.0']);
assert.equal(fetchedVersions.latest, '2.0.0');
globalThis.fetch = originalFetch;

assert.equal(update.packageDisplayTitle({ name: 'x', meta: { title: 'Widget' } }), 'Widget');
assert.equal(update.packageDisplayTitle({ name: '@acme/x' }), '@acme/x');
assert.equal(update.normalizeVersionInput('v1.2.3'), '1.2.3');
assert.equal(update.normalizeVersionInput('1.2.3-beta.1'), '1.2.3-beta.1');
assert.equal(update.normalizeVersionInput('latest'), '');
assert.equal(update.normalizeVersionInput('@acme/x@1.0.0'), '');
assert.equal(update.inspectReason({ problem: 'not-found' }, translate), 'That version is not available from the registry.');
assert.equal(
  update.operationReason({ error: { code: 'management-required' } }, translate),
  'DSH manages this plugin; it cannot be installed here.',
);

// The update removes the old copy first; a later failure must reinstall it.
const restoreCalls = [];
const restoreManager = {
  async installBundle(spec, options) {
    restoreCalls.push({ spec, options });
    return { ok: true, value: { application: 'applied', version: '1.2.3' } };
  },
};
const restored = await update.restorePreviousBundle(
  restoreManager,
  { name: '@acme/dsh-widget', version: '1.2.3', enabled: false, registry: 'https://registry.example.com/' },
  translate,
);
assert.equal(restored.version, '1.2.3');
assert.equal(restored.restartRequired, false);
assert.equal(restoreCalls[0].spec, '@acme/dsh-widget@1.2.3');
assert.equal(restoreCalls[0].options.enabled, false, 'restores the pre-update enabled state');
assert.equal(restoreCalls[0].options.registry, 'https://registry.example.com/');
assert.equal(typeof restoreCalls[0].options.requestId, 'string');

await assert.rejects(
  () => update.restorePreviousBundle(restoreManager, { name: '@acme/dsh-widget', version: '' }, translate),
  /previous version is unknown/u,
  'a missing previous version cannot be rolled back silently',
);
await assert.rejects(
  () => update.restorePreviousBundle({ async installBundle() { return { ok: false, error: { message: 'registry down' } }; } }, { name: '@acme/dsh-widget', version: '1.2.3' }, translate),
  /registry down/u,
);
await assert.rejects(
  () => update.restorePreviousBundle({ async installBundle() { return { ok: true, value: { application: 'failed', error: { code: 'install-failed', diagnostic: 'disk full' } } }; } }, { name: '@acme/dsh-widget', version: '1.2.3' }, translate),
  /disk full/u,
);

// One-click update: after installing, apply the stored defaults without any
// enable/restart question, and close the completion panel when nothing restarts.
async function oneClickRun(settings, options = {}) {
  const applied = [];
  const pending = [];
  const calls = [];
  const manager = {
    async setBundleEnabled(name, enabled) {
      calls.push(['enable', name, enabled]);
      if (options.enableError !== undefined) return { ok: false, error: { message: options.enableError } };
      return { ok: true, value: options.enableResult ?? { application: 'applied' } };
    },
  };
  await update.runOneClickUpdate({
    manager,
    name: '@acme/dsh-widget',
    installedVersion: '1.3.0',
    restartRequired: options.restartRequired === true,
    settings,
    apply: (delta) => applied.push(delta),
    isCurrent: () => options.current ?? true,
    recordPending: (entry) => pending.push(entry),
    readRestartCapability: async () => options.capability ?? { supported: true, reason: '' },
    requestRestart: async () => {
      calls.push(['restart']);
      if (options.restartError !== undefined) throw new Error(options.restartError);
    },
    t: translate,
  });
  return { applied, pending, calls };
}

const defaultsRun = await oneClickRun({ oneClickEnable: true, oneClickRestart: true });
assert.deepEqual(defaultsRun.calls, [['enable', '@acme/dsh-widget', true], ['restart']], 'defaults enable and restart');
assert.equal(defaultsRun.applied.at(-1).phase, 'restarting', 'the panel shows the restart, not a question');

const noEnableRun = await oneClickRun({ oneClickEnable: false, oneClickRestart: true });
assert.deepEqual(noEnableRun.calls, [], 'auto-enable off means no enable and no restart');
assert.equal(noEnableRun.applied.at(-1).enabled, false);
assert.equal(noEnableRun.applied.at(-1).skippedEnable, true);
assert.equal(noEnableRun.applied.at(-1).autoClose, true, 'a completion panel that does not restart closes itself');

const noRestartRun = await oneClickRun({ oneClickEnable: true, oneClickRestart: false });
assert.deepEqual(noRestartRun.calls, [['enable', '@acme/dsh-widget', true]], 'auto-restart off enables but does not restart');
assert.equal(noRestartRun.applied.at(-1).restartSkipped, true);
assert.equal(noRestartRun.applied.at(-1).autoClose, true);

const unsupportedRun = await oneClickRun(
  { oneClickEnable: true, oneClickRestart: true },
  { capability: { supported: false, reason: 'dsh web owns the process' } },
);
assert.equal(unsupportedRun.applied.at(-1).restartUnsupported, 'dsh web owns the process');
assert.equal(unsupportedRun.applied.at(-1).autoClose, true);

const enableFailRun = await oneClickRun({ oneClickEnable: true, oneClickRestart: true }, { enableError: 'plugin manager busy' });
assert.equal(enableFailRun.applied.at(-1).enableError, 'plugin manager busy');
assert.equal(enableFailRun.applied.at(-1).autoClose, false, 'an enable failure stays on screen');
assert.deepEqual(enableFailRun.calls, [['enable', '@acme/dsh-widget', true]], 'a failed enable never restarts');

const restartFailRun = await oneClickRun({ oneClickEnable: true, oneClickRestart: true }, { restartError: 'restart refused' });
assert.equal(restartFailRun.applied.at(-1).restartError, 'restart refused');
assert.equal(restartFailRun.applied.at(-1).autoClose, false, 'a restart failure stays on screen');

const pendingRun = await oneClickRun(
  { oneClickEnable: true, oneClickRestart: true },
  { restartRequired: true, enableResult: { application: 'restart-required', restartReason: 'new bundle files' } },
);
assert.deepEqual(pendingRun.pending, [{ name: '@acme/dsh-widget', version: '1.3.0', reason: 'new bundle files' }], 'restart-required keeps the card marker');

const staleRun = await oneClickRun({ oneClickEnable: true, oneClickRestart: true }, { current: false });
assert.deepEqual(staleRun.calls, [['enable', '@acme/dsh-widget', true]], 'a dialog replaced mid-flight stops before restarting');
assert.equal(staleRun.applied.some((delta) => delta.phase === 'restarting'), false);

resetHooks();
assert.equal(update.PluginUpdateOverlay({ manager: pluginManager, remote, ctx }), null, 'update overlay is inert until opened');

// ---------------------------------------------------------------------------
// Background-job stop reason
// ---------------------------------------------------------------------------
resetHooks();
assert.equal(update.JobStopOverlay({ jobs: fakeJobs, ctx }), null, 'stop overlay is inert until a stop button is pressed');

const labelNode = { textContent: 'sleep 600', getAttribute: (name) => name === 'title' ? 'sleep 600' : null };
const stopButton = {
  getAttribute: (name) => name === 'aria-label' ? '停止任务 sleep 600' : null,
  closest: (selector) => selector === 'li' ? { querySelectorAll: () => [labelNode, stopButton] } : null,
};
assert.equal(update.stopButtonLabel(stopButton), 'sleep 600', 'row label comes from the DOM, not the localized aria-label');
for (const key of ['page.jobStopTitle', 'page.jobStopDesc', 'page.jobStopHow', 'jobStop.title', 'jobStop.subtitle', 'jobStop.close', 'jobStop.reasonLabel', 'jobStop.reasonPlaceholder', 'jobStop.reasonNote', 'jobStop.cancel', 'jobStop.confirm', 'jobStop.stopping', 'jobStop.failed']) {
  assert.ok(DICT.zh[key] !== undefined, `zh dictionary has ${key}`);
  assert.ok(DICT.en[key] !== undefined, `en dictionary has ${key}`);
}

const originalQuerySelectorAll = document.querySelectorAll;
document.querySelectorAll = () => [stopButton];
const resolvedStop = update.resolveStopTarget(fakeJobs, stopButton, 'session-1');
document.querySelectorAll = originalQuerySelectorAll;
assert.equal(resolvedStop?.sessionId, 'session-1');
assert.equal(resolvedStop?.job.id, 'bash-live', 'the first stop button maps to the first running row');
assert.equal(update.resolveStopTarget(fakeJobs, stopButton, 'session-1'), undefined, 'unresolvable DOM leaves the host flow alone');
assert.equal(update.resolveStopTarget({ state: { getSnapshot: () => ({ rows: { 'session-1': [] } }) } }, stopButton, 'session-1'), undefined);

// The stop panel is portaled to the document body, so a slot's stacking
// context cannot cap it under the host jobs menu (which is itself a body portal
// at z-index 100).
const portaled = update.renderInBody('panel');
assert.deepEqual(portaled, { portal: 'panel', container: document.body }, 'floating panels render through the body portal');
assert.equal(portalCalls.at(-1), document.body, 'the portal target is document.body');

// The DOM injection: one icon button in the card's action area, idempotent,
// and clicking it opens that package. React owns these nodes, so the helper is
// re-run by the observer; a second run must not duplicate the button.
class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.parent = null;
    this.title = '';
    this.className = '';
    this.innerHTML = '';
    this.textContent = '';
    this.isConnected = true;
  }

  appendChild(child) {
    child.parent = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parent = this;
    child.isConnected = true;
    const index = reference === null ? -1 : this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  remove() {
    this.isConnected = false;
    if (this.parent !== null) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
      this.parent = null;
    }
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    this.listeners.click?.({ preventDefault() {}, stopPropagation() {} });
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] ?? null;
  }

  querySelector(selector) {
    const match = /^\[(data-[a-z-]+)\]$/u.exec(selector);
    if (match === null) return null;
    const attribute = match[1];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.getAttribute(attribute) !== null) return child;
        const found = walk(child);
        if (found !== null) return found;
      }
      return null;
    };
    return walk(this);
  }
}

function fakeCard(name) {
  const card = new FakeElement('li');
  card.setAttribute('data-plugin-package', name);
  const head = new FakeElement('div');
  const icon = new FakeElement('span');
  const main = new FakeElement('div');
  const titleRow = new FakeElement('div');
  const end = new FakeElement('div');
  main.appendChild(titleRow);
  head.appendChild(icon);
  head.appendChild(main);
  head.appendChild(end);
  card.appendChild(head);
  return { card, end, titleRow };
}

const firstCard = fakeCard('@acme/dsh-widget');
const cardDocument = {
  querySelectorAll: () => [firstCard.card],
  createElement: (tag) => new FakeElement(tag),
};
const injected = new Set();
const opened = [];
update.ensureUpdateButtons(cardDocument, (name) => opened.push(name), [], translate, injected);
assert.equal(injected.size, 1, 'one update button injected');
const injectedButton = firstCard.end.firstElementChild;
assert.equal(injectedButton.getAttribute('data-dsh-powerup-update'), '');
assert.equal(injectedButton.className, 'dsh-powerup-update-button');
assert.equal(injectedButton.title, 'Install · @acme/dsh-widget');
injectedButton.click();
assert.deepEqual(opened, ['@acme/dsh-widget'], 'click opens that package');
update.ensureUpdateButtons(cardDocument, () => {}, [], translate, injected);
assert.equal(firstCard.end.children.length, 1, 'injection is idempotent');

update.ensureUpdateButtons(cardDocument, () => {}, ['@acme/dsh-widget'], translate, injected);
const restartTag = firstCard.titleRow.querySelector('[data-dsh-powerup-restart-tag]');
assert.equal(restartTag?.textContent, 'Restart needed', 'pending card carries a restart tag');
update.ensureUpdateButtons(cardDocument, () => {}, [], translate, injected);
assert.equal(firstCard.titleRow.querySelector('[data-dsh-powerup-restart-tag]'), null, 'tag clears when the plugin is no longer pending');

const selfCard = fakeCard('@restregular/dsh-powerup');
const selfDocument = {
  querySelectorAll: () => [selfCard.card],
  createElement: (tag) => new FakeElement(tag),
};
update.ensureUpdateButtons(selfDocument, () => {}, [], translate, new Set());
assert.equal(selfCard.end.firstElementChild.title, 'Install · @restregular/dsh-powerup', 'self install uses the normal entry');

const group = new FakeElement('section');
group.setAttribute('data-plugin-group', 'bundles');
const groupHead = new FakeElement('div');
group.appendChild(groupHead);
const groupDocument = {
  querySelector: (selector) => selector === '[data-plugin-group="bundles"]' ? group : group.querySelector(selector),
  querySelectorAll: () => [],
  createElement: (tag) => new FakeElement(tag),
};
let restartClicks = 0;
update.ensureRestartBar(groupDocument, 2, () => { restartClicks += 1; }, translateParams);
const restartBar = group.querySelector('[data-dsh-powerup-restart-bar]');
assert.ok(restartBar, 'restart bar injected beside the group heading');
assert.equal(restartBar.firstElementChild.textContent, '2 plugins need a restart');
assert.equal(restartBar.lastElementChild.textContent, 'Restart DSH');
restartBar.lastElementChild.click();
assert.equal(restartClicks, 1, 'restart bar button opens the confirmation');
update.ensureRestartBar(groupDocument, 0, () => {}, translateParams);
const idleBar = group.querySelector('[data-dsh-powerup-restart-bar]');
assert.ok(idleBar, 'restart bar stays visible with no pending plugins');
assert.equal(idleBar.firstElementChild.textContent, 'No plugins need a restart');
assert.equal(idleBar.lastElementChild.textContent, 'Restart DSH');

// ---------------------------------------------------------------------------
// Host half: restart capability route
// ---------------------------------------------------------------------------
const host = await import(new URL('../index.js', import.meta.url).href);
assert.equal(host.__test.isLoopback({ socket: { remoteAddress: '127.0.0.1' } }), true);
assert.equal(host.__test.isLoopback({ socket: { remoteAddress: '10.0.0.9' } }), false);
assert.equal(host.__test.sameOrigin({ headers: { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1' } }), true);
assert.equal(host.__test.sameOrigin({ headers: { origin: 'http://evil.test', host: '127.0.0.1:1' } }), false);
assert.equal(host.__test.sameOrigin({ headers: {} }), true);

function fakeResponse() {
  return {
    status: 0,
    body: '',
    headersSent: false,
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(body) { this.body = String(body ?? ''); },
  };
}

const statusResponse = fakeResponse();
await host.__test.handle({
  method: 'GET',
  url: '/dsh-powerup/api/restart',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
}, statusResponse);
const statusBody = JSON.parse(statusResponse.body);
assert.equal(statusBody.ok, true);
assert.equal(statusBody.supported, false, 'plain Node is not the Electron desktop host');
assert.equal(typeof statusBody.reason, 'string');

const selfGetResponse = fakeResponse();
await host.__test.handle({
  method: 'GET',
  url: '/dsh-powerup/api/self-update',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
}, selfGetResponse);
assert.equal(selfGetResponse.status, 405, 'self-update only accepts POST');

const auditResponse = fakeResponse();
await host.__test.handle({
  method: 'GET',
  url: '/dsh-powerup/api/audit',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
}, auditResponse, { get: () => ({ async listBundles() { return []; } }) });
assert.equal(auditResponse.status, 200);
assert.deepEqual(JSON.parse(auditResponse.body).entries, []);

const restartResponse = fakeResponse();
await host.__test.handle({
  method: 'POST',
  url: '/dsh-powerup/api/restart',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
}, restartResponse);
assert.equal(restartResponse.status, 409);
assert.equal(JSON.parse(restartResponse.body).code, 'restart-unsupported');

// ---------------------------------------------------------------------------
// Host half: stop a background job with an optional reason
// ---------------------------------------------------------------------------
function fakeJsonRequest(url, payload) {
  return {
    method: 'POST',
    url,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload));
    },
  };
}

const killCalls = [];
const killJobs = {
  kill(jobId, sessionId, reason) {
    killCalls.push({ jobId, sessionId, reason });
    return 'requested';
  },
};
const killResponse = fakeResponse();
await host.__test.handle(
  fakeJsonRequest('/dsh-powerup/api/job-kill', { jobId: 'bash-1', sessionId: 'session-1', reason: '  改方案\n了  ' }),
  killResponse,
  { get: (name) => name === 'jobs' ? killJobs : undefined },
);
assert.equal(killResponse.status, 200);
assert.deepEqual(JSON.parse(killResponse.body), { ok: true, outcome: 'requested' });
assert.deepEqual(killCalls, [
  { jobId: 'bash-1', sessionId: 'session-1', reason: 'cancelled by the user: 改方案 了' },
], 'the typed reason is appended to the core phrase and stays one line');

const blankKillResponse = fakeResponse();
await host.__test.handle(
  fakeJsonRequest('/dsh-powerup/api/job-kill', { jobId: 'bash-2', sessionId: 'session-1', reason: '   ' }),
  blankKillResponse,
  { get: (name) => name === 'jobs' ? killJobs : undefined },
);
assert.equal(JSON.parse(blankKillResponse.body).ok, true);
assert.equal(killCalls[1].reason, 'cancelled by the user', 'an empty reason keeps the host behavior');

const invalidKillResponse = fakeResponse();
await host.__test.handle(
  fakeJsonRequest('/dsh-powerup/api/job-kill', { jobId: '', sessionId: 'session-1' }),
  invalidKillResponse,
  { get: () => undefined },
);
assert.equal(invalidKillResponse.status, 400);
assert.equal(JSON.parse(invalidKillResponse.body).code, 'invalid-request');

const unavailableKillResponse = fakeResponse();
await host.__test.handle(
  fakeJsonRequest('/dsh-powerup/api/job-kill', { jobId: 'bash-1', sessionId: 'session-1' }),
  unavailableKillResponse,
  { get: () => undefined },
);
assert.equal(unavailableKillResponse.status, 503);
assert.equal(JSON.parse(unavailableKillResponse.body).code, 'jobs-unavailable');

const getKillResponse = fakeResponse();
await host.__test.handle({
  method: 'GET',
  url: '/dsh-powerup/api/job-kill',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
}, getKillResponse, { get: () => undefined });
assert.equal(getKillResponse.status, 405, 'job-kill only accepts POST');

const failedKillResponse = fakeResponse();
await host.__test.handle(
  fakeJsonRequest('/dsh-powerup/api/job-kill', { jobId: 'missing', sessionId: 'session-1' }),
  failedKillResponse,
  { get: () => ({ kill() { throw new Error('job not visible to session'); } }) },
);
assert.equal(failedKillResponse.status, 404);
assert.equal(JSON.parse(failedKillResponse.body).code, 'kill-failed');

assert.equal(host.__test.normalizeStopReason('  a\nb\tc  '), 'a b c');
assert.equal(host.__test.normalizeStopReason(null), '');
assert.equal(host.__test.normalizeStopReason('x'.repeat(300)).length, 200);
assert.equal(host.__test.killReasonFor(''), 'cancelled by the user');
assert.equal(host.__test.killReasonFor('换方案'), 'cancelled by the user: 换方案');

assert.equal(host.__test.normalizeVersion('v1.2.3'), '1.2.3');
assert.equal(host.__test.normalizeVersion('latest'), '');
assert.equal(host.__test.normalizeVersion('@acme/x@1.0.0'), '');

const selfUpdateCalls = [];
const fakeSelfManager = {
  async removeBundle(name) {
    selfUpdateCalls.push(['remove', name]);
    return { application: 'applied' };
  },
  async inspect(spec) {
    selfUpdateCalls.push(['inspect', spec]);
    return { status: 'accepted', bundle: true };
  },
  async installBundle(spec, options) {
    selfUpdateCalls.push(['install', spec, options]);
    return { application: 'applied', version: '0.3.0' };
  },
};
const selfUpdateResult = await host.__test.performSelfUpdate(
  { get: () => fakeSelfManager },
  '0.3.0',
  'https://registry.npmjs.org/',
  { log: () => {} },
);
assert.equal(selfUpdateResult.ok, true);
assert.deepEqual(selfUpdateCalls.map((call) => call[0]), ['remove', 'inspect', 'install']);
assert.equal(selfUpdateCalls[2][2].enabled, true, 'self-update installs enabled');

const refusedCalls = [];
const refusedSelfManager = {
  async removeBundle() { refusedCalls.push('remove'); return { application: 'applied' }; },
  async inspect() { refusedCalls.push('inspect'); return { status: 'refused', problem: 'not-found', reason: 'missing' }; },
  async installBundle(spec, options) { refusedCalls.push(['install', spec, options]); return { application: 'applied' }; },
};
const refusedSelfResult = await host.__test.performSelfUpdate(
  { get: () => refusedSelfManager },
  '9.9.9',
  null,
  { log: () => {}, previousVersion: '0.4.0' },
);
assert.equal(refusedSelfResult.ok, false);
assert.equal(refusedSelfResult.stage, 'inspect');
assert.equal(refusedSelfResult.rolledBack, true, 'a failed self-update reinstalls the previous version');
assert.deepEqual(refusedCalls.map((call) => Array.isArray(call) ? call[0] : call), ['remove', 'inspect', 'install'], 'the old copy is put back');
assert.deepEqual(refusedCalls[2], ['install', '@restregular/dsh-powerup@0.4.0', refusedCalls[2][2]]);
assert.equal(refusedCalls[2][2].enabled, true, 'the restored self keeps its enabled state');

const rollbackFailureManager = {
  async removeBundle() { return { application: 'applied' }; },
  async inspect() { return { status: 'refused', problem: 'not-found', reason: 'missing' }; },
  async installBundle() { return { error: { code: 'install-failed', diagnostic: 'registry down' } }; },
};
const rollbackFailureResult = await host.__test.performSelfUpdate(
  { get: () => rollbackFailureManager },
  '9.9.9',
  null,
  { log: () => {}, previousVersion: '0.4.0' },
);
assert.equal(rollbackFailureResult.ok, false);
assert.equal(rollbackFailureResult.rolledBack, false);
assert.match(rollbackFailureResult.rollbackError, /registry down/u, 'a failed rollback surfaces its own reason');

const removeFailureManager = {
  async removeBundle() { return { error: { code: 'remove-failed', diagnostic: 'locked' } }; },
  async inspect() { throw new Error('must not inspect after a failed remove'); },
  async installBundle() { throw new Error('must not roll back when nothing was removed'); },
};
const removeFailureResult = await host.__test.performSelfUpdate(
  { get: () => removeFailureManager },
  '9.9.9',
  null,
  { log: () => {}, previousVersion: '0.4.0' },
);
assert.equal(removeFailureResult.ok, false);
assert.equal(removeFailureResult.rolledBack, false);
assert.equal(removeFailureResult.rollbackError, undefined);
assert.equal(host.__test.SELF_VERSION, '0.8.15');

const installFailSpecs = [];
const installFailManager = {
  async removeBundle() { return { application: 'applied' }; },
  async inspect() { return { status: 'accepted', bundle: true }; },
  async installBundle(spec) {
    installFailSpecs.push(spec);
    if (spec === '@restregular/dsh-powerup@9.9.9') return { application: 'failed' };
    return { application: 'applied', version: '0.4.1' };
  },
};
const installFailResult = await host.__test.performSelfUpdate(
  { get: () => installFailManager },
  '9.9.9',
  null,
  { log: () => {}, previousVersion: '0.4.1' },
);
assert.equal(installFailResult.ok, false);
assert.equal(installFailResult.stage, 'install');
assert.equal(installFailResult.rolledBack, true, 'a failed target install also restores the old version');
assert.deepEqual(installFailSpecs, ['@restregular/dsh-powerup@9.9.9', '@restregular/dsh-powerup@0.4.1']);

let hostRoute = null;
host.apply({
  inject(_deps, callback) {
    callback({
      get(name) {
        if (name === 'webServer') {
          return { register(definition) { hostRoute = definition; return () => {}; } };
        }
        return undefined;
      },
      effect(fn) { return fn(); },
    });
  },
});
assert.equal(hostRoute.path, '/dsh-powerup/api');
assert.equal(hostRoute.kind, 'prefix');
assert.equal(typeof hostRoute.handler, 'function');

// App-control routes: close mirrors restart, and both share the capability
// probe. The offline test runtime has no Electron parent, so both actions are
// refused with a 409 and an explanatory code.
const callHost = async (method, pathname) => {
  const req = { method, url: pathname, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  let payload = '';
  const res = {
    headersSent: false,
    writeHead(status) { this.status = status; },
    end(text) { payload = text; },
  };
  await host.__test.handle(req, res, {});
  return { status: res.status, body: JSON.parse(payload) };
};
const closeCapability = await callHost('GET', '/dsh-powerup/api/close');
assert.equal(closeCapability.status, 200);
assert.equal(closeCapability.body.ok, true);
assert.equal(closeCapability.body.action, 'close');
assert.equal(typeof closeCapability.body.supported, 'boolean');
const restartCapability = await callHost('GET', '/dsh-powerup/api/restart');
assert.equal(restartCapability.body.action, 'restart');
const refusedClose = await callHost('POST', '/dsh-powerup/api/close');
assert.equal(refusedClose.status, 409);
assert.equal(refusedClose.body.ok, false);
assert.match(String(refusedClose.body.code), /shutdown|close/u, 'close reports its own unsupported code');
assert.equal((await callHost('GET', '/dsh-powerup/api/nope')).status, 404);

// ---------------------------------------------------------------------------
// Manifest and display metadata
// ---------------------------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, '@restregular/dsh-powerup');
assert.equal(pkg.version, host.__test.SELF_VERSION, 'the Host half reports the manifest version');
assert.equal(pkg.icon, './icon.svg');
assert.equal(pkg.exports['./client'], './client.js');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.ok(pkg.files.includes('client.js'));
assert.ok(pkg.files.includes('lib/restart.js'));
assert.ok(pkg.files.includes('lib/restart-helper.cjs'));
assert.ok(pkg.files.includes('lib/step-reference.js'));
assert.ok(pkg.files.includes('lib/step-tool.js'));
assert.ok(pkg.files.includes('locale/*.json'));
for (const localeFile of ['en.json', 'zh.json']) {
  const dict = JSON.parse(fs.readFileSync(path.join(root, 'locale', localeFile), 'utf8'));
  assert.ok(dict.meta.title.length > 0);
  assert.ok(dict.meta.description.length > 20);
}
const iconSvg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
assert.ok(iconSvg.includes('viewBox="0 0 256 256"'));
assert.ok(!iconSvg.includes('<script'));

console.log('smoke ok: 7 slots, icons, page, overlays, job stop reason, prompt store, install flow, bridge, helpers, theme tokens, manifest, host routes');
