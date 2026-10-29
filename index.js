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
 *                                         plugin's own unload; a failed step
 *                                         reinstalls the version that was
 *                                         removed
 *   POST /dsh-powerup/api/job-kill      → stops one background job with an
 *                                         optional human reason
 *   tool powerup_step_read             → resolves a `dsh-step:` reference
 *                                         copied from the Trajectory menu into
 *                                         the raw session events it identifies
 *
 * The Client half drives other plugins' installation through the built-in
 * `pluginManager` Remote. Only the process restart, the self-update handoff,
 * and the stop-with-reason kill need Host code: the built-in `job.kill` Remote
 * hard-codes `cancelled by the user`, while the registry's own `kill` accepts
 * a reason that settlement merges into the job's `detail` line.
 *
 * The step-reference tool reads `ctx.sessionQuery`; both the reference codec
 * and the tool spec live in `lib/` so offline tests can exercise them.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { describeRestart, requestRestart } from './lib/restart.js';
import { createStepReadTool } from './lib/step-tool.js';

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
 * The version this Host module was loaded from. A self-update removes the only
 * installed copy before inspecting the target, so a failure must reinstall this
 * exact version instead of leaving Power-Up missing.
 * @returns {string}
 */
function selfVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return typeof manifest?.version === 'string' ? manifest.version : '';
  } catch {
    return '';
  }
}

/** Captured at load time, before self-update touches the package directory. */
const SELF_VERSION = selfVersion();

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

/** The reason core records for a human kill; a custom reason is appended. */
const HUMAN_KILL_REASON = 'cancelled by the user';

/** Upper bound for the optional reason, in characters. */
const STOP_REASON_LIMIT = 200;

/**
 * Normalize the optional reason typed in the stop dialog. Control characters
 * and line breaks collapse into spaces so the reason stays one line inside the
 * completion notice.
 * @param {unknown} value
 * @returns {string} the cleaned reason ('' when nothing was typed)
 */
function normalizeStopReason(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, STOP_REASON_LIMIT);
}

/**
 * The reason recorded with a human kill. An empty custom reason keeps the
 * core phrase; a typed one appends to it, so the injected completion notice
 * reads `cancelled by the user: <reason>`.
 * @param {unknown} value
 * @returns {string}
 */
