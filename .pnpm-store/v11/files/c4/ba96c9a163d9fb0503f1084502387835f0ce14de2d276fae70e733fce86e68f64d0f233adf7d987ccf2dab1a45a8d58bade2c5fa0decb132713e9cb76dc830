/**
 * Incremental block-level markdown parsing for an append-only text stream.
 *
 * Re-parsing the whole accumulated document on every streaming chunk is
 * quadratic in the final reply length. CommonMark block parsing is line-based
 * and appended text can only reshape the parse frontier — the last top-level
 * block (a paragraph becoming a setext heading or a table, a list continuing
 * after a blank line, an unclosed fence swallowing lines) — so earlier blocks
 * are final. This parser therefore freezes all but the trailing
 * {@link UNSTABLE_TAIL_BLOCKS} blocks and re-parses only the source tail
 * behind them: each source region is parsed O(1) times over the stream
 * instead of once per chunk.
 *
 * The freeze boundary comes from the parser's own `position` offsets, never
 * from custom source scanning. The cut sits at the *end offset* of the last
 * frozen block (not the next block's start): a following block's start offset
 * excludes up to three spaces of insignificant leading indentation, which is
 * harmless to drop, but cutting at the previous end also keeps the
 * inter-block blank lines in the tail so the sliced source stays verbatim.
 *
 * Known deviation, shared with any prefix-freeze scheme: micromark resolves
 * reference-style links and footnotes document-wide at parse time, so a
 * reference whose definition lands on the other side of the freeze boundary
 * renders literally until the settled full parse self-heals it.
 */
import type { Root, RootContent } from 'mdast';
/** A top-level mdast block plus a render key that is stable across chunks. */
export interface PositionedBlock {
    /** The parsed block. Positions inside it are relative to its parse slice. */
    readonly node: RootContent;
    /**
     * The block's start offset in the full source text. Stable from the frame
     * a block first appears through freezing, so React reconciles rather than
     * remounts when a block crosses the freeze boundary.
     */
    readonly key: number;
}
/** One {@link IncrementalMarkdownParser.update} result. */
export interface IncrementalBlocks {
    /** Blocks that can no longer change; grows monotonically per generation. */
    readonly frozen: readonly PositionedBlock[];
    /** The re-parsed unstable tail (at most {@link UNSTABLE_TAIL_BLOCKS} blocks plus growth). */
    readonly tail: readonly PositionedBlock[];
    /** Bumped whenever non-append input discards the frozen prefix; callers drop caches keyed on it. */
    readonly generation: number;
}
/**
 * Append-only incremental parser over a caller-supplied grammar. One instance
 * accumulates one streaming document; non-append input resets it.
 */
export declare class IncrementalMarkdownParser {
    private readonly parse;
    private prevText;
    private tailStart;
    private frozen;
    private generation;
    private cached;
    /** @param parse - Grammar shared with whatever renders the blocks, so boundaries agree. */
    constructor(parse: (text: string) => Root);
    /**
     * Fold the current accumulated text and return the frozen/tail split.
     * Idempotent for identical input (the previous result is returned as-is),
     * so callers may invoke it from render paths that re-execute.
     * @param text - The full accumulated markdown source.
     * @returns Frozen and tail blocks with stream-stable render keys.
     */
    update(text: string): IncrementalBlocks;
}
//# sourceMappingURL=incremental.d.ts.map