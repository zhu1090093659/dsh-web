/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { JsonValue } from '@deepseek-ai/dsh-session';
import type { ToolDefinition, ToolExecution, ToolExecutionResult, ToolRunContext, ToolResult } from './index.ts';
import type { JsonSchemaNode, ObjectJsonSchema } from './json-schema.ts';
import type { ToolCallView, ToolResultView } from './presentation.ts';
/** Annotation keywords shared by every author-facing schema node. */
export interface ValueSchemaAnnotations {
    /** Human-readable description projected into JSON Schema and generated types. */
    description?: string;
    /** Human-readable title projected into JSON Schema. */
    title?: string;
    /** Non-validating default annotation; it must be lossless JSON data. */
    default?: JsonValue;
    /** Non-validating examples annotation; it must be lossless JSON data. */
    examples?: JsonValue;
}
/** String value schema with type-correct literal constraints. */
export interface StringValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'string';
    enum?: readonly string[];
    const?: string;
}
/** Finite JSON-number schema with type-correct literal constraints. */
export interface NumberValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'number';
    enum?: readonly number[];
    const?: number;
}
/** Integer schema with type-correct literal constraints. */
export interface IntegerValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'integer';
    enum?: readonly number[];
    const?: number;
}
/** Boolean value schema with type-correct literal constraints. */
export interface BooleanValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'boolean';
    enum?: readonly boolean[];
    const?: boolean;
}
/** Null value schema with type-correct literal constraints. */
export interface NullValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'null';
    enum?: readonly null[];
    const?: null;
}
/** Array value schema; omitted `items` accepts any lossless JSON item. */
export interface ArrayValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'array';
    items?: ValueSchemaSpec;
}
/**
 * Explicit object value schema. Openness is mandatory so a nested or output
 * object never acquires an accidental JSON Schema default.
 */
export interface ObjectValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'object';
    properties?: ParameterSchemaSpec;
    additionalProperties: boolean;
}
/** Author-only unconstrained lossless JSON node. */
export interface JsonValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'json';
}
/** Exact-one union schema; at least two branches are required. */
export interface OneOfValueSchemaSpec extends ValueSchemaAnnotations {
    oneOf: readonly [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]];
}
/** One author-facing schema for any lossless JSON value root. */
export type ValueSchemaSpec = StringValueSchemaSpec | NumberValueSchemaSpec | IntegerValueSchemaSpec | BooleanValueSchemaSpec | NullValueSchemaSpec | ArrayValueSchemaSpec | ObjectValueSchemaSpec | JsonValueSchemaSpec | OneOfValueSchemaSpec;
/** One implicit parameter-root property, optionally required. */
export type ParameterPropertySpec = ValueSchemaSpec & {
    required?: true;
};
/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
export type ParameterSchemaSpec = {
    [key: string]: ParameterPropertySpec;
    [key: symbol]: never;
};
/** Raw JSON Schema projection of the implicit parameter object. */
export interface ParameterJsonSchema extends ObjectJsonSchema {
    properties: Record<string, JsonSchemaNode>;
}
/** Flatten an intersection into one object type for readable hovers. */
type Simplify<T> = {
    [K in keyof T]: T[K];
} & {};
/** String keys of one property map; runtime compilation rejects symbol keys. */
type StringKeyOf<S> = Extract<keyof S, string>;
/** Keys of a property map marked `required: true`. */
type RequiredKeys<S> = {
    [K in StringKeyOf<S>]: S[K] extends {
        required: true;
    } ? K : never;
}[StringKeyOf<S>];
/** Infer the declared value of one parameter property without key optionality. */
type InferProperty<P, Depth extends unknown[]> = InferValueAt<P, Depth>;
/** Infer an implicit property map into required and optional object keys. */
type InferProperties<S, Depth extends unknown[]> = Simplify<{
    [K in RequiredKeys<S>]: InferProperty<S[K], Depth>;
} & {
    [K in Exclude<StringKeyOf<S>, RequiredKeys<S>>]?: InferProperty<S[K], Depth>;
}>;
/** Infer an explicit object node, including its declared openness. */
type InferObject<S extends {
    additionalProperties: boolean;
}, Depth extends unknown[]> = S extends {
    properties: infer P;
} ? S['additionalProperties'] extends true ? InferProperties<P, Depth> & Record<string, JsonValue> : InferProperties<P, Depth> : S['additionalProperties'] extends true ? Record<string, JsonValue> : Record<string, never>;
/** Infer a scalar node's literal constraint before its broad primitive type. */
type InferScalar<S, Fallback> = S extends {
    const: infer C;
} ? C : S extends {
    enum: readonly (infer E)[];
} ? E : Fallback;
/** Add one schema-container level to bounded compile-time inference. */
type NextInferenceDepth<Depth extends unknown[]> = [unknown, ...Depth];
/** Infer one node without recursively checking it against the full author union. */
type InferValueAt<S, Depth extends unknown[]> = Depth['length'] extends 16 ? JsonValue : S extends {
    type: 'string';
} ? InferScalar<S, string> : S extends {
    type: 'number' | 'integer';
} ? InferScalar<S, number> : S extends {
    type: 'boolean';
} ? InferScalar<S, boolean> : S extends {
    type: 'null';
} ? null : S extends {
    type: 'array';
} ? S extends {
    items: infer I;
} ? InferValueAt<I, NextInferenceDepth<Depth>>[] : JsonValue[] : S extends {
    type: 'object';
    additionalProperties: boolean;
} ? InferObject<S, NextInferenceDepth<Depth>> : S extends {
    type: 'json';
} ? JsonValue : S extends {
    oneOf: readonly unknown[];
} ? InferValueAt<S['oneOf'][number], NextInferenceDepth<Depth>> : never;
/**
 * Infer the TypeScript value accepted by an author-facing value schema. Exact
 * inference is bounded to 16 container levels, then falls back to `JsonValue`.
 */
