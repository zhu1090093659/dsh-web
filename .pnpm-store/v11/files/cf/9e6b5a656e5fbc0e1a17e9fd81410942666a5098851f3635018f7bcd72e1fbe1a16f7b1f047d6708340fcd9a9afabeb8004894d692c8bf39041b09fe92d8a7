/**
 * One citeable source drawn in a search card: the projection of the contract's
 * `WebSource`, with the optional fields kept optional so a provider that
 * returned only a URL still renders (its hostname becomes the label).
 */
export interface WebSourceView {
    /** The source URL; becomes a safe external link when it is http(s). */
    url: string;
    /** The source title; when absent the URL's hostname labels the link. */
    title?: string | undefined;
    /** A short excerpt or summary shown under the link. */
    snippet?: string | undefined;
    /** Publication/crawl timestamp, a provider-supplied string shown under the link. */
    publishedAt?: string | undefined;
}
/** A `web_search` card: an optional answer over a capped citation list. */
export interface WebSearchBlockProps {
    kind: 'search';
    /** The provider-generated answer, rendered as markdown above the sources. */
    answer?: string | undefined;
    /** The cited sources, in provider order. */
    sources: WebSourceView[];
    /** True when the tool cut the source list to its result cap. */
    truncated: boolean;
    /** Extra class merged onto the wrapper (callers position; this component draws). */
    className?: string | undefined;
}
/** A `web_fetch` card: the retrieval summary for one fetched URL. */
export interface WebFetchBlockProps {
    kind: 'fetch';
    /** The final URL after allowed redirects; becomes a safe external link when http(s). */
    url: string;
    /** HTTP status code of the fetched response. */
    statusCode: number;
    /** True when the provider or the output cap cut the fetched content. */
    truncated: boolean;
    /** Extra class merged onto the wrapper (callers position; this component draws). */
    className?: string | undefined;
}
/** A completed web retrieval card, discriminated by `kind`. */
export type WebBlockProps = WebSearchBlockProps | WebFetchBlockProps;
/**
 * Render a completed web retrieval as a structured card.
 * @param props - see {@link WebBlockProps}; `kind` selects the search or fetch body.
 * @returns the web card element.
 */
export declare function WebBlock(props: WebBlockProps): import("react").JSX.Element;
//# sourceMappingURL=WebBlock.d.ts.map