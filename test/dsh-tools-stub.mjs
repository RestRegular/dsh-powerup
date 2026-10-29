/**
 * Offline stand-in for `@deepseek-ai/dsh-tools` (which only exists inside a
 * DSH installation). Registered by the tests through `module.registerHooks`
 * so `index.js` can keep a normal static import.
 */
export function defineTool(definition) {
  return definition;
}

export class ToolArgsError extends Error {
  constructor(violations) {
    super(`invalid arguments: ${violations.join('; ')}`);
    this.name = 'ToolArgsError';
  }
}
