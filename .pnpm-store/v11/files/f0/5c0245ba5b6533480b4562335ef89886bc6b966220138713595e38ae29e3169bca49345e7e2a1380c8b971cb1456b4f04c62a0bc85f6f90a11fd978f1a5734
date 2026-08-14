/**
 * Code Mode codegen: the pure projection from registered tool schemas to the TypeScript SDK
 * text the model programs against (the `tools:sdk` prompt section). Sibling of
 * `json-schema.ts` — `schemas()` (native function calling) and this module (the generated
 * `declare const tools` API) are two projections of the same store.
 * @module @deepseek-ai/dsh-tools/src/ts-types
 */
import type { ToolSchema } from '@deepseek-ai/dsh-llm';
import type { JsonSchemaNode } from './json-schema.ts';
/** Internal Code Mode projection: the model-facing schema plus the canonical output schema. */
export interface ToolSdkSchema extends ToolSchema {
    /** Validated canonical value returned by the tool binding. */
    output: JsonSchemaNode;
}
/**
 * Map one enforced JSON-Schema node to a TypeScript type literal. Supports
 * every unified schema construct and returns `unknown` for malformed or
 * unsupported inputs without throwing.
 * @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
 * @param indent - the indentation level for nested object members.
 * @returns the TS type text (multi-line for objects with properties).
 */
export declare function jsonSchemaToTs(schema: unknown, indent?: number): string;
/**
 * Render the full `tools:sdk` prompt section: the fixed usage instructions
 * plus one `declare const tools` interface covering every given tool.
 * Deterministic — tools are emitted in lexicographic name order, so an
 * unchanged tool set produces byte-identical text across assemblies. The sort
 * is not a total order on byte-equal names, so two schemas sharing a name
 * would render in argument order; the caller's visible-capability map is keyed
 * by name, so the input never carries a duplicate.
 * @param schemas - the tool schemas to declare (the caller excludes
 *   `run_code` itself).
 * @returns the complete section text.
 */
export declare function renderToolsSdk(schemas: ToolSdkSchema[]): string;
//# sourceMappingURL=ts-types.d.ts.map