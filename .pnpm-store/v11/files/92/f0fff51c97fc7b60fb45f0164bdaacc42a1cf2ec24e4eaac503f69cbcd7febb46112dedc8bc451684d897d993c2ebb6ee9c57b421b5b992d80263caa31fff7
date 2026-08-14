/** Lossless-JSON validation and detached snapshots for durable session data. @module @deepseek-ai/dsh-session/json */
/**
 * A value that round-trips losslessly through JSON: `null`, a boolean, a finite
 * number other than negative zero, a string, an array of such values, or a
 * plain object whose values are such values. Arrays may carry only their dense
 * indexed elements; extra own properties would be discarded by JSON. TypeScript
 * cannot distinguish `-0` from `number`, so {@link isJsonValue} and
 * {@link snapshotJsonValue} enforce these details at runtime. Use this type for
 * a payload that must survive session-log persistence and replay byte-identically
 * — e.g. a tool's private presentation `meta`.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/**
 * Validate and detach lossless JSON in one read per property, so a stateful
 * getter cannot change between validation and copying. Traversal is iterative,
 * so valid nesting is bounded by available memory rather than the JavaScript
 * call stack. Accepts ordinary arrays, plain or null-prototype objects, and JSON
 * scalars; rejects sparse, cyclic, exotic, negative-zero, and non-finite values.
 * Getter throws propagate.
 *
 * @param value - the candidate value to validate and detach.
 * @returns the detached snapshot, or `undefined` when the value is not
 *   losslessly JSON-serializable.
 */
export declare function snapshotJsonValue<T>(value: T): T | undefined;
/**
 * Test the same lossless JSON boundary as {@link snapshotJsonValue} without
 * detaching it. Only own enumerable string properties participate; `toJSON`
 * is ignored and getters run, so persistence boundaries use the snapshotter.
 * @param value - the candidate event data to test.
 * @returns whether `value` survives JSON round-trip losslessly.
 */
export declare function isJsonValue(value: unknown): boolean;
//# sourceMappingURL=json.d.ts.map