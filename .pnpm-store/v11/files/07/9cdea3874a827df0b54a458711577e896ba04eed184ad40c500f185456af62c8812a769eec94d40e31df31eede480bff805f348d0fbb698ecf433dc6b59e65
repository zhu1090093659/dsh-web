/** Title text normalization and UTF-8-safe truncation. */
/**
 * Truncate a string to a UTF-8 byte budget without splitting a Unicode code point.
 * @param input - normalized title text.
 * @param maxBytes - positive UTF-8 byte budget.
 * @returns the longest leading code-point prefix within the budget.
 */
export declare function truncateTitleUtf8(input: string, maxBytes: number): string;
/**
 * Normalize one accepted session title and enforce its UTF-8 byte budget.
 * @param input - untrusted title text.
 * @param maxBytes - positive maximum encoded size.
 * @returns a terminal-safe one-line title, possibly empty after sanitization.
 */
export declare function normalizeSessionTitle(input: string, maxBytes: number): string;
/**
 * Derive the deterministic first-prompt fallback.
 * @param input - text from the first eligible human message.
 * @param maxWords - positive whitespace-delimited word cap.
 * @param maxBytes - positive UTF-8 byte cap.
 * @returns the normalized leading words within both limits.
 */
export declare function fallbackSessionTitle(input: string, maxWords: number, maxBytes: number): string;
//# sourceMappingURL=normalize.d.ts.map