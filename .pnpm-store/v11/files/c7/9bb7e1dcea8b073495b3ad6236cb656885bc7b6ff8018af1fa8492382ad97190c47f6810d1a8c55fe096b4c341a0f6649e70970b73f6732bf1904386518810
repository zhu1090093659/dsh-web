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
import { assertNever, HarnessError } from '@deepseek-ai/dsh-llm';
import { isJsonValue } from '@deepseek-ai/dsh-session';
/**
 * Thrown when a raw schema falls outside the enforced subset. `violations`
 * lists every offending path instead of stopping at the first author error.
 */
export class JsonSchemaError extends HarnessError {
    /** Individual schema violations in walk order. */
    violations;
    constructor(violations) {
        super(`unsupported JSON schema: ${violations.join('; ')}`, 'UNSUPPORTED_SCHEMA');
        this.name = 'JsonSchemaError';
        this.violations = violations;
    }
}
const CONSTRAINT_KEYWORDS = new Set([
    'type',
    'oneOf',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'enum',
    'const',
]);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
/* jscpd:ignore-start -- this realm boundary mirrors the session-owned lossless-JSON intrinsic test */
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const constructor = descriptor?.value;
    if (typeof constructor !== 'function')
        return false;
    try {
        return constructor.name === name
            && constructor.prototype === prototype
            && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
    }
    catch {
        return false;
    }
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype(value) {
    return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, 'Object');
}
/**
 * Test for a realm-agnostic plain JSON record without accepting arrays or
 * exotic objects.
 * @param value - candidate record from any JavaScript realm.
 * @returns Whether the value has a plain-object prototype chain.
 */
export function isPlainJsonRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    try {
        const prototype = Object.getPrototypeOf(value);
        return prototype === null
            || typeof prototype === 'object' && isIntrinsicObjectPrototype(prototype);
    }
    catch {
        return false;
    }
}
/** Whether an array uses one realm's intrinsic `Array.prototype`. */
function hasPlainArrayPrototype(value) {
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, 'Array'))
        return false;
    const objectPrototype = Object.getPrototypeOf(prototype);
    return typeof objectPrototype === 'object'
        && objectPrototype !== null
        && isIntrinsicObjectPrototype(objectPrototype);
}
/* jscpd:ignore-end */
/** Return whether a record contains only own enumerable string keys. */
function hasOnlyEnumerableStringKeys(value) {
    try {
        return Reflect.ownKeys(value)
            .every(key => typeof key === 'string' && Object.prototype.propertyIsEnumerable.call(value, key));
    }
    catch {
        return false;
    }
}
/**
 * Test for an ordinary schema record whose keys survive JSON projection.
 * @param value - candidate record from any JavaScript realm.
 * @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
 */
