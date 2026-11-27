/**
 * Offline stand-in for `@deepseek-ai/dsh-tools` (which only exists inside a
 * DSH installation). Registered by the tests through `module.registerHooks`
 * so `index.js` can keep a normal static import.
 */
/**
 * Mirror the DSH value-schema DSL rules this bundle relies on: a nested object
 * node forbids `required` and must declare `additionalProperties`. The real
 * `defineTool` throws JsonSchemaError on either violation; reproducing that
 * here keeps the offline suite honest (a bare passthrough let a bad
 * `items.required` ship in 0.19.6 and silently break tool registration).
 */
function assertSchemaNode(node, path) {
  if (node === null || typeof node !== 'object') return;
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'required')) {
      throw new Error(`unsupported JSON schema: ${path}.required is not supported by the value schema DSL`);
    }
    if (typeof node.additionalProperties !== 'boolean') {
      throw new Error(`unsupported JSON schema: ${path}.additionalProperties must be explicitly true or false`);
    }
    for (const [key, property] of Object.entries(node.properties ?? {})) {
      assertSchemaNode(property, `${path}.properties.${key}`);
    }
  } else if (node.type === 'array' && node.items !== undefined) {
    assertSchemaNode(node.items, `${path}.items`);
  }
}

export function defineTool(definition) {
  for (const [key, property] of Object.entries(definition?.parameters ?? {})) {
    assertSchemaNode(property, `parameters.${key}`);
  }
  return definition;
}

export class ToolArgsError extends Error {
  constructor(violations) {
    super(`invalid arguments: ${violations.join('; ')}`);
    this.name = 'ToolArgsError';
  }
}
