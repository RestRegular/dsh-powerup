/**
 * dsh-powerup — restart the whole DSH desktop app.
 *
 * The Host half runs inside the `dsh-desktop-host` child process, whose parent
 * is the Electron main process. The desktop shell exposes shutdown and update
 * controls over IPC but no "restart application" request, so this module
 * starts a detached helper (`restart-helper.cjs`), lets the HTTP response
 * settle, then ends the Electron main process. The helper waits for this Host
 * to exit and relaunches the same executable.
 *
 * Only the Electron desktop build supports this. A plain `dsh web` process
 * reports the reason instead, and the UI hides the action.
 *
 * The mechanism is adapted from dsh-pocket's restart module (same profile,
 * verified on this machine).
 *
 * @module dsh-powerup/restart
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Helper shipped beside this module. */
const HELPER_PATH = fileURLToPath(new URL('./restart-helper.cjs', import.meta.url));

/** Let the UI paint its "restarting" state and the HTTP response settle. */
const ACTION_DELAY_MS = 1500;

/** One helper per process, even if the button is clicked twice. */
let scheduled = false;

/**
 * The DSH home directory, matching the launcher's `DSH_HOME` handling.
 * @returns {string}
 */
function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return join(homedir(), '.dsh');
}

/**
 * Whether this runtime can restart the whole application.
 * @returns {{ supported: boolean, reason?: string }}
 */
export function describeRestart() {
  if (process.versions.electron === undefined) {
    return {
      supported: false,
      reason: 'DSH is running as a command-line web process (dsh web); restart it from the terminal.',
    };
  }
  if (typeof process.execPath !== 'string' || process.execPath.length === 0 || !existsSync(process.execPath)) {
    return { supported: false, reason: 'The DSH executable could not be located.' };
  }
  const mainPid = process.ppid;
  if (!Number.isInteger(mainPid) || mainPid <= 1) {
    return { supported: false, reason: 'The DSH main process could not be located.' };
  }
  return { supported: true };
}

/**
 * Schedule a full application restart. The caller must finish its HTTP
 * response; the helper waits {@link ACTION_DELAY_MS} before acting.
 *
 * @returns {{ supported: true, action: 'restart', pid: number | undefined, pending: boolean }}
 * @throws {Error} with `code = 'restart-unsupported'` outside the desktop app.
 */
export function requestRestart() {
  const capability = describeRestart();
  if (!capability.supported) {
    const error = new Error(capability.reason ?? 'This runtime cannot restart DSH.');
    error.code = 'restart-unsupported';
    throw error;
  }
  if (scheduled) return { supported: true, action: 'restart', pid: undefined, pending: true };
  scheduled = true;

  const executable = process.execPath;
  const logPath = join(dshHome(), 'powerup', 'restart.log');
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {
    /* The log directory is optional; the helper tolerates a missing path. */
  }

  let child;
  try {
    child = spawn(process.execPath, [
      HELPER_PATH,
      executable,
      String(process.ppid),
      String(process.pid),
      dirname(executable),
      '[]',
      'restart',
      String(ACTION_DELAY_MS),
    ], {
      cwd: dirname(executable),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_POWERUP_RESTART_LOG: logPath,
      },
    });
  } catch (error) {
    scheduled = false;
    throw error;
  }
  if (child.pid === undefined) {
    scheduled = false;
    const error = new Error('The restart helper could not be started.');
    error.code = 'restart-helper-failed';
    throw error;
  }
  child.unref();
  child.on('error', () => {
    scheduled = false;
  });
  return { supported: true, action: 'restart', pid: child.pid, pending: false };
}

/**
 * Reset the one-shot latch; exported for tests only.
 * @internal
 */
export function __resetScheduled() {
  scheduled = false;
}
