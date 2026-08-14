import type { InputEffect, InputEvent, InputMachineOptions, InputState } from './contract.ts';
/** The object-replacement character backing every chip occurrence in the draft. */
export declare const PLACEHOLDER = "\uFFFC";
/**
 * Expand the draft's placeholders into their occurrences' clipboard text
 * (the persistence mirror and clipboard both write this
 * projection — U+FFFC never leaves the machine). Table order is offset
 * order, so one linear walk pairs placeholders with entries.
 * @param state - published input state.
 * @returns the plain-text projection of the draft.
 */
export declare function projectClipboard(state: Pick<InputState, 'draft' | 'occurrences'>): string;
/**
 * Pure input machine, one instance per session (per-session isolation is by
 * construction). The machine constructs one AbortController per SubmitAttempt
 * at enter time and aborts it itself on release; the shell never aborts, it
 * only observes attempt.signal on its adjudicate/submit promises. Stale
 * attempts (any adjudicated / adjudication-failed / submit-settled whose seq
 * is not the in-flight one) are dropped: same state, zero effects.
 */
export declare class InputMachine {
    private draft;
    private draftRev;
    private phase;
    private claim;
    private occurrences;
    private occurrenceSeq;
    private seq;
    private inflight;
    private log;
    private redoStack;
    /** Open single-char typing run: the next contiguous char within the window coalesces. */
    private typingRun;
    private paste;
    private pasteSeq;
    private readonly mergeWindowMs;
    private readonly now;
    constructor(options?: InputMachineOptions);
    /** Read-only snapshot of the machine state (queue always empty at this tier). */
    get state(): InputState;
    /**
     * Feed one event through the machine.
     * @param ev - Input event; the single write path for all input state.
     * @returns Effects for the shell to execute in order; empty on no-ops, locks, and dropped stale events.
     */
    dispatch(ev: InputEvent): readonly InputEffect[];
    /** Adopt a new draft: bump the revision (the span-CAS invalidation point). */
    private adopt;
    /** Push one undo unit (before-state), trim the ring, and cut the redo chain. */
    private pushTxn;
    /**
     * Reconcile the occurrence table with one edit (old-draft coordinates):
     * entries past the range shift by the length delta; entries whose
     * placeholder sits inside the replaced range go away whole (a
     * deletion/replacement intersecting a placeholder acts on the whole chip).
     */
    private reconcile;
    /** Claimed integrity watch: any mutation that breaks the token prefix releases the claim. */
    private watchClaim;
    /** Mint one occurrence at a draft offset. */
    private mint;
    /** Splice minted entries into the offset-sorted table. */
    private withMinted;
    private onDraftChanged;
    /** Span CAS: revision equality (content identity follows) plus bounds sanity. */
    private casOk;
    private onBeginCommand;
    private onInsertRef;
    /**
     * Shared chip-insertion transaction: replace [span) with one placeholder
     * occurrence (insert-ref and paste-upgrade both land here). A separating
     * space follows the chip unless one is already next.
     * @returns the inserted length (placeholder plus optional gap).
     */
    private replaceSpanWithChip;
    /**
     * Guarded token deletion after business success (popup settle / menu-pick
     * execute). No effect signals success: the caller reads the draftRev
     * advance off the published state (same currency as the other bail verbs).
     */
    private onConsumeToken;
    /**
     * Owner-resolution style bits: exactly the listed occurrences render
     * invalid. Not a transaction — the draft, revision, and undo log are
     * untouched (invalidation never deletes or rewrites chips).
     */
    private onSetInvalid;
    private onUndo;
    private onRedo;
    /**
     * Paste as one transaction: the text (U+FFFC-sanitized) replaces the
     * selection; hot-snapshot sync matches componentize inside the SAME
     * transaction (one undo returns to pre-paste); a match attempt opens for
     * the async remainder while the phase still accepts reference mutations.
     */
    private onPasteBegin;
    /**
     * Async match landed: upgrade one pasted token to a chip as an INDEPENDENT
     * transaction (undo #1 → the token text, undo #2 → pre-paste). The attempt
     * stays current — later tokens re-CAS against the advanced draftRev.
     */
    private onPasteUpgrade;
    /** Mint the next SubmitAttempt and take the in-flight slot. */
    private beginAttempt;
    private onEnter;
    private onAdjudicated;
    private onAdjudicationFailed;
    private onSubmitSettled;
    /** Ordinary send accepted: clear as a commit (no undo unit; sent content
     *  must not be resurrectable — same discipline as submit-settled success). */
    private onSendCommitted;
    private onRelease;
}
//# sourceMappingURL=machine.d.ts.map