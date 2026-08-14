import type { CSSProperties } from 'react';
/** One run of terminal text; `style` is undefined for text that carries no SGR state. */
export interface AnsiSpan {
    /** The run's plain text, free of escape sequences and newlines. */
    text: string;
    /** Resolved inline style, or undefined when the run needs no wrapper. */
    style: CSSProperties | undefined;
}
/** The spans of one output line, in order. */
export type AnsiLine = readonly AnsiSpan[];
/**
 * Parse command output into styled spans grouped by line.
 * @param text - raw output text, which may contain ANSI escape sequences.
 * @returns one entry per output line (always at least one, possibly empty).
 */
export declare function parseAnsiLines(text: string): AnsiLine[];
//# sourceMappingURL=ansi.d.ts.map