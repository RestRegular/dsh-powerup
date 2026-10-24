import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

const requireStub = (id) => {
  if (id === 'react') return React;
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

assert.equal(registrations.length, 5, 'five slot registrations');
const bySlot = new Map(registrations.map((entry) => [entry.options.name, entry]));
for (const slot of ['sidebar.panellist', 'main', 'shell.overlay', 'conversation.session.header.utilities']) {
  assert.ok(bySlot.has(slot), `registered ${slot}`);
}
assert.equal(bySlot.get('sidebar.panellist').options.id, 'powerup');
assert.equal(bySlot.get('main').options.key, 'powerup');
const overlayIds = registrations.filter((entry) => entry.options.name === 'shell.overlay').map((entry) => entry.options.id).sort();
assert.deepEqual(overlayIds, ['powerup-context-menu', 'powerup-plugin-update'], 'context menu and update overlay');
assert.ok(registrations.some((entry) => entry.options.id === 'powerup-plugin-update'), 'plugin update overlay registered');
assert.ok(scopes.some((entry) => entry.deps.includes('remote.pluginManager')), 'update overlay waits for the plugin manager remote');

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
  ['copy', 'quote', 'insert', 'inspect', 'fork', 'session'],
);
assert.equal(rowItems.find((item) => item.id === 'copy').label, 'Copy content');
assert.equal(rowItems.find((item) => item.id === 'fork').disabled, true);
assert.equal(rowItems.find((item) => item.id === 'session').disabled, false);

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

// ---------------------------------------------------------------------------
// Plugin update helpers
// ---------------------------------------------------------------------------
const update = moduleExports.__test;
const usedUpdateKeys = new Set([...source.matchAll(/t\('(update\.[A-Za-z.]+)'/gu)].map((match) => match[1]));
for (const key of usedUpdateKeys) {
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
  translate,
);
assert.equal(registryChoices.length, 3);
assert.equal(registryChoices[0].value, null);
assert.equal(registryChoices[1].label, 'Mainland China mirror');
assert.equal(registryChoices[2].hint, 'npm.example.com');
const picked = update.pickRegistryChoice(registryChoices, { kind: 'custom', url: 'https://npm.example.com/' });
assert.equal(picked.key, 'https://npm.example.com/');
assert.equal(update.lookupRegistries(registryChoices, registryChoices[1]).length, 3);

globalThis.localStorage.getItem = () => '{"kind":"offered","registry":null}';
assert.deepEqual(update.readRememberedRegistry(), { kind: 'offered', registry: null });
globalThis.localStorage.getItem = () => 'not json';
assert.equal(update.readRememberedRegistry(), null);
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
  'DSH manages this plugin; it cannot be updated here.',
);

resetHooks();
assert.equal(update.PluginUpdateOverlay({ manager: pluginManager, remote, ctx }), null, 'update overlay is inert until opened');

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
    if (selector !== '[data-dsh-powerup-update]') return null;
    const walk = (node) => {
      for (const child of node.children) {
        if (child.getAttribute('data-dsh-powerup-update') !== null) return child;
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
  const end = new FakeElement('div');
  head.appendChild(end);
  card.appendChild(head);
  return { card, end };
}

const firstCard = fakeCard('@acme/dsh-widget');
const cardDocument = {
  querySelectorAll: () => [firstCard.card],
  createElement: (tag) => new FakeElement(tag),
};
const injected = new Set();
const opened = [];
update.ensureUpdateButtons(cardDocument, (name) => opened.push(name), translate, injected);
assert.equal(injected.size, 1, 'one update button injected');
const injectedButton = firstCard.end.firstElementChild;
assert.equal(injectedButton.getAttribute('data-dsh-powerup-update'), '');
assert.equal(injectedButton.className, 'dsh-powerup-update-button');
assert.equal(injectedButton.title, 'Update version · @acme/dsh-widget');
injectedButton.click();
assert.deepEqual(opened, ['@acme/dsh-widget'], 'click opens that package');
update.ensureUpdateButtons(cardDocument, () => {}, translate, injected);
assert.equal(firstCard.end.children.length, 1, 'injection is idempotent');

const selfCard = fakeCard('@restregular/dsh-powerup');
const selfDocument = {
  querySelectorAll: () => [selfCard.card],
  createElement: (tag) => new FakeElement(tag),
};
update.ensureUpdateButtons(selfDocument, () => {}, translate, new Set());
assert.equal(selfCard.end.firstElementChild.title, 'Update Power-Up with Add plugin', 'self update is explained');

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

const restartResponse = fakeResponse();
await host.__test.handle({
  method: 'POST',
  url: '/dsh-powerup/api/restart',
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
}, restartResponse);
assert.equal(restartResponse.status, 409);
assert.equal(JSON.parse(restartResponse.body).code, 'restart-unsupported');

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

// ---------------------------------------------------------------------------
// Manifest and display metadata
// ---------------------------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, '@restregular/dsh-powerup');
assert.equal(pkg.version, '0.2.3');
assert.equal(pkg.icon, './icon.svg');
assert.equal(pkg.exports['./client'], './client.js');
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.dsh.client.platform, 'web');
assert.ok(pkg.files.includes('client.js'));
assert.ok(pkg.files.includes('lib/restart.js'));
assert.ok(pkg.files.includes('lib/restart-helper.cjs'));
assert.ok(pkg.files.includes('locale/*.json'));
for (const localeFile of ['en.json', 'zh.json']) {
  const dict = JSON.parse(fs.readFileSync(path.join(root, 'locale', localeFile), 'utf8'));
  assert.ok(dict.meta.title.length > 0);
  assert.ok(dict.meta.description.length > 20);
}
const iconSvg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
assert.ok(iconSvg.includes('viewBox="0 0 256 256"'));
assert.ok(!iconSvg.includes('<script'));

console.log('smoke ok: 5 slots, icons, page, overlay, update flow, bridge, helpers, theme tokens, manifest, host route');