export function isJsonSchemaRecord(value) {
    return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
/**
 * Test for a dense ordinary array with no JSON-invisible decorations.
 * @param value - candidate array from any JavaScript realm.
 * @returns Whether the array is intrinsic, dense, and undecorated.
 */
export function isPlainJsonArray(value) {
    if (!Array.isArray(value))
        return false;
    try {
        if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1)
            return false;
        for (let index = 0; index < value.length; index++) {
            if (!Object.hasOwn(value, index))
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
/** Lossless finite JSON number, excluding negative zero. */
function isJsonNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
}
/** Whether a scalar is valid for one declared schema type. */
function scalarMatches(type, value) {
    switch (type) {
        case 'string': return typeof value === 'string';
        case 'number': return isJsonNumber(value);
        case 'integer': return isJsonNumber(value) && Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'null': return value === null;
        /* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
        default: return assertNever(type, 'JsonSchemaType');
    }
}
/** Keywords that are invalid beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];
/** Validate object-only fields after its property schemas have been visited. */
function checkObjectSchemaTail(node, path, properties, violations) {
    const hasRequired = Object.hasOwn(node, 'required');
    const required = hasRequired ? node.required : undefined;
    if (hasRequired) {
        if (!isPlainJsonArray(required) || required.some(entry => typeof entry !== 'string')) {
            violations.push(`${path}.required must be an array of strings`);
        }
        else {
            const declared = isJsonSchemaRecord(properties) ? properties : {};
            for (const key of required) {
                if (!Object.hasOwn(declared, key))
                    violations.push(`${path}.required names "${key}" which is not in properties`);
            }
        }
    }
    if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
        violations.push(`${path}.additionalProperties must be a boolean`);
    }
}
/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
function checkSchemaNode(root, rootPath, violations, seen) {
    const tasks = [{ kind: 'enter', node: root, path: rootPath }];
    for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
        if (task.kind === 'leave') {
            seen.delete(task.node);
            continue;
        }
        if (task.kind === 'one-of-tail') {
            for (const key of ONE_OF_SIBLING_KEYWORDS) {
                if (Object.hasOwn(task.node, key))
                    violations.push(`${task.path}.${key} is not supported beside oneOf`);
            }
            continue;
        }
        if (task.kind === 'object-tail') {
            checkObjectSchemaTail(task.node, task.path, task.properties, violations);
            continue;
        }
        const { node, path } = task;
        if (!isJsonSchemaRecord(node)) {
            violations.push(`${path} must be a schema object`);
            continue;
        }
        if (seen.has(node)) {
            violations.push(`${path} is circular`);
            continue;
        }
        seen.add(node);
        tasks.push({ kind: 'leave', node });
        for (const key of Object.keys(node)) {
            if (CONSTRAINT_KEYWORDS.has(key))
                continue;
            if (ANNOTATION_KEYWORDS.has(key)) {
                try {
                    if (!isJsonValue(node[key]))
                        violations.push(`${path}.${key} annotation must be lossless JSON data`);
                }
                catch {
                    violations.push(`${path}.${key} annotation must be lossless JSON data`);
                }
                continue;
            }
            violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
        }
        if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
            violations.push(`${path}.description must be a string`);
        }
        if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
            violations.push(`${path}.title must be a string`);
        }
        const hasType = Object.hasOwn(node, 'type');
        const hasOneOf = Object.hasOwn(node, 'oneOf');
        if (hasType && hasOneOf) {
            violations.push(`${path} cannot declare both type and oneOf`);
            continue;
        }
        if (!hasType && !hasOneOf) {
            for (const key of ONE_OF_SIBLING_KEYWORDS) {
                if (Object.hasOwn(node, key))
                    violations.push(`${path}.${key} requires type or oneOf`);
            }
            continue;
        }
        if (hasOneOf) {
            const oneOf = node.oneOf;
            tasks.push({ kind: 'one-of-tail', node, path });
            if (!isPlainJsonArray(oneOf) || oneOf.length < 2) {
                violations.push(`${path}.oneOf must be an array of at least two schemas`);
            }
            else {
                for (let index = oneOf.length - 1; index >= 0; index--) {
                    tasks.push({ kind: 'enter', node: oneOf[index], path: `${path}.oneOf[${index}]` });
                }
            }
            continue;
        }
        const type = node.type;
        if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
            violations.push(Array.isArray(type)
                ? `${path}.type must be a single type string (type arrays are not supported)`
                : `${path}.type must be one of ${SCHEMA_TYPES.join('/')}`);
            continue;
        }
        const schemaType = type;
        const allowedFor = {
            properties: ['object'],
            required: ['object'],
            additionalProperties: ['object'],
            items: ['array'],
            enum: ['string', 'number', 'integer', 'boolean', 'null'],
            const: ['string', 'number', 'integer', 'boolean', 'null'],
        };
        for (const [key, types] of Object.entries(allowedFor)) {
            if (Object.hasOwn(node, key) && !types.includes(schemaType)) {
                violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
            }
        }
        switch (schemaType) {
            case 'object': {
                const properties = Object.hasOwn(node, 'properties') ? node.properties : undefined;
                tasks.push({ kind: 'object-tail', node, path, properties });
                if (Object.hasOwn(node, 'properties')) {
                    if (!isJsonSchemaRecord(properties)) {
                        violations.push(`${path}.properties must be an object of schemas`);
                    }
                    else {
                        const entries = Object.entries(properties);
                        for (let index = entries.length - 1; index >= 0; index--) {
                            const entry = entries[index];
                            /* v8 ignore next -- the loop is bounded by the captured entry count. */
                            if (entry === undefined)
                                continue;
                            tasks.push({ kind: 'enter', node: entry[1], path: `${path}.properties.${entry[0]}` });
                        }
                    }
                }
                break;
            }
            case 'array': {
                if (Object.hasOwn(node, 'items'))
                    tasks.push({ kind: 'enter', node: node.items, path: `${path}.items` });
                break;
            }
            case 'string':
            case 'number':
            case 'integer':
            case 'boolean':
            case 'null': {
                const hasEnum = Object.hasOwn(node, 'enum');
                const allowed = hasEnum ? node.enum : undefined;
                const enumValid = isPlainJsonArray(allowed)
                    && allowed.length > 0
                    && allowed.every(entry => scalarMatches(schemaType, entry));
                if (hasEnum && !enumValid) {
                    violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
                }
                const hasConst = Object.hasOwn(node, 'const');
                const declaredConst = hasConst ? node.const : undefined;
                const constValid = scalarMatches(schemaType, declaredConst);
                if (hasConst) {
                    if (!constValid) {
                        violations.push(`${path}.const must be a ${schemaType} value`);
                    }
                    else if (enumValid && !allowed.includes(declaredConst)) {
                        violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
                    }
                }
                break;
            }
            /* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
            default: assertNever(schemaType, 'JsonSchemaType');
        }
    }
}
/**
 * Assert that an arbitrary raw schema uses only the enforced subset.
 * Annotation-only schemas are accepted as the standard unconstrained-JSON
 * form; callers that require an object root use {@link assertObjectJsonSchema}.
 * @param schema - untrusted raw JSON Schema.
 * @returns Assertion that the schema belongs to the supported subset.
 */
export function assertSupportedJsonSchema(schema) {
    const violations = [];
    checkSchemaNode(schema, 'schema', violations, new Set());
    if (violations.length > 0)
        throw new JsonSchemaError(violations);
}
/**
 * Assert the enforced subset plus the object-root constraint retained by
 * subagent and workflow structured outputs.
 * @param schema - untrusted caller-supplied schema.
 * @returns Assertion that the schema belongs to the supported subset and has an object root.
 */
export function assertObjectJsonSchema(schema) {
    const violations = [];
    checkSchemaNode(schema, 'schema', violations, new Set());
    if (violations.length === 0
        && (!isJsonSchemaRecord(schema) || !Object.hasOwn(schema, 'type') || schema.type !== 'object')) {
        violations.push('schema.type must be "object" (structured output is object-rooted)');
    }
    if (violations.length > 0)
        throw new JsonSchemaError(violations);
}
/** Safely test the lossless JSON boundary when a getter may throw. */
function safelyIsJsonValue(value) {
    try {
        return isJsonValue(value);
    }
    catch {
        return false;
    }
}
/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
    return path === '' ? 'arguments' : path;
}
/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
    return path === '' ? key : `${path}.${key}`;
}
/** The generic exception-containment diagnostic owned by one valid schema node. */
function losslessValueViolation(path) {
    return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
/** Append diagnostics without spreading a potentially wide child result as call arguments. */
function appendViolations(target, source) {
    for (const violation of source)
        target.push(violation);
}
/** Initialize one validation frame with empty aggregation state. */
function valueFrame(node, value, path) {
    return {
        node,
        value,
        path,
        catches: false,
        phase: 'start',
        children: [],
        childIndex: 0,
        violations: [],
        tailViolations: [],
        matches: 0,
    };
}
/** Validate one scalar node after its primitive type check. */
function checkScalarValue(node, value, path) {
    const allowed = Object.hasOwn(node, 'enum') ? node.enum : undefined;
    if (allowed !== undefined && !allowed.includes(value)) {
        return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
    }
    if (Object.hasOwn(node, 'const') && value !== node.const) {
        return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
    }
    return [];
}
/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
function checkValue(schema, value, path) {
    const frames = [valueFrame(schema, value, path)];
    let rootResult;
    const receive = (result) => {
        const parent = frames.at(-1);
        if (parent === undefined) {
            rootResult = result;
            return;
        }
        if (parent.kind === 'oneOf') {
            if (result.length === 0)
                parent.matches++;
        }
        else {
            appendViolations(parent.violations, result);
        }
    };
    const finish = (result) => {
        frames.pop();
        receive(result);
    };
    while (frames.length > 0) {
        const frame = frames.at(-1);
        /* v8 ignore next -- the loop condition guarantees a current frame. */
        if (frame === undefined)
            break;
        try {
            if (frame.phase === 'children') {
                if (frame.childIndex < frame.children.length) {
                    const child = frame.children[frame.childIndex];
                    /* v8 ignore next -- childIndex is bounded by children.length. */
                    if (child === undefined)
                        throw new Error('missing schema-value child frame');
                    frame.childIndex++;
                    frames.push(valueFrame(child.node, child.value, child.path));
                    continue;
                }
                if (frame.kind === 'oneOf') {
                    finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
                    continue;
                }
                appendViolations(frame.violations, frame.tailViolations);
                if (frame.violations.length > 0) {
                    finish(frame.violations);
                }
                else if (frame.kind === 'object') {
                    finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
                }
                else {
                    finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
                }
                continue;
            }
            const nodeType = Object.hasOwn(frame.node, 'type') ? frame.node.type : undefined;
            frame.catches = !(nodeType !== undefined && !SCHEMA_TYPES.includes(nodeType));
            const oneOf = Object.hasOwn(frame.node, 'oneOf') ? frame.node.oneOf : undefined;
            if (oneOf !== undefined) {
                frame.kind = 'oneOf';
                frame.children = Array.from(oneOf, branch => ({ node: branch, value: frame.value, path: frame.path }));
                frame.childIndex = 0;
                frame.matches = 0;
                frame.phase = 'children';
                continue;
            }
            if (nodeType === undefined) {
                finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
                continue;
            }
            switch (nodeType) {
                case 'object': {
                    if (!isPlainJsonRecord(frame.value)) {
                        finish([`"${diagnosticPath(frame.path)}" must be an object`]);
                        break;
                    }
                    const properties = Object.hasOwn(frame.node, 'properties') ? frame.node.properties ?? {} : {};
                    const violations = [];
                    const required = Object.hasOwn(frame.node, 'required') ? frame.node.required ?? [] : [];
                    for (const key of required) {
                        if (!Object.hasOwn(frame.value, key) || frame.value[key] === undefined) {
                            violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
                        }
                    }
                    const children = [];
                    for (const [key, child] of Object.entries(properties)) {
                        if (!Object.hasOwn(frame.value, key) || frame.value[key] === undefined)
                            continue;
                        children.push({ node: child, value: frame.value[key], path: propertyPath(frame.path, key) });
                    }
                    const tailViolations = [];
                    if (Object.hasOwn(frame.node, 'additionalProperties') && frame.node.additionalProperties === false) {
                        for (const key of Object.keys(frame.value)) {
                            if (!Object.hasOwn(properties, key)) {
                                tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
                            }
                        }
                    }
                    frame.kind = 'object';
                    frame.children = children;
                    frame.childIndex = 0;
                    frame.violations = violations;
                    frame.tailViolations = tailViolations;
                    frame.phase = 'children';
                    break;
                }
                case 'array': {
                    if (!Array.isArray(frame.value)) {
                        finish([`"${diagnosticPath(frame.path)}" must be an array`]);
                        break;
                    }
                    const items = Object.hasOwn(frame.node, 'items') ? frame.node.items : undefined;
                    const children = items === undefined
                        ? []
                        : frame.value.flatMap((entry, index) => [{ node: items, value: entry, path: `${frame.path}[${index}]` }]);
                    frame.kind = 'array';
                    frame.children = children;
                    frame.childIndex = 0;
                    frame.violations = [];
                    frame.phase = 'children';
                    break;
                }
                case 'string':
                    finish(typeof frame.value === 'string'
                        ? checkScalarValue(frame.node, frame.value, frame.path)
                        : [`"${diagnosticPath(frame.path)}" must be a string`]);
                    break;
                case 'number':
                    finish(typeof frame.value !== 'number'
                        ? [`"${diagnosticPath(frame.path)}" must be a number`]
                        : !isJsonNumber(frame.value)
                            ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`]
                            : checkScalarValue(frame.node, frame.value, frame.path));
                    break;
                case 'integer':
                    finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value)
                        ? [`"${diagnosticPath(frame.path)}" must be an integer`]
                        : checkScalarValue(frame.node, frame.value, frame.path));
                    break;
                case 'boolean':
                    finish(typeof frame.value === 'boolean'
                        ? checkScalarValue(frame.node, frame.value, frame.path)
                        : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
                    break;
                case 'null':
                    finish(frame.value === null
                        ? checkScalarValue(frame.node, frame.value, frame.path)
                        : [`"${diagnosticPath(frame.path)}" must be null`]);
                    break;
                default:
                    finish(assertNever(nodeType, 'JsonSchemaType'));
            }
        }
        catch (error) {
            let failed = frames.pop();
            while (failed !== undefined && !failed.catches)
                failed = frames.pop();
            if (failed === undefined)
                throw error;
            receive(losslessValueViolation(failed.path));
        }
    }
    /* v8 ignore next -- every root frame finishes or throws. */
    return rootResult ?? losslessValueViolation(path);
}
/**
 * Validate a candidate value against an asserted raw schema. The function is
 * total for arbitrary values and returns path-qualified violations.
 * @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
 * @param value - the candidate JSON value.
 * @param path - root label used in diagnostics.
 * @returns All violations in walk order; empty means valid.
 */
export function validateJsonSchemaValue(schema, value, path = 'value') {
    return checkValue(schema, value, path);
}
//# sourceMappingURL=json-schema.js.map