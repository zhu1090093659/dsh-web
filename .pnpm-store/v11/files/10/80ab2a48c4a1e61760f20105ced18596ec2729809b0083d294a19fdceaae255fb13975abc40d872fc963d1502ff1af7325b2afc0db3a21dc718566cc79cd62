/**
 * Content lines shown before the height cap collapses the middle. Matches
 * TerminalBlock's default so a long read and a long command output cut at the
 * same place in the same flow.
 */
export declare const DEFAULT_READ_MAX_LINES = 16;
/** One line of the read window: its file line number and its text (no trailing newline). */
export interface ReadBlockLine {
    /** 1-based line number in the file (a window past an offset keeps the file's own numbering). */
    number: number;
    /** The line's text, already truncated to the read tool's per-line cap. */
    text: string;
}
export interface ReadBlockProps {
    /** Banner label (the file path, or a tool-supplied replacement title); omitted draws no label. */
    label?: string | undefined;
    /** The returned window's lines, in file order, each keeping its file line number. */
    lines: readonly ReadBlockLine[];
    /** Exact total line count in the file, for the "showing N of M" note when the read is a window. */
    totalLines: number;
    /** Grammar hint (a file-extension-derived language id); unknown or absent = plain monospace. */
    lang?: string | undefined;
    /** Height cap in content lines before the middle collapses (default {@link DEFAULT_READ_MAX_LINES}). */
    maxLines?: number | undefined;
    /** Extra class merged onto the wrapper (callers position; this component draws). */
    className?: string | undefined;
}
/**
 * Render a read tool result as a line-numbered, optionally syntax-highlighted
 * file view.
 * @param props - see {@link ReadBlockProps}.
 * @returns the read block element.
 */
export declare function ReadBlock({ label, lines, totalLines, lang, maxLines, className, }: ReadBlockProps): import("react").JSX.Element;
//# sourceMappingURL=ReadBlock.d.ts.map