function killReasonFor(value) {
  const reason = normalizeStopReason(value);
  return reason === '' ? HUMAN_KILL_REASON : `${HUMAN_KILL_REASON}: ${reason}`;
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
 * @param {{ manager?: unknown, log?: (line: string) => void, previousVersion?: string }} [options]
 * @returns {Promise<{ ok: boolean, stage?: string, error?: string, rolledBack?: boolean, rollbackError?: string }>}
 */
export async function performSelfUpdate(ctx, version, registry, options = {}) {
  const log = options.log ?? appendSelfUpdateLog;
  const manager = options.manager ?? ctx?.get?.('pluginManager');
  const previousVersion = typeof options.previousVersion === 'string' ? options.previousVersion : SELF_VERSION;
  if (manager === undefined || typeof manager.installBundle !== 'function') {
    log('self-update: pluginManager service is unavailable');
    return { ok: false, stage: 'manager', error: 'pluginManager service is unavailable' };
  }
  const spec = `${MODULE_ID}@${version}`;
  log(`self-update: start ${spec} registry=${String(registry)}`);
  let stage = 'remove';
  let removedOld = false;
  try {
    const removed = await manager.removeBundle(MODULE_ID);
    if (removed?.error !== undefined) {
      throw new Error(`remove failed: ${removed.error.code ?? 'error'} ${removed.error.diagnostic ?? ''}`.trim());
    }
    if (removed?.application === 'cancelled' || removed?.application === 'failed') {
      throw new Error(`remove ${removed.application}`);
    }
    removedOld = true;
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
    if (installed?.error !== undefined || installed?.application === 'failed') {
      const detail = installed?.error === undefined
        ? ''
        : `${installed.error.code ?? 'error'} ${installed.error.diagnostic ?? ''}`.trim();
      throw new Error(`install failed${detail === '' ? '' : `: ${detail}`}`);
    }
    log(`self-update: installed (application=${installed?.application ?? 'unknown'}, version=${installed?.version ?? 'unknown'})`);
    return { ok: true, stage: 'install' };
  } catch (error) {
    const message = String(error?.message ?? error);
    log(`self-update: failed at ${stage}: ${message}${error?.stack === undefined ? '' : `\n${error.stack}`}`);
    // Removing the old copy is the first step, so any later failure leaves
    // Power-Up uninstalled. Put the running version back instead.
    let rolledBack = false;
    let rollbackError;
    if (removedOld) {
      if (previousVersion === '') {
        rollbackError = 'the previous version is unknown';
        log('self-update: cannot roll back: previous version unknown');
      } else {
        log(`self-update: rolling back to ${MODULE_ID}@${previousVersion}`);
        try {
          const restored = await manager.installBundle(`${MODULE_ID}@${previousVersion}`, {
            enabled: true,
            registry,
            requestId: randomUUID(),
          });
          if (restored?.error !== undefined || restored?.application === 'failed') {
            const detail = restored?.error === undefined
              ? ''
              : `${restored.error.code ?? 'error'} ${restored.error.diagnostic ?? ''}`.trim();
            throw new Error(`rollback install failed${detail === '' ? '' : `: ${detail}`}`);
          }
          rolledBack = true;
          log(`self-update: rolled back to ${previousVersion} (application=${restored?.application ?? 'unknown'})`);
        } catch (rollbackFailure) {
          rollbackError = String(rollbackFailure?.message ?? rollbackFailure);
          log(`self-update: rollback failed: ${rollbackError}`);
        }
      }
    }
    return {
      ok: false,
      stage,
      error: message,
      rolledBack,
      ...(rollbackError === undefined ? {} : { rollbackError }),
    };
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
  if (op !== '' && op !== 'restart' && op !== 'self-update' && op !== 'audit' && op !== 'job-kill') {
    sendJson(res, { ok: false, error: 'not-found' }, 404);
    return;
  }

  if (op === 'job-kill') {
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
    const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (jobId === '' || sessionId === '') {
      sendJson(res, { ok: false, code: 'invalid-request', error: 'jobId and sessionId are required' }, 400);
      return;
    }
    const jobs = ctx?.get?.('jobs');
    if (jobs === undefined || typeof jobs.kill !== 'function') {
      sendJson(res, { ok: false, code: 'jobs-unavailable', error: 'jobs service is unavailable' }, 503);
      return;
    }
    try {
      // The registry's owner fence checks that this session can see the job,
      // and records the reason so settlement merges it into `detail`.
      const outcome = jobs.kill(jobId, sessionId, killReasonFor(body?.reason));
      sendJson(res, { ok: true, outcome });
    } catch (error) {
      sendJson(res, { ok: false, code: 'kill-failed', error: String(error?.message ?? error) }, 404);
    }
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
 * Mount the restart and self-update routes once the Web server exists, and
 * register the step-reference reader once both the tool registry and the
 * session-query service are composed.
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
  ctx.inject(['tools', 'sessionQuery'], (scope) => {
    const tools = scope.get('tools');
    if (tools === undefined || typeof tools.register !== 'function') return;
    scope.effect(
      () => tools.register(createStepReadTool(defineTool, {
        // Re-read the service at call time: the scope owns the live instance.
        getSessionQuery: () => scope.get('sessionQuery'),
      })),
      'dsh-powerup: step reference reader',
    );
  });
}

/** Exported for tests only; the Host never reads this. */
export const __test = {
  handle,
  isLoopback,
  sameOrigin,
  performSelfUpdate,
  normalizeVersion,
  normalizeStopReason,
  killReasonFor,
  selfVersion,
  auditProfileBundles,
  profileDirectory,
  HOST_STARTED_AT,
  SELF_VERSION,
  ROUTE,
  MODULE_ID,
};
