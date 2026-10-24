/**
 * dsh-powerup — detached restart helper (runs in Electron's Node mode).
 *
 * Started by `lib/restart.js` with `detached: true`. It waits for the UI
 * notice and the HTTP response to settle, ends the Electron main process, waits
 * for the old Host to exit, then relaunches the same executable.
 *
 * Arguments:
 *   1. exe        desktop executable (`process.execPath`)
 *   2. mainPid    Electron main process pid (the Host's parent)
 *   3. hostPid    this Host process pid
 *   4. appDir     application directory, used as the new process cwd
 *   5. argsJson   optional JSON array of launch arguments (normally empty)
 *   6. mode       `restart` (default); `shutdown` is reserved for future use
 *   7. delayMs    grace period before acting (default 1500 ms)
 *
 * Environment:
 *   DSH_POWERUP_RESTART_LOG  optional path for a one-line run log.
 *
 * Adapted from dsh-pocket's restart helper.
 *
 * @module dsh-powerup/restart-helper
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');

/** Wait for the UI notice and the HTTP response before ending the main process. */
const RESPONSE_GRACE_MS = 1500;
/** Upper bound for the old Host's graceful shutdown. */
const HOST_EXIT_TIMEOUT_MS = 15000;
/** Let the OS release the single-instance lock and file handles. */
const RELAUNCH_DELAY_MS = 1200;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Whether a process is alive; an access-denied answer counts as alive.
 * @param {number} pid
 * @returns {boolean}
 */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error !== null && typeof error === 'object' && error.code === 'EPERM';
  }
}

/**
 * Poll until the process exits or the deadline passes.
 * @param {number} pid
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
async function waitGone(pid, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await sleep(120);
  }
  return !alive(pid);
}

/**
 * Terminate a process; failures are logged, not thrown.
 * @param {number} pid
 * @param {(message: string) => void} log
 */
function terminate(pid, log) {
  if (!alive(pid)) return;
  try {
    process.kill(pid);
    log(`terminated pid=${String(pid)}`);
  } catch (error) {
    log(`terminate pid=${String(pid)} failed: ${String(error && error.message ? error.message : error)}`);
  }
}

/**
 * Parse the optional launch arguments.
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseArgs(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Parse the grace period, clamped to 0–10 seconds.
 * @param {string | undefined} raw
 * @returns {number}
 */
function parseDelay(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return RESPONSE_GRACE_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return RESPONSE_GRACE_MS;
  return Math.min(value, 10000);
}

async function main() {
  const [exe, mainPidRaw, hostPidRaw, appDir, argsRaw, modeRaw, delayRaw] = process.argv.slice(2);
  const mode = modeRaw === 'shutdown' ? 'shutdown' : 'restart';
  const delayMs = parseDelay(delayRaw);
  const mainPid = Number(mainPidRaw);
  const hostPid = Number(hostPidRaw);
  const logPath = process.env.DSH_POWERUP_RESTART_LOG;
  /** @param {string} message */
  const log = (message) => {
    if (typeof logPath !== 'string' || logPath.length === 0) return;
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
    } catch {
      /* A missing log never blocks the action. */
    }
  };

  if (typeof exe !== 'string' || exe.length === 0) {
    log('missing executable');
    process.exit(2);
  }

  log(`scheduled mode=${mode} exe=${exe} main=${String(mainPid)} host=${String(hostPid)} delay=${String(delayMs)}`);
  await sleep(delayMs);

  // The Host exits on its own when the main process goes away; only the main
  // process is terminated outright.
  terminate(mainPid, log);
  if (!(await waitGone(mainPid, 5000))) {
    log('main still alive; retrying');
    terminate(mainPid, log);
    if (!(await waitGone(mainPid, 3000))) {
      log('main did not exit; aborting');
      process.exit(1);
    }
  }
  if (!(await waitGone(hostPid, HOST_EXIT_TIMEOUT_MS))) {
    log('host did not exit in time; terminating it');
    terminate(hostPid, log);
    await waitGone(hostPid, 3000);
  }

  if (mode === 'shutdown') {
    log('shutdown complete; not relaunching');
    process.exit(0);
  }

  await sleep(RELAUNCH_DELAY_MS);

  const env = { ...process.env };
  // These keep a new process in Node mode; the relaunched app must not inherit them.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  delete env.DSH_DESKTOP_NODE_EXECUTABLE;
  delete env.DSH_POWERUP_RESTART_LOG;

  const child = spawn(exe, parseArgs(argsRaw), {
    cwd: typeof appDir === 'string' && appDir.length > 0 ? appDir : undefined,
    env,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  child.on('error', (error) => {
    log(`spawn failed: ${String(error && error.message ? error.message : error)}`);
    process.exit(1);
  });
  child.unref();
  log(`launched pid=${String(child.pid)}`);

  // Give spawn a moment to report a pid or an error, then exit.
  await sleep(400);
  process.exit(0);
}

main().catch((error) => {
  try {
    console.error(error);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
