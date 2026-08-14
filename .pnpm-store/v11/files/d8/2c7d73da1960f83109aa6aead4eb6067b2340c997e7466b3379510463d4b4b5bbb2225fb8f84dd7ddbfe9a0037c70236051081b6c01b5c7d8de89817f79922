/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { assertSupportedJsonSchema, isJsonSchemaRecord, isPlainJsonArray, JsonSchemaError, validateJsonSchemaValue } from "./json-schema.js";
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples'];
/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
    throw new JsonSchemaError([message]);
}
/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
    if (Object.hasOwn(source, 'description'))
        target.description = source.description;
    if (Object.hasOwn(source, 'title'))
        target.title = source.title;
    if (Object.hasOwn(source, 'default'))
        target.default = source.default;
    if (Object.hasOwn(source, 'examples'))
        target.examples = source.examples;
}
/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
    for (const key of Object.keys(source)) {
        if (!allowed.includes(key))
            authorError(`${path}.${key} is not supported by the value schema DSL`);
    }
}
/** Install a compiled node without giving `__proto__` assignment semantics. */
function assignCompiledNode(destination, node) {
    switch (destination.kind) {
        case 'root':
            destination.holder.value = node;
            break;
        case 'property':
            Object.defineProperty(destination.target, destination.key, {
                value: node,
                enumerable: true,
                configurable: true,
                writable: true,
            });
            break;
        case 'item':
            destination.target.items = node;
            break;
        case 'one-of':
            destination.target[destination.index] = node;
            break;
    }
}
/** Install a compiled property map at its root or containing object node. */
function assignCompiledPropertyMap(destination, compiled) {
    if (destination.kind === 'root') {
        destination.holder.value = compiled;
    }
    else {
        destination.target.properties = compiled.properties;
    }
}
/** Execute an author-schema compilation task graph without recursive descent. */
function runSchemaCompiler(initial) {
    const seen = new Set();
    const tasks = [initial];
    for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
        if (task.kind === 'leave') {
            seen.delete(task.input);
            continue;
        }
        if (task.kind === 'property-map-tail') {
            if (task.required.length > 0) {
                task.compiled.required = task.required;
                if (task.destination.kind === 'object')
                    task.destination.target.required = task.required;
            }
            continue;
        }
        if (task.kind === 'property') {
            if (!isJsonSchemaRecord(task.property))
                authorError(`${task.path} must be a value schema object`);
            if (Object.hasOwn(task.property, 'required') && task.property.required !== true) {
                authorError(`${task.path}.required must be true when present`);
            }
            if (Object.hasOwn(task.property, 'required') && task.property.required === true)
                task.required.push(task.key);
            tasks.push({
                kind: 'value',
                input: task.property,
                path: task.path,
                allowRequired: true,
                destination: { kind: 'property', target: task.properties, key: task.key },
            });
            continue;
        }
        if (task.kind === 'property-map') {
            if (!isJsonSchemaRecord(task.input))
                authorError(`${task.path} must be an object of value schemas`);
            if (seen.has(task.input))
                authorError(`${task.path} is circular`);
            seen.add(task.input);
            const compiled = { properties: {} };
            const required = [];
            assignCompiledPropertyMap(task.destination, compiled);
            tasks.push({ kind: 'leave', input: task.input });
            tasks.push({ kind: 'property-map-tail', compiled, required, destination: task.destination });
            const entries = Object.entries(task.input);
            for (let index = entries.length - 1; index >= 0; index--) {
                const entry = entries[index];
                /* v8 ignore next -- the loop is bounded by the captured entry count. */
                if (entry === undefined)
                    continue;
                tasks.push({
                    kind: 'property',
                    property: entry[1],
                    path: `${task.path}.${entry[0]}`,
                    key: entry[0],
                    properties: compiled.properties,
                    required,
                });
            }
            continue;
        }
        const { input, path } = task;
        if (!isJsonSchemaRecord(input))
            authorError(`${path} must be a value schema object`);
        if (seen.has(input))
            authorError(`${path} is circular`);
        seen.add(input);
        const authorKeys = [...ANNOTATION_KEYS, ...(task.allowRequired ? ['required'] : [])];
        const node = {};
        assignCompiledNode(task.destination, node);
        tasks.push({ kind: 'leave', input });
        if (Object.hasOwn(input, 'oneOf')) {
            assertAuthorKeys(input, path, [...authorKeys, 'oneOf', 'type']);
            if (Object.hasOwn(input, 'type'))
                authorError(`${path} cannot declare both type and oneOf`);
            if (!isPlainJsonArray(input.oneOf))
                authorError(`${path}.oneOf must be an array of at least two value schemas`);
            const branches = [];
            node.oneOf = branches;
            copyAnnotations(input, node);
            for (let index = input.oneOf.length - 1; index >= 0; index--) {
                tasks.push({
                    kind: 'value',
                    input: input.oneOf[index],
                    path: `${path}.oneOf[${index}]`,
                    allowRequired: false,
                    destination: { kind: 'one-of', target: branches, index },
                });
            }
            continue;
        }
        const inputType = Object.hasOwn(input, 'type') ? input.type : undefined;
        switch (inputType) {
            case 'json':
                assertAuthorKeys(input, path, [...authorKeys, 'type']);
                copyAnnotations(input, node);
                break;
            case 'object':
                assertAuthorKeys(input, path, [...authorKeys, 'type', 'properties', 'additionalProperties']);
                if (!Object.hasOwn(input, 'additionalProperties') || typeof input.additionalProperties !== 'boolean') {
                    authorError(`${path}.additionalProperties must be explicitly true or false`);
                }
                node.type = 'object';
                copyAnnotations(input, node);
                node.additionalProperties = input.additionalProperties;
                if (Object.hasOwn(input, 'properties')) {
                    tasks.push({
                        kind: 'property-map',
                        input: input.properties,
                        path: `${path}.properties`,
                        destination: { kind: 'object', target: node },
                    });
                }
                break;
            case 'array':
                assertAuthorKeys(input, path, [...authorKeys, 'type', 'items']);
                node.type = 'array';
                copyAnnotations(input, node);
                if (Object.hasOwn(input, 'items')) {
                    tasks.push({
                        kind: 'value',
                        input: input.items,
                        path: `${path}.items`,
                        allowRequired: false,
                        destination: { kind: 'item', target: node },
                    });
                }
                break;
            case 'string':
            case 'number':
            case 'integer':
            case 'boolean':
            case 'null':
                assertAuthorKeys(input, path, [...authorKeys, 'type', 'enum', 'const']);
                node.type = inputType;
                copyAnnotations(input, node);
                if (Object.hasOwn(input, 'enum')) {
                    if (!isPlainJsonArray(input.enum))
                        authorError(`${path}.enum must be a non-empty array of scalar values`);
                    node.enum = Array.from(input.enum, entry => entry);
                }
                if (Object.hasOwn(input, 'const'))
                    node.const = input.const;
                break;
            default:
                authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
        }
    }
}
/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
    const holder = {};
    runSchemaCompiler({ kind: 'property-map', input, path, destination: { kind: 'root', holder } });
    /* v8 ignore next -- the root task assigns before scheduling any descendants. */
    return holder.value ?? authorError(`${path} did not compile`);
}
/** Compile one author node without applying any consumer root restriction. */
function compileValueSchema(input, path) {
    const holder = {};
    runSchemaCompiler({ kind: 'value', input, path, allowRequired: false, destination: { kind: 'root', holder } });
    /* v8 ignore next -- the root task assigns before scheduling any descendants. */
    return holder.value ?? authorError(`${path} did not compile`);
}
/**
 * Compile one author-facing value schema to the enforced raw JSON Schema
 * subset. The author-only `json` node becomes an annotation-only schema.
 * @param spec - schema for any JSON-value root.
 * @returns The asserted raw schema projection.
 */