export type InferValue<S> = InferValueAt<S, []>;
/** Infer the TypeScript argument object for an implicit parameter schema. */
export type InferArgs<S> = InferProperties<S, []>;
/**
 * Compile one author-facing value schema to the enforced raw JSON Schema
 * subset. The author-only `json` node becomes an annotation-only schema.
 * @param spec - schema for any JSON-value root.
 * @returns The asserted raw schema projection.
 */
export declare function valueSchemaSpecToJsonSchema(spec: ValueSchemaSpec): JsonSchemaNode;
/**
 * Compile the implicit open parameter object into raw JSON Schema.
 * @param spec - per-property parameter definitions.
 * @returns An object-rooted raw schema with no implicit-root openness override.
 */
export declare function parameterSchemaSpecToJsonSchema(spec: ParameterSchemaSpec): ParameterJsonSchema;
/** Invalid model-generated arguments for a typed tool. */
export declare class ToolArgsError extends HarnessError {
    /** Individual violations in schema-walk order. */
    readonly violations: string[];
    constructor(violations: string[]);
}
/**
 * Validate model-generated arguments against an implicit parameter schema.
 * @param spec - declared parameter schema.
 * @param args - candidate arguments, however malformed.
 * @returns Path-qualified violations; empty means valid.
 */
export declare function validateArgs(spec: ParameterSchemaSpec, args: unknown): string[];
/** Options for {@link defineTool}. */
export interface DefineToolOptions<S extends ParameterSchemaSpec, O extends ValueSchemaSpec> {
    /** Tool name (must be unique). */
    readonly name: string;
    /** Human-readable description sent to the model. */
    readonly description: string;
    /** Per-property parameter schema compiled to an implicit open object root. */
    readonly parameters: S;
    /** Canonical output schema plus pure Native and presentation projections. */
    readonly output: {
        /** Schema enforced against every successful body or policy-replaced value. */
        readonly schema: O;
        /** Pure Native/model rendering of one validated canonical value. */
        render(args: InferArgs<S>, value: InferValue<NoInfer<O>>): ContentBlock[];
        /** Pure replayable presentation metadata for direct top-level calls. */
        presentationMeta?(args: InferArgs<S>, value: InferValue<NoInfer<O>>): JsonValue;
    };
    /** Optional positive cooperative timeout budget in milliseconds. */
    readonly timeoutMs?: number;
    /**
     * Pure classifier for sibling overlap.
     * @param args - typed validated arguments.
     * @returns Whether the call may join a parallel group.
     */
    isConcurrencySafe?(args: InferArgs<S>): boolean;
    /**
     * Execute the tool after argument validation.
     * @param args - typed validated arguments.
     * @param exec - execution identity, caller, cancellation, and nesting data.
     * @returns The canonical value declared by `output.schema`.
     */
    execute(args: InferArgs<S>, exec: ToolRunContext): Promise<InferValue<NoInfer<O>>>;
    /**
     * Optional last-mile content transform for every normalized outcome. Unlike
     * `execute`, arguments remain `unknown` because invalid-input failures also
     * reach this callback. See {@link ToolDefinition.finalizeContent}.
     * @param exec - immutable execution identity and arguments.
     * @param result - complete normalized outcome before materialization.
     * @returns replacement content, or `undefined` to preserve it.
     */
    finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined;
    /**
     * Pure pending-state presenter.
     * @param args - typed validated arguments.
     * @returns Tool-owned render intent, or `undefined` for the generic card.
     */
    presentCall?(args: InferArgs<S>): ToolCallView | undefined;
    /**
     * Pure completed-state presenter.
     * @param args - typed validated arguments.
     * @param result - final model-facing tool result.
     * @returns Tool-owned render intent, or `undefined` for the generic card.
     */
    presentResult?(args: InferArgs<S>, result: ToolResult): ToolResultView | undefined;
}
/**
 * Define a first-party tool with inferred arguments and strict execution
 * validation. Replay-only presenters validate softly and fall back to generic
 * rendering for obsolete logged arguments.
 * @param options - typed definition and optional finalizer and presenters.
 * @returns A registry-ready definition.
 */
export declare function defineTool<const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(options: DefineToolOptions<S, O>): ToolDefinition;
export {};
//# sourceMappingURL=schema.d.ts.map