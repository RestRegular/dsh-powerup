/**
 * Host half of dsh-powerup.
 *
 * The plugin is primarily a Client UI upgrade. This Host entry owns the two
 * operations the browser cannot perform itself:
 *
 *   GET  /dsh-powerup/api/restart       → { ok, supported, reason? }
 *   POST /dsh-powerup/api/restart       → schedules a whole-app restart
 *   GET  /dsh-powerup/api/close         → { ok, supported, reason? }
 *   POST /dsh-powerup/api/close         → closes the whole app (no relaunch)
 *   GET  /dsh-powerup/api/audit         → profile bundles newer than this Host
 *   POST /dsh-powerup/api/self-update   → removes and reinstalls this plugin
 *                                         in the background, surviving the
 *                                         plugin's own unload; a failed step
 *                                         reinstalls the version that was
 *                                         removed
 *   POST /dsh-powerup/api/job-kill      → stops one background job with an
 *                                         optional human reason
 *   POST /dsh-powerup/api/progress      → starts/polls/cancels a side-model
 *                                         task-progress summary (never writes
 *                                         to the session log or blocks the turn)
 *   tool powerup_step_read             → resolves a `dsh-step:` reference
 *                                         copied from the Trajectory menu into
 *                                         the raw session events it identifies
 *   tool powerup_quick_replies         → publishes tappable text reply options
 *                                         for the current session's composer
 *   GET  /dsh-powerup/api/quick-replies → reads the current session's options
 *   POST /dsh-powerup/api/quick-replies → clears them after a user message
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { homedir } from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { describeClose, describeRestart, requestRestart, requestShutdown } from './lib/restart.js';
import {
  TASK_RESUME_FILE,
  collectRunningTasks,
  createResumeRecord,
  mergeResumeQueue,
  readResumeQueue,
  replayPendingResumes,
  stopUnfinishedTasks,
} from './lib/task-resume.js';
import { createStepReadTool } from './lib/step-tool.js';
import { createProgressManager } from './lib/progress-manager.js';
import { buildAskPrompt, cleanAskText, directAsk, generateTitle } from './lib/direct-ask.js';
import {
  createQuickRepliesStore,
  createQuickRepliesTool,
} from './lib/quick-replies.js';

/** Prefix owned by this plugin. */
const ROUTE = '/dsh-powerup/api';

/** The bundle this pair of routes may replace while its own UI unloads. */
const MODULE_ID = '@restregular/dsh-powerup';

/** Let the HTTP response reach the browser before the plugin unloads. */
const SELF_UPDATE_DELAY_MS = 600;

/** Request body bound for the small JSON commands. */
const BODY_LIMIT = 16 * 1024;

/**
 * Central state lives under ~/.dsh/dsh-powerup so one file holds every
 * workspace's records (each record carries its own workspaceId). This lets the
 * Power-Up settings page manage all workspaces in one place. Older releases
 * kept these files in each workspace's own `.dsh/dsh-powerup`, migrated once
 * on first access by `migrateLegacyStore`.
 */
const STORE_DIR_NAME = 'dsh-powerup';
const PROMPTS_FILE = 'prompts.json';
const MASK_RULES_FILE = 'mask-rules.json';
/** Pending continuation prompts recorded by forced restart / close. */
const TASK_RESUME_FILE_NAME = TASK_RESUME_FILE;
/** Persisted quick-reply options, keyed by session id. */
const QUICK_REPLIES_FILE = 'quick-replies.json';
/** Persisted progress-generation requirements (global + per workspace/session). */
const PROGRESS_REQUIREMENTS_FILE = 'progress-requirements.json';
/** Story of generated progress reports, kept on disk so refreshes never drop history. */
const PROGRESS_HISTORY_FILE = 'progress-history.json';
/** Legacy relative location inside a workspace, used only for migration. */
const LEGACY_STORE_DIR = join('.dsh', 'dsh-powerup');

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
async function readJsonBody(req, limit = BODY_LIMIT) {
  // Some callers (and older test doubles) send no stream at all.
  if (req === null || typeof req !== 'object' || typeof req[Symbol.asyncIterator] !== 'function') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body-too-large');
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
/** Bound the optional resume prompt supplied by the UI. */
function cleanResumePrompt(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 4000);
}

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
 * Absolute path of the central state file under ~/.dsh/dsh-powerup. One file
 * holds every workspace's records; no workspace registry lookup is needed, so
 * the store works even for workspaces not currently registered.
 * @param {string} fileName
 * @returns {string}
 */
