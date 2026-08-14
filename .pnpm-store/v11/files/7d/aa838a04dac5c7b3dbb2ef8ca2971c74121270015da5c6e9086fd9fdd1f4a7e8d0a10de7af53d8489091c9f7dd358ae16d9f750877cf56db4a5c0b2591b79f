/**
 * Output lines shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a diff card and a terminal card cut a
 * long body at the same place.
 */
export declare const DEFAULT_DIFF_MAX_LINES = 16;
/**
 * One file's change, in the shape {@link DiffBlock} draws. Structurally the
 * render-intent contract's `FileDiff`, redeclared here so this primitive stays
 * free of the tool contract (the terminal card's decoupling, applied to diffs).
 */
export interface DiffHunk {
    /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
    path: string;
    /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
    oldText: string | null;
    /** Content after the change (the added side). */
    newText: string;
}
export interface DiffBlockProps {
    /** One entry per applied hunk, in file order; empty renders nothing. */
    diffs: DiffHunk[];
    /** Height cap in body lines before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
    maxLines?: number | undefined;
    /** Extra class merged onto the wrapper (callers position; this component draws). */
    className?: string | undefined;
}
/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export declare function DiffBlock({ diffs, maxLines, className }: DiffBlockProps): import("react").JSX.Element | null;
//# sourceMappingURL=DiffBlock.d.ts.map