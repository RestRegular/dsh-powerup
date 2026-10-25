/**
 * Host half of dsh-powerup.
 *
 * The plugin is primarily a Client UI upgrade. This Host entry owns the two
 * operations the browser cannot perform itself:
 *
 *   GET  /dsh-powerup/api/restart       → { ok, supported, reason? }
 *   POST /dsh-powerup/api/restart       → schedules a whole-app restart
 *   GET  /dsh-powerup/api/audit         → profile bundles newer than this Host
 *   POST /dsh-powerup/api/self-update   → removes and reinstalls this plugin
 *                                         in the background, surviving the
 *                                         plugin's own unload
 *
 * The Client half drives other plugins' installation through the built-in
 * `pluginManager` Remote. Only the process restart and the self-update handoff
 * need Host code.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { describeRestart, requestRestart } from './lib/restart.js';

/** Prefix owned by this plugin. */
const ROUTE = '/dsh-powerup/api';

/** The bundle this pair of routes may replace while its own UI unloads. */
const MODULE_ID = '@restregular/dsh-powerup';

/** Let the HTTP response reach the browser before the plugin unloads. */
const SELF_UPDATE_DELAY_MS = 600;

/** Request body bound for the small JSON commands. */
const BODY_LIMIT = 16 * 1024;

/** The moment this Host process started; a profile file newer than it may await a restart. */
const HOST_STARTED_AT = Date.now() - process.uptime() * 1000;

/**
 * The desktop profile directory, resolved without depending on the shell tool.
 * @returns {string}
 */
function profileDirectory() {
  const configured = process.env.DSH_PROFILE_DIR;
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
  const name = typeof process.env.DSH_PROFILE === 'string' && process.env.DSH_PROFILE.trim() !== ''
    ? process.env.DSH_PROFILE.trim()
    : 'desktop';
  return join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'profiles', name);
}

/**
 * Installed profile bundles whose package.json is newer than this Host process.
 * Those files changed after the running composition loaded; a restart is the
 * reliable way to apply them. The check is deliberately limited to profile
 * bundles because installation-owned files move only with DSH itself.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {Promise<Array<{ name: string, version: string, mtime: number, reason: string }>>}
 */
async function auditProfileBundles(ctx) {
  const manager = ctx?.get?.('pluginManager');
  if (manager === undefined || typeof manager.listBundles !== 'function') return [];
  const bundles = await manager.listBundles();
  const profileDir = profileDirectory();
  const entries = [];
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    if (bundle === null || typeof bundle !== 'object') continue;
    if (bundle.installed !== true || bundle.availability !== 'profile' || typeof bundle.name !== 'string') continue;
    let mtime = 0;
    const packageDir = join(profileDir, 'node_modules', bundle.name);
    try {
      mtime = statSync(packageDir).mtimeMs;
    } catch {
      try {
        mtime = statSync(join(packageDir, 'package.json')).mtimeMs;
      } catch {
        continue;
      }
    }
    if (mtime > HOST_STARTED_AT + 1000) {
      entries.push({
        name: bundle.name,
        version: typeof bundle.version === 'string' ? bundle.version : '',
        mtime,
        reason: 'files-newer-than-host',
      });
    }
  }
  return entries;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} payload
 * @param {number} status
 */
function sendJson(res, payload, status = 200) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/**
 * Read a bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('body-too-large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The request came from this machine.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1'
    || address === '::1'
    || address.startsWith('::ffff:127.')
    || address === '';
}

/**
 * A browser request carries an Origin matching Host. The desktop document
 * proxy strips both headers, which is accepted here — a browser cannot produce
 * that shape, and a loopback peer without an Origin is the desktop shell.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Append one line to the self-update log; logging never blocks the operation.
 * @param {string} line
 */
function appendSelfUpdateLog(line) {
  try {
    const path = join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'powerup', 'self-update.log');
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* The diagnostic log is optional. */
  }
}

/**
 * The concrete versions the update dialog accepts. The Client applies the same
 * shape before it removes anything; this is the Host-side guard.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeVersion(value) {
  const text = String(value ?? '').trim().replace(/^v/u, '');
  if (text === '' || /\s/u.test(text) || text.includes('@')) return '';
  return /^\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(text) ? text : '';
}

/**
 * Remove and reinstall this plugin through the built-in manager. The function
 * is started after the HTTP response and keeps running in the Host process
 * even when removing the bundle unloads this plugin's own Host fiber.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} version
 * @param {string | null} registry
 * @param {{ manager?: unknown, log?: (line: string) => void }} [options]
 * @returns {Promise<{ ok: boolean, stage?: string, error?: string }>}
 */
