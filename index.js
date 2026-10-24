/**
 * Host half of dsh-powerup.
 *
 * The plugin is primarily a Client UI upgrade. This Host entry exists for one
 * operation the browser cannot perform itself: restarting the whole DSH
 * desktop application after a plugin update. It exposes a small loopback-only
 * route under `/dsh-powerup/api`:
 *
 *   GET  /dsh-powerup/api/restart   → { ok, supported, reason? }
 *   POST /dsh-powerup/api/restart   → schedules the restart, then answers
 *
 * The Client half drives plugin installation through the built-in
 * `pluginManager` Remote; only the process restart needs Host code.
 */

import { describeRestart, requestRestart } from './lib/restart.js';

/** Prefix owned by this plugin. */
const ROUTE = '/dsh-powerup/api';

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
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(req, res) {
  if (!isLoopback(req) || !sameOrigin(req)) {
    sendJson(res, { ok: false, error: 'forbidden' }, 403);
    return;
  }

  const url = new URL(req.url ?? ROUTE, 'http://localhost');
  const op = url.pathname.slice(ROUTE.length).replace(/^\/+/u, '') || url.searchParams.get('op') || '';
  if (op !== '' && op !== 'restart') {
    sendJson(res, { ok: false, error: 'not-found' }, 404);
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
 * Mount the restart route once the Web server exists.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (ctx === undefined || typeof ctx.inject !== 'function') return;
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.get('webServer');
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    scope.effect(
      () => webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }),
      'dsh-powerup: restart route',
    );
  });
}

/** Exported for tests only; the Host never reads this. */
export const __test = { handle, isLoopback, sameOrigin, ROUTE };
