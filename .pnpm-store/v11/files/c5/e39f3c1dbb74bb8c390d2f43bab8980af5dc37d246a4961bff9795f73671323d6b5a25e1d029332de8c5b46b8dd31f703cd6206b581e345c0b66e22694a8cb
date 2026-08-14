/**
 * Draft decoration pure core (chips render from the occurrence
 * table at placeholder offsets; the claim token renders as a mirror-layer
 * highlight, the claim hint as ghost text). Zero React — the skeleton renders
 * the instructions; tests drive this directly.
 */
import type { InputState } from './contract.ts';
/** The claim-token highlight range (always draft-leading while the watch holds). */
export interface TokenRange {
    readonly start: number;
    readonly end: number;
}
/** One chip render instruction: the placeholder at `offset` draws as `label`. */
export interface ChipRender {
    /** Stable render key (same-labeled chips stay independent). */
    readonly occurrenceId: number;
    /** Placeholder offset in the draft (the chip occupies [offset, offset+1)). */
    readonly offset: number;
    readonly label: string;
    /** Owner-resolution failure styling bit. */
    readonly invalid: boolean;
}
/**
 * One plain-text reference range (the plain-text-reference decision;
 * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * a `/name` or `@name` token
 * whose name is on the trigger's lexicon. Pure derivation — editing the text
 * out of match shape simply drops the range next scan.
 */
export interface TextRefRange {
    readonly start: number;
    readonly end: number;
    readonly trigger: '/' | '@';
}
/** Decoration product: claim token range + chip instructions + text-ref ranges + the ghost hint. */
export interface DraftDecorations {
    /** Claim token range while claimed/submitting and the prefix watch holds; null otherwise. */
    readonly token: TokenRange | null;
    /** Chip render instructions in draft order (occurrence table is offset-sorted). */
    readonly chips: readonly ChipRender[];
    /** Scan-derived plain-text reference ranges (empty without a lexicon). */
    readonly textRefs: readonly TextRefRange[];
    /** Ghost hint shown while the claim's args are blank; null otherwise. */
    readonly hint: string | null;
}
/**
 * Scan the draft for plain-text reference tokens against the hot lexicons.
 * Word-boundary discipline: the trigger must sit at the draft
 * start or after whitespace ('x/name' never matches); the name must be an
 * exact lexicon member.
 * @param draft - draft text.
 * @param lexicon - per-trigger name lists (a missing trigger scans nothing).
 * @returns matched ranges in draft order.
 */
export declare function scanTextRefs(draft: string, lexicon: ReadonlyMap<'/' | '@', readonly string[]>): TextRefRange[];
/**
 * Derive the mirror-layer decorations from the input state.
 * @param state - published input state.
 * @param lexicon - optional per-trigger reference lexicons (plain-text-reference scan).
 * @returns token range, chip instructions, text-ref ranges, and the ghost hint.
 */
export declare function deriveDecorations(state: InputState, lexicon?: ReadonlyMap<'/' | '@', readonly string[]>): DraftDecorations;
//# sourceMappingURL=decorations.d.ts.map