export function valueSchemaSpecToJsonSchema(spec) {
    const schema = compileValueSchema(spec, 'schema');
    assertSupportedJsonSchema(schema);
    return schema;
}
/**
 * Compile the implicit open parameter object into raw JSON Schema.
 * @param spec - per-property parameter definitions.
 * @returns An object-rooted raw schema with no implicit-root openness override.
 */
export function parameterSchemaSpecToJsonSchema(spec) {
    const compiled = compilePropertyMap(spec, 'parameters');
    const schema = {
        type: 'object',
        properties: compiled.properties,
        ...(compiled.required === undefined ? {} : { required: compiled.required }),
    };
    assertSupportedJsonSchema(schema);
    return schema;
}
/** Invalid model-generated arguments for a typed tool. */
export class ToolArgsError extends HarnessError {
    /** Individual violations in schema-walk order. */
    violations;
    constructor(violations) {
        super(`invalid arguments: ${violations.join('; ')}`, 'INVALID_ARGS');
        this.name = 'ToolArgsError';
        this.violations = violations;
    }
}
/**
 * Validate model-generated arguments against an implicit parameter schema.
 * @param spec - declared parameter schema.
 * @param args - candidate arguments, however malformed.
 * @returns Path-qualified violations; empty means valid.
 */
export function validateArgs(spec, args) {
    return validateJsonSchemaValue(parameterSchemaSpecToJsonSchema(spec), args, '');
}
/**
 * Define a first-party tool with inferred arguments and strict execution
 * validation. Replay-only presenters validate softly and fall back to generic
 * rendering for obsolete logged arguments.
 * @param options - typed definition and optional finalizer and presenters.
 * @returns A registry-ready definition.
 */
