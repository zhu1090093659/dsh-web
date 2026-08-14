type GlobalConstructorNames = keyof {
    [K in keyof typeof globalThis as typeof globalThis[K] extends abstract new (...args: any) => any ? K : never]: K;
};
/** Create a predicate for a global constructor name. */
export declare function is<K extends GlobalConstructorNames>(type: K): (value: any) => value is InstanceType<typeof globalThis[K]>;
/** Test whether a value matches a global constructor name. */
export declare function is<K extends GlobalConstructorNames>(type: K, value: any): value is InstanceType<typeof globalThis[K]>;
declare function isArrayBufferLike(value: any): value is ArrayBufferLike;
declare function isArrayBufferSource(value: any): value is Binary.Source;
/** Binary source detection and base64/hex conversion helpers. */
export declare namespace Binary {
    type Source<T extends ArrayBufferLike = ArrayBufferLike> = T | ArrayBufferView<T>;
    const is: typeof isArrayBufferLike;
    const isSource: typeof isArrayBufferSource;
    function fromSource<T extends ArrayBufferLike>(source: Source<T>): T;
    function toBase64(source: Source): string;
    function fromBase64(source: string): ArrayBuffer | Uint8Array<ArrayBuffer>;
    function toHex(source: Source): string;
    function fromHex(source: string): ArrayBuffer;
}
/** Decode a base64 string into binary data. */
export declare const base64ToArrayBuffer: typeof Binary.fromBase64;
/** Encode binary data as base64. */
export declare const arrayBufferToBase64: typeof Binary.toBase64;
/** Decode a hex string into binary data. */
export declare const hexToArrayBuffer: typeof Binary.fromHex;
/** Encode binary data as hex. */
export declare const arrayBufferToHex: typeof Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes. */
export declare function clone<T>(source: T): T;
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
export declare function deepEqual(a: any, b: any, strict?: boolean): boolean;
export {};
//# sourceMappingURL=types.d.ts.map