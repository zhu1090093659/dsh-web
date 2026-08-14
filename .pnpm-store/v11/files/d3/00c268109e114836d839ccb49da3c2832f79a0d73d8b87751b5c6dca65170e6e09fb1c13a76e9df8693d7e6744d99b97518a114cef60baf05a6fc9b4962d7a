/**
 * Markdown-to-plain-text projection for compact summaries and labels.
 * Parsing shares the renderer's streaming GFM grammar ({@link parseGfm}), so
 * the projection strips exactly the markup the renderer would draw; raw HTML
 * stays literal, links keep their labels, images keep alt text, and code
 * keeps its source text.
 */
/** Amount of parsed Markdown content returned by the extractor. */
export type MarkdownPlainTextMode = 'all' | 'first-line' | 'first-paragraph';
/** Options for {@link extractMarkdownPlainText}. */
export interface MarkdownPlainTextOptions {
    /** Projection boundary; defaults to the complete document. */
    mode?: MarkdownPlainTextMode;
}
/**
 * Parse GFM Markdown, remove its presentation markup, and preserve raw HTML literally.
 * @param markdown - Markdown source.
 * @param options - Optional extraction boundary.
 * @returns Plain text for the whole document, first visible line, or first semantic paragraph.
 */
export declare function extractMarkdownPlainText(markdown: string, options?: MarkdownPlainTextOptions): string;
//# sourceMappingURL=plain-text.d.ts.map