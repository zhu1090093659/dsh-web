/**
 * Direct mdast→React markdown renderer. Replaces the react-markdown /
 * remark-rehype pipeline with one switch over parsed nodes so streaming can
 * cache frozen blocks as React elements; the rendered DOM is pinned
 * byte-for-byte by `tests/fixtures/markdown-dom` and must not drift.
 *
 * Untrusted-output policy (unchanged from the replaced pipeline): link and
 * image destinations pass a protocol allowlist, images additionally require
 * absolute HTTP(S), raw HTML renders as literal text (no HTML enters the
 * DOM), and KaTeX runs without trusted commands. Fragment-anchor URLs fail
 * the allowlist, so footnote references and back-references render as plain
 * text rather than in-page links.
 *
 * Merge-extensible node unions fall through the documented default (render
 * nothing) rather than ending in assertNever: grammars registered elsewhere
 * may add node types this renderer has no mapping for.
 */
import type { ReactNode } from 'react';
import type * as Md from 'mdast';
import type { PositionedBlock } from './incremental.ts';
/** Copy-button labels forwarded to fence CodeBlocks (this package is cordis-free, so copy arrives via props). */
export interface MarkdownCodeLabels {
    /** Copy-button idle label. */
    copyLabel?: string | undefined;
    /** Copy-button label during the post-copy confirmation window. */
    copiedLabel?: string | undefined;
}
/** Link/image reference targets collected from a document (first definition per identifier wins, as in CommonMark). */
export interface ReferenceTargets {
    /** Link/image definitions keyed by upper-cased identifier. */
    definitions: Map<string, Md.Definition>;
    /** Footnote definitions keyed by upper-cased identifier. */
    footnotes: Map<string, Md.FootnoteDefinition>;
}
/**
 * Create an empty {@link ReferenceTargets}.
 * @returns Fresh empty maps.
 */
export declare function createReferenceTargets(): ReferenceTargets;
/**
 * Record every definition and footnote definition under `nodes` into
 * `targets`, depth-first, keeping the first definition per identifier.
 * @param nodes - Subtrees to walk (top-level blocks or any nested children).
 * @param targets - Accumulator, typically shared across incremental segments.
 */
export declare function collectReferenceTargets(nodes: readonly Md.RootContent[], targets: ReferenceTargets): void;
/**
 * File-mention affordance for inline code: the owner resolves an authored
 * token to the file it names, using its own vocabulary of real files — the
 * renderer never guesses at what looks like a path.
 */
export interface MarkdownFileMentions {
    /**
     * Resolve one inline-code token.
     * @param value - The authored token, exactly as written.
     * @returns The opener with its accessible label and full-path title, or
     * undefined when the token names no known file — it then stays inert code.
     */
    resolve(value: string): {
        open: () => void;
        label: string;
        title: string;
    } | undefined;
}
/**
 * One render pass's state: immutable options and targets plus the footnote
 * numbering accumulated in document order while references render.
 */
export interface MarkdownRenderContext {
    /** Streaming arm: fences render plain and TeX stays literal. */
    readonly streaming: boolean;
    /** Localized fence copy-button labels. */
    readonly codeLabels: MarkdownCodeLabels | undefined;
    /** Inline-code file mentions; absent wherever no opener vocabulary exists. */
    readonly fileMentions: MarkdownFileMentions | undefined;
    /** Inside an anchor's children: interactive mentions must not nest there. */
    readonly inLink?: boolean;
    /** Reference targets visible to this pass. */
    readonly targets: ReferenceTargets;
    /** Footnote identifiers in first-reference order; a footnote's number is its 1-based index here. */
    readonly footnoteOrder: string[];
    /** References rendered per identifier; drives the section's back-reference count. */
    readonly footnoteCounts: Map<string, number>;
}
/**
 * Render top-level blocks. Nodes that render nothing (definitions, unmapped
 * types) are dropped rather than kept as null placeholders, matching the
 * replaced pipeline's child lists so separator newlines land identically.
 * @param blocks - Blocks with their stream-stable render keys.
 * @param context - The pass state; footnote numbering mutates in document order.
 * @returns One React node per rendered block.
 */
export declare function renderBlocks(blocks: readonly PositionedBlock[], context: MarkdownRenderContext): ReactNode[];
/**
 * Interleave the newline text nodes the replaced pipeline emitted between
 * block-level children. They are invisible between elements but coalesce
 * into adjacent literal raw-HTML text, where the DOM parity fixtures pin
 * them.
 * @param elements - Rendered block children with empty renders already dropped.
 * @param edges - Also emit the leading and trailing newline (hast's loose wrap).
 * @returns The interleaved children.
 */
export declare function wrapBlockChildren(elements: readonly ReactNode[], edges: boolean): ReactNode[];
/**
 * Render the trailing footnote section for every footnote referenced during
 * the pass, in first-reference order, with one plain-text back-reference
 * marker per rendered reference.
 * @param context - The pass state after all blocks rendered.
 * @returns The section, or null when no referenced footnote has a definition.
 */
export declare function renderFootnoteSection(context: MarkdownRenderContext): ReactNode | null;
//# sourceMappingURL=render.d.ts.map