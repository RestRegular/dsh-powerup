/**
 * The model-facing half of step references: one read-only tool that turns a
 * `dsh-step:` reference copied from the Trajectory menu into raw session data.
 *
 * The factory takes the Host's `defineTool` so this module stays importable by
 * the offline tests without resolving a DSH package import.
 */

import { readStepReference, STEP_READ_TOOL_NAME } from './step-reference.js';

/** Default cooperative deadline for one read. */
export const STEP_READ_TIMEOUT_MS = 30_000;

export const STEP_READ_DESCRIPTION = [
  'Read the complete raw data behind a Power-Up step reference copied from the Trajectory ledger.',
  'The reference looks like dsh-step:<sessionId>/<stepId>; copy one with the Trajectory right-click menu (Copy step reference).',
  'A turn/step reference returns every raw session event of that assistant step (message, tool calls, tool results, attempts);',
  'a call reference returns the tool call and its result; a seq reference returns that single event.',
  'Raw events are returned as JSON. System-prompt/tool-schema request snapshots are omitted by default; pass requests=true to include them.',
].join(' ');

/**
 * @param {(definition: unknown) => any} defineTool the Host's tool DSL
 * @param {{ getSessionQuery: () => any }} options
 * @returns {any} a ToolDefinition for `ctx.tools.register`
 */
export function createStepReadTool(defineTool, options) {
  if (typeof defineTool !== 'function') throw new TypeError('createStepReadTool requires defineTool');
  const getSessionQuery = options?.getSessionQuery;
  if (typeof getSessionQuery !== 'function') throw new TypeError('createStepReadTool requires getSessionQuery');

  return defineTool({
    name: STEP_READ_TOOL_NAME,
    description: STEP_READ_DESCRIPTION,
    parameters: {
      ref: {
        type: 'string',
        required: true,
        description: 'The dsh-step:<sessionId>/<stepId> reference exactly as copied from the Trajectory menu.',
      },
      before: {
        type: 'integer',
        description: `Extra raw events to include before the step (0-50, default 0).`,
      },
      after: {
        type: 'integer',
        description: `Extra raw events to include after the step (0-50, default 0).`,
      },
      requests: {
        type: 'boolean',
        description: 'Include request/header snapshots (the full system prompt and tool schemas). Default false.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    timeoutMs: STEP_READ_TIMEOUT_MS,
    async execute(args, exec) {
      const sessionQuery = getSessionQuery();
      const payload = await readStepReference(
        sessionQuery,
        args.ref,
        { before: args.before, after: args.after, requests: args.requests === true },
        exec?.signal,
      );
      return JSON.stringify(payload, null, 2);
    },
  });
}
