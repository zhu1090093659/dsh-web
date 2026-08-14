/**
 * Result rows shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a search card and a terminal card cut a
 * long result at the same place.
 */
export declare const DEFAULT_SEARCH_MAX_LINES = 16;
/** One matched line inside a {@link SearchFileGroup}: its 1-based line number and text. */
export interface SearchBlockLineMatch {
    /** 1-based line number of the match within its file. */
    lineNumber: number;
    /** The matched line text, as the tool surfaced it. */
    line: string;
}
/** One file's grouped matches, in first-seen file order. */
export interface SearchFileGroup {
    /** The file the matches belong to (the display path). */
    path: string;
    /** The file's matched lines, in output order. */
    matches: SearchBlockLineMatch[];
}
/** Fields both search shapes carry (the render site positions; this component draws). */
interface SearchBlockCommon {
    /**
     * Whether the tool capped the inline result: the shape carries only the
     * retained results, not every result the search found. The banner summary
     * folds the pre-cap `total` in (`显示 X / 共 N …`) so the card never presents a
     * capped result as complete.
     */
    truncated: boolean;
    /** Total results the search found before capping (equals the retained count when not `truncated`). */
    total: number;
    /** Height cap in rows before the middle collapses (default {@link DEFAULT_SEARCH_MAX_LINES}). */
    maxLines?: number | undefined;
    /** Extra class merged onto the wrapper. */
    className?: string | undefined;
}
/** Props for the grouped-matches (`grep`) shape. */
export interface SearchMatchesBlockProps extends SearchBlockCommon {
    kind: 'matches';
    /** Matched lines grouped by file, in first-seen file order. */
    files: SearchFileGroup[];
}
/** Props for the flat-path (`glob`) shape. */
export interface SearchPathsBlockProps extends SearchBlockCommon {
    kind: 'paths';
    /** The discovered paths, in the tool's result order (the retained page when `truncated`). */
    paths: string[];
}
/** {@link SearchBlock} props: one card, two `kind`-discriminated shapes. */
export type SearchBlockProps = SearchMatchesBlockProps | SearchPathsBlockProps;
/**
 * Render a completed search as a grouped-matches or flat-path card.
 * @param props - see {@link SearchBlockProps}.
 * @returns the search block element.
 */
export declare function SearchBlock(props: SearchBlockProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=SearchBlock.d.ts.map