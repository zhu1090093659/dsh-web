/**
 * Enforced JSON Schema subset shared by tool outputs, generated Code Mode
 * types, subagents, and workflows. The subset accepts any JSON root, an
 * annotation-only schema for unconstrained JSON, one scalar `type`, object
 * `properties`/`required`/boolean `additionalProperties`, array `items`,
 * type-correct scalar `enum`/`const`, and exact-one `oneOf`.
 *
 * Unsupported or misplaced keywords reject rather than being accepted without
 * enforcement. Consumers that require an object root apply
 * {@link assertObjectJsonSchema} before accepting input.
 * @module dsh-tools/json-schema
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { type JsonValue } from '@deepseek-ai/dsh-session';
/** Scalar JSON values supported by `enum` and `const`. */
export type JsonSchemaScalar = string | number | boolean | null;
/** Single-type keywords accepted by the enforced subset. */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
export interface JsonSchemaNode {
    /** Omit with no constraints for any JSON value, or use `oneOf`. */
    type?: JsonSchemaType;
    /** Exactly one branch must validate; at least two branches are required. */
    oneOf?: JsonSchemaNode[];
    /** Nested property schemas (`type: 'object'` only). */
    properties?: Record<string, JsonSchemaNode>;
    /** Required property names; each must appear in `properties`. */
    required?: string[];
    /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
    additionalProperties?: boolean;
    /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
    items?: JsonSchemaNode;
    /** Allowed values for a scalar node. */
    enum?: JsonSchemaScalar[];
    /** The single allowed value for a scalar node. */
    const?: JsonSchemaScalar;
    /** Annotation, ignored for validation. */
    description?: string;
    /** Annotation, ignored for validation. */
    title?: string;
    /** Annotation, ignored for validation but required to be lossless JSON. */
    default?: JsonValue;
    /** Annotation, ignored for validation but required to be lossless JSON. */
    examples?: JsonValue;
}
/** A consumer-constrained object-rooted schema. */
export type ObjectJsonSchema = JsonSchemaNode & {
    type: 'object';
};
/**
 * Thrown when a raw schema falls outside the enforced subset. `violations`
 * lists every offending path instead of stopping at the first author error.
 */
export declare class JsonSchemaError extends HarnessError {
    /** Individual schema violations in walk order. */
    readonly violations: string[];
    constructor(violations: string[]);
}
/**
 * Test for a realm-agnostic plain JSON record without accepting arrays or
 * exotic objects.
 * @param value - candidate record from any JavaScript realm.
 * @returns Whether the value has a plain-object prototype chain.
 */
export declare function isPlainJsonRecord(value: unknown): value is Record<string, unknown>;
/**
 * Test for an ordinary schema record whose keys survive JSON projection.
 * @param value - candidate record from any JavaScript realm.
 * @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
 */
export declare function isJsonSchemaRecord(value: unknown): value is Record<string, unknown>;
/**
 * Test for a dense ordinary array with no JSON-invisible decorations.
 * @param value - candidate array from any JavaScript realm.
 * @returns Whether the array is intrinsic, dense, and undecorated.
 */
export declare function isPlainJsonArray(value: unknown): value is unknown[];
/**
 * Assert that an arbitrary raw schema uses only the enforced subset.
 * Annotation-only schemas are accepted as the standard unconstrained-JSON
 * form; callers that require an object root use {@link assertObjectJsonSchema}.
 * @param schema - untrusted raw JSON Schema.
 * @returns Assertion that the schema belongs to the supported subset.
 */
export declare function assertSupportedJsonSchema(schema: unknown): asserts schema is JsonSchemaNode;
/**
 * Assert the enforced subset plus the object-root constraint retained by
 * subagent and workflow structured outputs.
 * @param schema - untrusted caller-supplied schema.
 * @returns Assertion that the schema belongs to the supported subset and has an object root.
 */
export declare function assertObjectJsonSchema(schema: unknown): asserts schema is ObjectJsonSchema;
/**
 * Validate a candidate value against an asserted raw schema. The function is
 * total for arbitrary values and returns path-qualified violations.
 * @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
 * @param value - the candidate JSON value.
 * @param path - root label used in diagnostics.
 * @returns All violations in walk order; empty means valid.
 */
export declare function validateJsonSchemaValue(schema: JsonSchemaNode, value: unknown, path?: string): string[];
//# sourceMappingURL=json-schema.d.ts.map