export function defineTool(options) {
    // Object-literal methods do not use `this`; retaining references is safe.
    // oxlint-disable-next-line typescript/unbound-method
    const userExecute = options.execute;
    // oxlint-disable-next-line typescript/unbound-method
    const userFinalizeContent = options.finalizeContent;
    // oxlint-disable-next-line typescript/unbound-method
    const userRender = options.output.render;
    // oxlint-disable-next-line typescript/unbound-method
    const userPresentationMeta = options.output.presentationMeta;
    // oxlint-disable-next-line typescript/unbound-method
    const userPresentCall = options.presentCall;
    // oxlint-disable-next-line typescript/unbound-method
    const userPresentResult = options.presentResult;
    // oxlint-disable-next-line typescript/unbound-method
    const userIsConcurrencySafe = options.isConcurrencySafe;
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
        throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
    }
    const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
    const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
    const validate = (args) => validateJsonSchemaValue(parameters, args, '');
    const tool = {
        name: options.name,
        description: options.description,
        parameters: parameters,
        output: {
            schema: outputSchema,
            render(args, value) {
                return userRender(args, value);
            },
            ...userPresentationMeta !== undefined ? {
                presentationMeta(args, value) {
                    return userPresentationMeta(args, value);
                },
            } : {},
        },
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        async execute(args, exec) {
            const violations = validate(args);
            if (violations.length > 0)
                throw new ToolArgsError(violations);
            return userExecute(args, exec);
        },
    };
    if (userFinalizeContent) {
        tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
    }
    // Presentation is display-only and may run on REPLAY of arbitrary logged args
    // (possibly from an older schema), so it must never throw: validate softly and
    // fall back to `undefined` (a generic UI presentation) on any mismatch, rather
    // than the hard `ToolArgsError` the execute path raises.
    if (userPresentCall) {
        tool.presentCall = (args) => {
            if (validate(args).length > 0)
                return undefined;
            return userPresentCall(args);
        };
    }
    if (userPresentResult) {
        tool.presentResult = (args, result) => {
            if (validate(args).length > 0)
                return undefined;
            return userPresentResult(args, result);
        };
    }
    if (userIsConcurrencySafe) {
        tool.isConcurrencySafe = (args) => {
            if (validate(args).length > 0)
                return false;
            return userIsConcurrencySafe(args);
        };
    }
    return tool;
}
//# sourceMappingURL=schema.js.map