/**
 * Quick replies: the model-facing half.
 *
 * The Agent calls `powerup_quick_replies` to publish a small set of tappable
 * message options for the current session. The options are stored in the
 * central Power-Up state file; the Client polls a matching Host route and
 * renders them above the composer. The options disappear once the user sends
 * any message (clicking an option is itself a message send).
 *
 * This module holds the pure normalization/storage logic so offline tests can
 * exercise it without loading DSH packages.
 */

/** Maximum number of buttons offered at once. */
export const QUICK_REPLIES_LIMIT = 8;

/** Maximum characters of a button label. */
export const QUICK_LABEL_LIMIT = 80;

/** Maximum characters of the message a button sends. */
export const QUICK_MESSAGE_LIMIT = 4000;

/** Stable tool name registered with the Host tool registry. */
export const QUICK_REPLIES_TOOL_NAME = 'powerup_quick_replies';

export const QUICK_REPLIES_DESCRIPTION = [
  'Offer the user a short list of tappable reply options in the current conversation.',
  'Use this after answering when the next step has a few obvious choices (for example confirm, reject, or a follow-up question).',
  'Each option has a short button label and the full message that is sent when it is tapped.',
  'The options are shown above the composer and are removed automatically once the user sends any message.',
  'Pass an empty options list to clear the current options without waiting for a message.',
].join(' ');

/** Bound and clean arbitrary text. */
function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/gu, '').trim().slice(0, limit);
}

/**
 * Normalize a raw options array into a bounded, UI-safe list.
 * @param {unknown} raw
 * @returns {Array<{label: string, message: string}>}
 */
export function normalizeQuickReplies(raw) {
  if (!Array.isArray(raw)) return [];
  const options = [];
  const seen = new Set();
  for (const item of raw) {
    if (options.length >= QUICK_REPLIES_LIMIT) break;
    if (item === null || typeof item !== 'object') continue;
    // Accept both {label, message} and the convenient {label, text} alias.
    const label = cleanText(item.label ?? item.title, QUICK_LABEL_LIMIT);
    const message = cleanText(item.message ?? item.text, QUICK_MESSAGE_LIMIT);
    if (label === '' || message === '') continue;
    const key = `${label}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ label, message });
  }
  return options;
}

/**
 * Create the central-state writer used by both the tool and the HTTP route.
 * @param {{ storePath: (file: string) => string, readFile: (path: string, enc: string) => string,
 *          writeFile: (path: string, data: string, enc: string) => void,
 *          mkdir: (path: string, opts: object) => void,
 *          dirname: (path: string) => string,
 *          file: string,
 *          now?: () => number,
 *          uuid?: () => string }} deps
 */
export function createQuickRepliesStore(deps) {
  const file = deps?.file;
  const now = typeof deps?.now === 'function' ? deps.now : () => Date.now();
  const uuid = typeof deps?.uuid === 'function' ? deps.uuid : () => `q-${Math.random().toString(36).slice(2)}`;
  if (typeof file !== 'string' || file === '') throw new TypeError('createQuickRepliesStore requires a file');

  const readAll = () => {
    try {
      const parsed = JSON.parse(deps.readFile(file, 'utf8'));
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      return {};
    }
  };

  const writeAll = (all) => {
    deps.mkdir(deps.dirname(file), { recursive: true });
    deps.writeFile(file, JSON.stringify(all, null, 2) + '\n', 'utf8');
  };

  return {
    /** @param {string} sessionId */
    read(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return { options: [], version: '' };
      const record = readAll()[sessionId];
      const options = record !== null && typeof record === 'object' ? normalizeQuickReplies(record.options) : [];
      const version = record !== null && typeof record === 'object' && typeof record.version === 'string' ? record.version : '';
      return { options, version };
    },
    /**
     * Replace a session's options. An empty list removes the session record.
     * @param {string} sessionId
     * @param {unknown} rawOptions
     */
    set(sessionId, rawOptions) {
      if (typeof sessionId !== 'string' || sessionId === '') throw new TypeError('sessionId is required');
      const options = normalizeQuickReplies(rawOptions);
      const all = readAll();
      if (options.length === 0) delete all[sessionId];
      else all[sessionId] = { options, version: `${now()}-${uuid()}`, updatedAt: now() };
      writeAll(all);
      return { options, version: all[sessionId]?.version ?? '' };
    },
    /**
     * Clear a session's options only when a version matches (used when the
     * user sends a message, so a stale clear cannot erase newer options).
     * @param {string} sessionId
     * @param {string} version
     */
    clearIfVersion(sessionId, version) {
      if (typeof sessionId !== 'string' || sessionId === '') return false;
      const all = readAll();
      const record = all[sessionId];
      if (record === null || typeof record !== 'object') return false;
      if (typeof version === 'string' && version !== '' && record.version !== version) return false;
      delete all[sessionId];
      writeAll(all);
      return true;
    },
  };
}

/**
 * Build the tool definition. `defineTool` is passed in from the Host so this
 * module stays importable by offline tests.
 * @param {(definition: unknown) => any} defineTool
 * @param {{ getSessionId: () => string, getStore: () => any }} options
 */
export function createQuickRepliesTool(defineTool, options) {
  if (typeof defineTool !== 'function') throw new TypeError('createQuickRepliesTool requires defineTool');
  const getSessionId = options?.getSessionId;
  const getStore = options?.getStore;
  if (typeof getSessionId !== 'function' || typeof getStore !== 'function') {
    throw new TypeError('createQuickRepliesTool requires getSessionId and getStore');
  }

  return defineTool({
    name: QUICK_REPLIES_TOOL_NAME,
    description: QUICK_REPLIES_DESCRIPTION,
    parameters: {
      options: {
        type: 'array',
        required: true,
        description: `The reply options to show, 1-${QUICK_REPLIES_LIMIT} items. Pass [] to clear.`,
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: `Short text shown on the button (max ${QUICK_LABEL_LIMIT} characters).`,
            },
            message: {
              type: 'string',
              description: `Full message sent when the button is tapped (max ${QUICK_MESSAGE_LIMIT} characters).`,
            },
          },
          required: ['label', 'message'],
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sessionId = typeof exec?.agent?.id === 'string' ? exec.agent.id : getSessionId();
      if (typeof sessionId !== 'string' || sessionId === '') {
        return 'Quick replies were not published: no current session is available.';
      }
      if (exec?.signal?.aborted) return 'Quick replies were not published: the call was cancelled.';
      const store = getStore();
      const result = store.set(sessionId, args?.options);
      if (result.options.length === 0) return 'Quick reply options were cleared.';
      const lines = result.options.map((o, i) => `${i + 1}. ${o.label} → ${o.message}`);
      return `Published ${result.options.length} quick reply option(s):\n${lines.join('\n')}`;
    },
  });
}
