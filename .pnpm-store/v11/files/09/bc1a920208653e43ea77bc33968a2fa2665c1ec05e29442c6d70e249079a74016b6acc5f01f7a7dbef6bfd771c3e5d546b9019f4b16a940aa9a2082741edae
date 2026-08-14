/**
 * Code Mode codegen — Python flavor. The pure projection from registered tool schemas to the
 * Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of
 * {@link ./ts-types.ts | ts-types.ts}; the two files are two projections of the same registry
 * store, keyed by the loaded {@link @deepseek-ai/dsh-code-runtime#CodeRuntime.language | code
 * runtime's language}.
 *
 * Under `mode: 'code'` the native tool schemas are omitted from the request, so this generated
 * SDK is the model's ONLY source for each tool's argument names, required fields, types,
 * descriptions, and canonical output shapes; under `mode: 'both'` the native schemas ship
 * alongside it and it is one of two. Object-shaped arguments and outputs therefore render as one
 * named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the
 * shape survives into the program under the mode that has nothing else to carry it.
 * @module @deepseek-ai/dsh-tools/src/py-types
 */
import type { ToolSdkSchema } from './ts-types.ts';
/**
 * Map one JSON-Schema node to a context-free Python type expression from the
 * `typing` module. Handles every unified schema construct — `object` (degraded
 * to `dict[str, Any]`: naming a `TypedDict` requires the render context that
 * {@link renderToolsSdkPy} supplies), `const`/`enum` (→ `Literal[...]`),
 * `oneOf` (→ union), `string`/`number`/`integer`/`boolean`/`null`, `array`
 * (`items` → `list[T]`) — and returns `Any` for an unsupported or malformed
 * schema, matching the TS flavor's `unknown` fallback. Type annotations in the
 * emitted SDK are advisory: Python does not enforce them at runtime.
 * @param schema - the JSON-Schema node.
 * @returns the Python type text.
 */
export declare function jsonSchemaToPy(schema: unknown): string;
/**
 * Render the full `tools:sdk` prompt section under `runtime.language ===
 * 'python'`: the Python-flavored usage instructions plus one named `TypedDict`
 * per tool argument or output object (and per nested object) and one awaitable
 * method per visible tool on a `Tools` protocol — typed args in, the tool's
 * canonical output value out — with a `tools: Tools` singleton the model calls
 * into. The `typing` import line lists exactly the symbols the render used.
 * Deterministic — tools are emitted in lexicographic name order, and class
 * declarations precede the protocol in that same order (nested classes before
 * the parent that references them), so an unchanged tool set produces
 * byte-identical text across assemblies. The sort is not a total order on
 * byte-equal names, so two schemas sharing a name would render in argument
 * order; the caller's visible-capability map is keyed by name, so the input
 * never carries a duplicate.
 * @param schemas - the tool schemas plus canonical output schemas to declare
 *   (the caller excludes `run_code` itself).
 * @returns the complete section text.
 */
export declare function renderToolsSdkPy(schemas: ToolSdkSchema[]): string;
//# sourceMappingURL=py-types.d.ts.map