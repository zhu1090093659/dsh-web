/** String/symbol keyed dictionary type. */
export type Dict<T = any, K extends string | symbol = string> = {
    [key in K]: T;
};
/** Safely read `T[K]`, returning `never` when `K` is not a key of `T`. */
export type Get<T extends {}, K> = K extends keyof T ? T[K] : never;
/** Conditional extraction helper with a configurable return type. */
export type Extract<S, T, U = S> = S extends T ? U : never;
/** Accept a value or an array, unless the value is already an array type. */
export type MaybeArray<T> = [T] extends [unknown[]] ? T : T | T[];
/** Wrap a value in `Promise`, preserving the resolved type of existing promises. */
export type Promisify<T> = Promise<T extends Promise<infer S> ? S : T>;
/** Accept a value or promise unless the value type is already promise-like. */
export type Awaitable<T> = [T] extends [Promise<unknown>] ? T : T | Promise<T>;
/** Convert a union type to an intersection type. */
export type Intersect<U> = (U extends any ? (arg: U) => void : never) extends ((arg: infer I) => void) ? I : never;
/** No-op callback returning `undefined` at runtime and `any` at type level. */
export declare function noop(): any;
/** Return true when a value is `null` or `undefined`. */
export declare function isNullable(value: any): value is null | undefined | void;
/** Return true when a value is neither `null` nor `undefined`. */
export declare function isNonNullable<T>(value: T): value is NonNullable<T>;
/** Return true for non-array object values. */
export declare function isPlainObject(data: any): any;
/** Filter object entries with a key type guard. */
export declare function filterKeys<T, K extends string, U extends K>(object: Dict<T, K>, filter: (key: K, value: T) => key is U): Dict<T, U>;
/** Filter object entries with a boolean predicate. */
export declare function filterKeys<T, K extends string>(object: Dict<T, K>, filter: (key: K, value: T) => boolean): Dict<T, K>;
/** Map object values while preserving the original key set. */
export declare function mapValues<U, T, K extends string>(object: Dict<T, K>, transform: (value: T, key: K) => U): Dict<U, K>;
/** Alias for `mapValues`. */
export { mapValues as valueMap };
/** Pick selected keys from an object, optionally including `undefined` values. */
export declare function pick<T extends object, K extends keyof T>(source: T, keys?: Iterable<K>, forced?: boolean): Pick<T, K>;
/** Omit selected keys from a shallow object copy. */
export declare function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>): Omit<T, K>;
/** Define a non-enumerable writable property with a typed key. */
export declare function defineProperty<T, K extends keyof T>(object: T, key: K, value: T[K]): T;
/** Define a non-enumerable writable property with an arbitrary key. */
export declare function defineProperty<T, K extends keyof any>(object: T, key: K, value: any): T;
//# sourceMappingURL=misc.d.ts.map