export async function performSelfUpdate(ctx, version, registry, options = {}) {
  const log = options.log ?? appendSelfUpdateLog;
  const manager = options.manager ?? ctx?.get?.('pluginManager');
  if (manager === undefined || typeof manager.installBundle !== 'function') {
    log('self-update: pluginManager service is unavailable');
    return { ok: false, stage: 'manager', error: 'pluginManager service is unavailable' };
  }
  const spec = `${MODULE_ID}@${version}`;
  log(`self-update: start ${spec} registry=${String(registry)}`);
  let stage = 'remove';
  try {
    const removed = await manager.removeBundle(MODULE_ID);
    if (removed?.error !== undefined) {
      throw new Error(`remove failed: ${removed.error.code ?? 'error'} ${removed.error.diagnostic ?? ''}`.trim());
    }
    log(`self-update: removed (application=${removed?.application ?? 'unknown'})`);
    stage = 'inspect';
    const checked = await manager.inspect(spec, { registry });
    if (checked?.status !== 'accepted') {
      throw new Error(`inspect refused: ${checked?.problem ?? 'unknown'} ${checked?.reason ?? ''}`.trim());
    }
    log(`self-update: inspected (bundle=${String(checked.bundle)})`);
    stage = 'install';
    const installed = await manager.installBundle(spec, {
      enabled: true,
      registry,
      requestId: randomUUID(),
    });
    if (installed?.error !== undefined) {
      throw new Error(`install failed: ${installed.error.code ?? 'error'} ${installed.error.diagnostic ?? ''}`.trim());
    }
    log(`self-update: installed (application=${installed?.application ?? 'unknown'}, version=${installed?.version ?? 'unknown'})`);
    return { ok: true, stage: 'install' };
  } catch (error) {
    const message = String(error?.message ?? error);
    log(`self-update: failed at ${stage}: ${message}${error?.stack === undefined ? '' : `\n${error.stack}`}`);
    return { ok: false, stage, error: message };
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
async function handle(req, res, ctx) {
  if (!isLoopback(req) || !sameOrigin(req)) {
    sendJson(res, { ok: false, error: 'forbidden' }, 403);
    return;
  }

  const url = new URL(req.url ?? ROUTE, 'http://localhost');
  const op = url.pathname.slice(ROUTE.length).replace(/^\/+/u, '') || url.searchParams.get('op') || '';
  if (op !== '' && op !== 'restart' && op !== 'self-update' && op !== 'audit') {
    sendJson(res, { ok: false, error: 'not-found' }, 404);
    return;
  }

  if (op === 'audit') {
    if (req.method !== 'GET') {
      sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
      return;
    }
    try {
      const entries = await auditProfileBundles(ctx);
      sendJson(res, { ok: true, hostStartedAt: HOST_STARTED_AT, entries });
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
    }
    return;
  }

  if (op === 'self-update') {
    if (req.method !== 'POST') {
      sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error) }, 400);
      return;
    }
    const version = normalizeVersion(body?.version);
    if (version === '') {
      sendJson(res, { ok: false, code: 'invalid-version', error: 'a concrete version is required' }, 400);
      return;
    }
    const registry = typeof body?.registry === 'string' && body.registry.trim() !== '' ? body.registry.trim() : null;
    const manager = ctx?.get?.('pluginManager');
    if (manager === undefined || typeof manager.removeBundle !== 'function' || typeof manager.installBundle !== 'function' || typeof manager.inspect !== 'function') {
      sendJson(res, { ok: false, code: 'manager-unavailable', error: 'pluginManager service is unavailable' }, 503);
      return;
    }
    sendJson(res, { ok: true, started: true, version });
    const timer = setTimeout(() => {
      void performSelfUpdate(ctx, version, registry, { manager }).catch((error) => {
        appendSelfUpdateLog(`self-update: uncaught ${String(error?.stack ?? error)}`);
      });
    }, SELF_UPDATE_DELAY_MS);
    timer.unref?.();
    return;
  }

  if (req.method === 'GET') {
    sendJson(res, { ok: true, action: 'restart', ...describeRestart() });
    return;
  }

  if (req.method === 'POST') {
    try {
      const scheduled = requestRestart();
      sendJson(res, { ok: true, restarting: true, ...scheduled });
    } catch (error) {
      sendJson(res, { ok: false, code: error?.code, error: String(error?.message ?? error) }, 409);
    }
    return;
  }

  sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
}

/**
 * Mount the restart and self-update routes once the Web server exists.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (ctx === undefined || typeof ctx.inject !== 'function') return;
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.get('webServer');
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    scope.effect(
      () => webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => handle(req, res, ctx),
      }),
      'dsh-powerup: restart and self-update routes',
    );
  });
}

/** Exported for tests only; the Host never reads this. */
export const __test = { handle, isLoopback, sameOrigin, performSelfUpdate, normalizeVersion, auditProfileBundles, profileDirectory, HOST_STARTED_AT, ROUTE, MODULE_ID };