function storePath(fileName) {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  return join(home, STORE_DIR_NAME, fileName);
}

/** The central prompts file path (kept for callers/tests). */
function promptStorePath() {
  return storePath(PROMPTS_FILE);
}

/** Read one JSON object from disk; a missing or invalid file becomes an empty object. */
function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    return {};
  }
}

/** Read one JSON list from disk; a missing file is an empty list. */
function readJsonStore(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * One-time migration of the old per-workspace files into the central store.
 * Records from every registered workspace are merged by identity (prompt id /
 * rule id), tagging each with its source workspaceId. A marker file prevents
 * re-merging on later writes. Legacy files are left in place (never deleted).
 * @param {string} fileName
 * @param {'prompts'|'rules'} kind
 */
function migrateLegacyStore(ctx, fileName) {
  const target = storePath(fileName);
  const marker = target + '.migrated';
  if (existsSync(marker)) return;
  const registry = ctx?.get?.('workspaceRegistry');
  const workspaces = typeof registry?.list === 'function' ? registry.list() : [];
  const merged = readJsonStore(target);
  const seen = new Set(merged.map((r) => r?.id).filter(Boolean));
  for (const ws of workspaces) {
    if (typeof ws?.path !== 'string' || ws.path === '') continue;
    const legacy = resolvePath(resolvePath(ws.path), LEGACY_STORE_DIR, fileName);
    const rows = readJsonStore(legacy);
    if (rows.length === 0) continue;
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || seen.has(row.id)) continue;
      merged.push({ ...row, workspaceId: row.workspaceId ?? ws.id });
      if (row.id) seen.add(row.id);
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  writeFileSync(marker, new Date().toISOString() + '\n', 'utf8');
}

/** Read one workspace's prompts from disk; a missing file is an empty list. */
function readPromptStore(filePath) {
  return readJsonStore(filePath);
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
  if (op !== '' && op !== 'restart' && op !== 'close' && op !== 'self-update' && op !== 'audit' && op !== 'job-kill' && op !== 'prompts' && op !== 'mask-rules' && op !== 'progress' && op !== 'progress-requirements' && op !== 'progress-history' && op !== 'direct-ask' && op !== 'ask-title' && op !== 'quick-replies') {
    sendJson(res, { ok: false, error: 'not-found' }, 404);
    return;
  }

  if (op === 'quick-replies') {
    const store = createQuickRepliesStore({
      file: storePath(QUICK_REPLIES_FILE),
      readFile: readFileSync,
      writeFile: writeFileSync,
      mkdir: mkdirSync,
      dirname,
    });
    if (req.method === 'GET') {
      const sessionId = typeof url.searchParams.get('sessionId') === 'string'
        ? url.searchParams.get('sessionId').trim() : '';
      sendJson(res, { ok: true, ...store.read(sessionId) });
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
        if (sessionId === '') {
          sendJson(res, { ok: false, code: 'invalid-request', error: 'sessionId is required' }, 400);
          return;
        }
        const action = body?.action === 'clear' ? 'clear' : 'set';
        if (action === 'clear') {
          const cleared = store.clearIfVersion(sessionId, typeof body?.version === 'string' ? body.version : '');
          sendJson(res, { ok: true, cleared, options: [], version: '' });
          return;
        }
        const result = store.set(sessionId, body?.options);
        sendJson(res, { ok: true, ...result });
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
      return;
    }
    sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
    return;
  }

  if (op === 'progress-requirements') {
    const filePath = storePath(PROGRESS_REQUIREMENTS_FILE);
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        // Keep the flat list form; accept {requirements: [...]} or a bare array.
        const list = Array.isArray(body?.requirements)
          ? body.requirements
          : Array.isArray(body) ? body : [];
        const records = list.filter((r) => r !== null && typeof r === 'object')
          .map((r) => ({
            id: typeof r.id === 'string' && r.id !== '' ? r.id : `req-${randomUUID()}`,
            title: typeof r.title === 'string' ? r.title : '',
            text: typeof r.text === 'string' ? r.text : '',
            workspaceId: typeof r.workspaceId === 'string' ? r.workspaceId : '',
            enabled: r.enabled !== false,
          }));
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(records, null, 2) + '\n', 'utf8');
        sendJson(res, { ok: true, requirements: records });
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
      return;
    }
    try {
      let raw;
      try { raw = JSON.parse(readFileSync(filePath, 'utf8')); } catch { raw = undefined; }
      let records = [];
      if (Array.isArray(raw)) records = raw;
      else if (raw !== null && typeof raw === 'object' && Array.isArray(raw.records)) records = raw.records;
      sendJson(res, { ok: true, requirements: records });
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
    }
    return;
  }

  if (op === 'progress-history') {
    const filePath = storePath(PROGRESS_HISTORY_FILE);
    if (req.method === 'GET') {
      try {
        const all = readJsonObject(filePath);
        sendJson(res, { ok: true, records: all.records ?? {} });
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 4 * 1024 * 1024);
        const records = body?.records !== null && typeof body?.records === 'object' ? body.records : {};
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify({ records }, null, 2) + '\n', 'utf8');
        sendJson(res, { ok: true, records });
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
      return;
    }
    sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
    return;
  }

  if (op === 'direct-ask') {
    if (req.method !== 'POST') {
      sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
      return;
    }
    let body;
    try {
      body = await readJsonBody(req, 4 * 1024 * 1024);
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error) }, 400);
      return;
    }
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const context = Array.isArray(body?.context) ? body.context : [];
    const history = Array.isArray(body?.history) ? body.history : [];
    const prompt = buildAskPrompt({ question: cleanAskText(body?.question), context });
    if (prompt === '') {
      sendJson(res, { ok: false, code: 'invalid-request', error: 'question is required' }, 400);
      return;
    }
    const llm = ctx?.get?.('llm');
    if (llm === null || typeof llm?.prepareCall !== 'function') {
      sendJson(res, { ok: false, code: 'llm-unavailable', error: 'the llm service is unavailable' }, 503);
      return;
    }
    // Prefer the current session's model; fall back to the default selection.
    let route;
    try {
      const query = ctx?.get?.('sessionQuery');
      if (sessionId !== '' && typeof query?.inspectSession === 'function') {
        route = await query.inspectSession(sessionId, (session) => session?.requestHeader?.()?.config ?? undefined);
      }
    } catch {
      /* fall through to default */
    }
    if (route === null || typeof route !== 'object' || typeof route.provider !== 'string') {
      const defaults = ctx?.get?.('agentDefaultModel');
      const selection = typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined;
      route = selection !== null && typeof selection === 'object' && typeof selection.provider === 'string'
        ? selection
        : undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    timer.unref?.();
    try {
      const answer = await directAsk({ llm, route, prompt, history, signal: controller.signal });
      sendJson(res, { ok: true, answer: answer.text, finish: answer.finish ?? null });
    } catch (error) {
      sendJson(res, { ok: false, code: error?.code ?? 'ask-failed', error: String(error?.message ?? error) }, 500);
    } finally {
      clearTimeout(timer);
    }
    return;
  }

  if (op === 'ask-title') {
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
    const firstMessage = cleanAskText(body?.firstMessage);
    if (firstMessage === '') {
      sendJson(res, { ok: false, code: 'invalid-request', error: 'firstMessage is required' }, 400);
      return;
    }
    const llm = ctx?.get?.('llm');
    if (llm === null || typeof llm?.prepareCall !== 'function') {
      sendJson(res, { ok: false, code: 'llm-unavailable', error: 'the llm service is unavailable' }, 503);
      return;
    }
    const defaults = ctx?.get?.('agentDefaultModel');
    const selection = typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined;
    const route = selection !== null && typeof selection === 'object' && typeof selection.provider === 'string'
      ? selection : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    timer.unref?.();
    try {
      const result = await generateTitle({ llm, route, firstMessage, signal: controller.signal });
      sendJson(res, { ok: true, title: result.title });
    } catch (error) {
      sendJson(res, { ok: false, code: error?.code ?? 'title-failed', error: String(error?.message ?? error) }, 500);
    } finally {
      clearTimeout(timer);
    }
    return;
  }

  if (op === 'progress') {
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
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (sessionId === '') {
      sendJson(res, { ok: false, code: 'invalid-request', error: 'sessionId is required' }, 400);
      return;
    }
    const action = ['start', 'poll', 'cancel', 'clear'].includes(body?.action) ? body.action : 'poll';
    const manager = ctx?.__powerupProgress;
    if (manager === undefined) {
      sendJson(res, { ok: false, code: 'unavailable', error: 'progress service is not ready' }, 503);
      return;
    }
    try {
      // The panel sends the full (possibly user-edited) requirements text in
      // `requirements`. It is used verbatim. The older `requirementIds`
      // selection remains as a fallback for clients that send it.
      if (typeof body?.requirements === 'string') {
        ctx.__powerupProgressText = ctx.__powerupProgressText ?? {};
        ctx.__powerupProgressText[sessionId] = body.requirements;
      } else if (Array.isArray(body?.requirementIds)) {
        ctx.__powerupProgressSelection = ctx.__powerupProgressSelection ?? {};
        ctx.__powerupProgressSelection[sessionId] = body.requirementIds.map(String);
      }
      const view = action === 'start'
        ? manager.start(sessionId)
        : action === 'cancel'
          ? manager.cancel(sessionId)
          : action === 'clear'
            ? { ...manager.poll(sessionId), history: manager.clearHistory(sessionId) }
            : manager.poll(sessionId);
      sendJson(res, { ok: true, action, ...view });
    } catch (error) {
      sendJson(res, { ok: false, code: 'progress-failed', error: String(error?.message ?? error) }, 500);
    }
    return;
  }

  if (op === 'mask-rules') {
    const filePath = storePath(MASK_RULES_FILE);
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const rules = Array.isArray(body?.rules) ? body.rules : [];
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(rules, null, 2) + '\n', 'utf8');
        sendJson(res, { ok: true, rules });
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
      return;
    }
    try {
      migrateLegacyStore(ctx, MASK_RULES_FILE);
      sendJson(res, { ok: true, rules: readJsonStore(filePath) });
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
    }
    return;
  }

  if (op === 'prompts') {
    // One central file holds prompts for every workspace; each record carries
    // its own workspaceId ('' means all workspaces). The client filters by scope.
    const filePath = promptStorePath();
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const prompts = Array.isArray(body?.prompts) ? body.prompts : [];
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(prompts, null, 2) + '\n', 'utf8');
        sendJson(res, { ok: true, prompts });
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
      return;
    }
    try {
      migrateLegacyStore(ctx, PROMPTS_FILE);
      sendJson(res, { ok: true, prompts: readPromptStore(filePath) });
    } catch (error) {
      sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
    }
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

  if (op === '' || op === 'restart' || op === 'close') {
    const action = op === 'close' ? 'close' : 'restart';
    const capability = action === 'close' ? describeClose() : describeRestart();
    if (req.method === 'GET') {
      // Expose unfinished work so the UI can gate the normal action and offer
      // the forced variant. A runtime that cannot restart still reports tasks.
      const tasks = collectRunningTasks({
          agents: ctx?.get?.('agents'),
          jobs: ctx?.get?.('jobs'),
          sessionTitle: ctx?.get?.('sessionTitle'),
        });
      sendJson(res, {
        ok: true,
        action,
        ...capability,
        runningTasks: tasks,
        hasRunningTasks: tasks.length > 0,
      });
      return;
    }
    if (req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 400);
        return;
      }
      // A client that sends no body (older UI, plugin self-update flow) keeps
      // the historical behaviour: scheduled directly, no task gate.
      const force = body?.force === true;
      const requested = body?.force === true || body?.resume === true || body?.action !== undefined;
      const tasks = requested
        ? collectRunningTasks({
          agents: ctx?.get?.('agents'),
          jobs: ctx?.get?.('jobs'),
          sessionTitle: ctx?.get?.('sessionTitle'),
        })
        : [];
      if (requested && tasks.length > 0 && !force) {
        sendJson(res, {
          ok: false,
          code: 'tasks-running',
          error: 'unfinished tasks are running; use force to stop them',
          runningTasks: tasks,
        }, 409);
        return;
      }
      let stopped = { cancelledAgents: [], killedJobs: [], errors: [] };
      let recorded = 0;
      if (requested && tasks.length > 0 && force) {
        stopped = stopUnfinishedTasks(
          { agents: ctx?.get?.('agents'), jobs: ctx?.get?.('jobs') },
          `dsh-powerup forced ${action}`,
        );
        if (body?.resume === true) {
          try {
            const filePath = storePath(TASK_RESUME_FILE_NAME);
            const records = [];
            const seen = new Set();
            for (const task of tasks) {
              if (task.kind !== 'agent' || seen.has(task.id)) continue;
              seen.add(task.id);
              records.push(createResumeRecord({
                sessionId: task.id,
                title: task.title,
                prompt: cleanResumePrompt(body?.resumePrompt),
              }, randomUUID));
            }
            if (records.length > 0) {
              mkdirSync(dirname(filePath), { recursive: true });
              const queue = mergeResumeQueue(readResumeQueue(filePath, readFileSync), records);
              writeFileSync(filePath, JSON.stringify(queue, null, 2) + '\n', 'utf8');
              recorded = records.length;
            }
          } catch (error) {
            appendSelfUpdateLog(`task-resume: could not record resumes: ${String(error?.message ?? error)}`);
          }
        }
      }
      try {
        const scheduled = action === 'close' ? requestShutdown() : requestRestart();
        sendJson(res, {
          ok: true,
          [action === 'close' ? 'closing' : 'restarting']: true,
          ...scheduled,
          stopped,
          recorded,
        });
      } catch (error) {
        sendJson(res, { ok: false, code: error?.code, error: String(error?.message ?? error) }, 409);
      }
      return;
    }
    sendJson(res, { ok: false, error: 'method-not-allowed' }, 405);
    return;
  }

  sendJson(res, { ok: false, error: 'not-found' }, 404);
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
    // Quick replies are keyed by the calling Agent's session id. The tool is
    // registered alongside step_read because both need the tools service.
    const quickStore = createQuickRepliesStore({
      file: storePath(QUICK_REPLIES_FILE),
      readFile: readFileSync,
      writeFile: writeFileSync,
      mkdir: mkdirSync,
      dirname,
    });
    scope.effect(
      () => tools.register(createQuickRepliesTool(defineTool, {
        getSessionId: () => '',
        getStore: () => quickStore,
      })),
      'dsh-powerup: quick replies',
    );
  });
  // The progress side call needs both `llm` and `sessionQuery`. Wait for them
  // through inject so a late-provided service still creates the manager.
  ctx.inject(['llm', 'sessionQuery'], (scope) => {
    // Requirements are a flat list of records: {id,title,text,workspaceId,enabled}.
    // workspaceId '' = global. The panel sends the ids it wants; the Host only
    // includes records visible to the session's workspace and explicitly picked.
    const requirementsFor = (sessionId, selectedIds, editedText) => {
      // A panel-edited full text wins verbatim (the user may freely modify the
      // concatenated requirements before generating).
      if (typeof editedText === 'string' && editedText.trim() !== '') return editedText;
      if (editedText === '') return ''; // user cleared everything on purpose
      const file = storePath(PROGRESS_REQUIREMENTS_FILE);
      let raw;
      try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        raw = undefined;
      }
      let all = [];
      if (Array.isArray(raw)) all = raw;
      else if (raw !== null && typeof raw === 'object' && Array.isArray(raw.records)) all = raw.records;
      else if (raw !== null && typeof raw === 'object') {
        // Legacy object form ({global, workspaces, sessions}) migrated on read.
        const migrated = [];
        if (typeof raw.global === 'string' && raw.global.trim() !== '') {
          migrated.push({ id: 'legacy-global', title: '通用要求', text: raw.global, workspaceId: '', enabled: true });
        }
        const ws = raw.workspaces ?? {};
        for (const [wid, text] of Object.entries(ws)) {
          if (typeof text === 'string' && text.trim() !== '') {
            migrated.push({ id: `legacy-ws-${wid}`, title: '工作区要求', text, workspaceId: wid, enabled: true });
          }
        }
        all = migrated;
      }
      let workspaceId = '';
      try {
        const registry = scope.get('workspaceRegistry');
        const list = typeof registry?.list === 'function' ? registry.list() : [];
        for (const item of Array.isArray(list) ? list : []) {
          if (Array.isArray(item?.sessionIds) && item.sessionIds.includes(sessionId)) {
            workspaceId = typeof item.id === 'string' ? item.id : '';
            break;
          }
        }
      } catch {
        /* workspace layer is optional */
      }
      const ids = Array.isArray(selectedIds) ? new Set(selectedIds.map(String)) : null;
      const parts = [];
      for (const record of all) {
        if (record === null || typeof record !== 'object') continue;
        if (record.enabled === false) continue;
        if (typeof record.text !== 'string' || record.text.trim() === '') continue;
        const wid = typeof record.workspaceId === 'string' ? record.workspaceId : '';
        if (wid !== '' && wid !== workspaceId) continue; // workspace isolation
        if (ids !== null && !ids.has(String(record.id))) continue; // panel selection
        parts.push(record.text.trim());
      }
      return parts.join('\n\n');
    };
    // Persist progress history to disk so it survives restarts and refreshes.
    const historyPath = storePath(PROGRESS_HISTORY_FILE);
    const manager = createProgressManager({
      getLlm: () => scope.get('llm'),
      getSessionQuery: () => scope.get('sessionQuery'),
      resolveRoute: (sessionId) => {
        // Fall back to the default model when a session has no captured header.
        const defaults = scope.get('agentDefaultModel');
        const selection = typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined;
        return selection !== undefined && typeof selection.provider === 'string'
          ? selection
          : undefined;
      },
      getRequirements: (sessionId) => requirementsFor(
        sessionId,
        ctx.__powerupProgressSelection?.[sessionId],
        ctx.__powerupProgressText?.[sessionId],
      ),
      onHistoryChange: (sessionId, history) => {
        try {
          const all = readJsonObject(historyPath);
          const records = all.records !== null && typeof all.records === 'object' ? all.records : {};
          records[sessionId] = history;
          mkdirSync(dirname(historyPath), { recursive: true });
          writeFileSync(historyPath, JSON.stringify({ records }, null, 2) + '\n', 'utf8');
        } catch {
          /* history is best-effort persistence */
        }
      },
    });
    // Load persisted history lazily when a session is first polled.
    const originalPoll = manager.poll;
    manager.poll = (sessionId) => {
      if (!manager.__test.histories.has(sessionId)) {
        try {
          const all = readJsonObject(historyPath);
          const records = all.records !== null && typeof all.records === 'object' ? all.records : {};
          if (Array.isArray(records[sessionId])) manager.loadHistory(sessionId, records[sessionId]);
        } catch {
          /* ignore */
        }
      }
      return originalPoll(sessionId);
    };
    ctx.__powerupProgress = manager;
    ctx.__powerupProgressSelection = ctx.__powerupProgressSelection ?? {};
    ctx.__powerupProgressText = ctx.__powerupProgressText ?? {};
    scope.effect(() => () => {
      if (ctx.__powerupProgress === manager) ctx.__powerupProgress = undefined;
    }, 'dsh-powerup: progress manager');
  });
  // Replay continuation prompts recorded by a forced restart/close once the
  // application has fully started. `sessionController.prompt` resumes cold
  // sessions internally, so no session needs to be opened by the user first.
  ctx.inject(['sessionController'], (scope) => {
    const controller = scope.get('sessionController');
    if (controller === null || typeof controller?.prompt !== 'function') return;
    const ready = ctx.appReady;
    if (ready === null || typeof ready?.onReady !== 'function') return;
    scope.effect(() => ready.onReady(() => {
      void replayPendingResumes({
        filePath: storePath(TASK_RESUME_FILE_NAME),
        sessionController: controller,
        readFile: readFileSync,
        writeFile: writeFileSync,
        mkdir: mkdirSync,
        dirname,
        randomUUID,
        logger: (line) => appendSelfUpdateLog(line),
      }).catch((error) => {
        appendSelfUpdateLog(`task-resume: uncaught ${String(error?.stack ?? error)}`);
      });
    }), 'dsh-powerup: resume tasks after restart');
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
  promptStorePath,
  readPromptStore,
  storePath,
  readJsonStore,
  migrateLegacyStore,
  PROMPTS_FILE,
  MASK_RULES_FILE,
  HOST_STARTED_AT,
  SELF_VERSION,
  ROUTE,
  MODULE_ID,
  STORE_DIR_NAME,
  TASK_RESUME_FILE_NAME,
  PROGRESS_REQUIREMENTS_FILE,
  PROGRESS_HISTORY_FILE,
  QUICK_REPLIES_FILE,
  createProgressManager,
  createQuickRepliesStore,
  createQuickRepliesTool,
  cleanResumePrompt,
  readJsonObject,
};
