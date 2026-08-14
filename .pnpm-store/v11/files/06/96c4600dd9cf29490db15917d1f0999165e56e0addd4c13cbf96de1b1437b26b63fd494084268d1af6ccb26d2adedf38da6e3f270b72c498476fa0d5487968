/**
 * SessionInput shell over the pure input machine: the sole machine caller
 * and effect executor. Owns the InputState store (machine state + the queue
 * overlay), the notice channel, and the submit transaction plumbing
 * (adjudicate via the session's InputTriggerController; claim.submit; default
 * sink). Package-private; the hub alone constructs it and wires the scoped
 * event listeners onto it.
 */
import type { ClientContext, ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { ArbitrateKey, ArbitrateOutcome, CommandClaim, ConsumeTokenRequest, ReferenceInsert, InputTriggerController, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { DraftAttachmentId, EditRange, EditSelection, InputActions, InputNotice, InputState, PasteComponent, QueuedMessage, SessionInput } from './contract.ts';
import type { InputSubmitMode } from '../contract/composer-submission.ts';
/** Popup face the shell needs (dismissal only; typed structurally to avoid a value import). */
export interface PopupDismissFace {
    dismiss(): void;
}
/**
 * Construction dependencies of one facade. The slash/popup faces are THUNKS: the
 * shell is created inside the sessions provide materialization (before the
 * scope record is queryable), where `slash.sessionOf`/`command.popupFor`
 * cannot resolve yet — resolution defers to first interactive use.
 */
export interface SessionInputDeps {
    /** Session-scope ctx handed to claim.submit transactions. */
    actx: ClientContext;
    /** Enter adjudication face resolver; absent/undefined answer = every '/' line falls to the default sink. */
    inputTriggers?: (() => InputTriggerController | undefined) | undefined;
    /** PopupSelect shell face resolver (dismissal on submit lock / escape). */
    popup?: (() => PopupDismissFace | undefined) | undefined;
    /** Queue read face; overlaid onto InputState.queue (absent = empty). */
    queue?: ObservableSnapshot<readonly QueuedMessage[]> | undefined;
    /**
     * Steer every still-pending queued message into the running turn, in FIFO
     * order (the empty-draft accelerated-Enter gesture); absent = unsupported.
     */
    steerQueue?: (() => void) | undefined;
    /** The plain-message sink (send choreography / materialize fork — the hub owns it). */
    defaultSink(text: string, imageIds: readonly DraftAttachmentId[], mode: InputSubmitMode): void;
}
/**
 * The per-session input facade: scoped-event application verbs +
 * setDraft/submit + the published InputState store.
 */
export declare class SessionInputShell implements SessionInput {
    private readonly deps;
    /** Published machine state + queue overlay (the InputZone currency source). */
    readonly state: SnapshotStore<InputState>;
    /** Latest surfaced notice (null after clear); the wiring renders it beside the error strip. */
    readonly notices: SnapshotStore<InputNotice | null>;
    /** The public provide-channel action face (one stable identity per session). */
    readonly actions: InputActions;
    private readonly core;
    private noticeSeq;
    private lastDraft;
    private imageIds;
    private disposed;
    /** Draft persistence mirror (chat store write; receives the clipboard projection, never raw placeholders). */
    private mirrorFn;
    constructor(deps: SessionInputDeps);
    /**
     * Single draft write path (all mutation rides machine events).
     * @param text - the full next draft.
     * @param editRange - the DOM-observed edit shape, when the caller knows it
     * (narrows the machine's occurrence math; absent → diff scan).
     */
    setDraft(text: string, editRange?: EditRange): void;
    /** Append ordered image ids unless an admission transaction is locked. */
    addImages(ids: readonly DraftAttachmentId[]): boolean;
    /** Remove one image id from this draft. */
    removeImage(id: DraftAttachmentId): void;
    /**
     * Keep only image ids that still resolve in the browser attachment registry.
     * @param available - live registry ids.
     */
    pruneImages(available: readonly DraftAttachmentId[]): void;
    /**
     * Restore a failed attempt before any images added after its admission.
     * @param ids - failed attempt image ids.
     */
    restoreImages(ids: readonly DraftAttachmentId[]): void;
    /**
     * Clear the draft as a successful-send commit: no undo unit is recorded and
     * the undo history is cut, so Ctrl/Cmd-Z cannot resurrect sent content
     * (the command path gets the same discipline from submit-settled success).
     * @param imageIds - admitted image ids to remove from this draft.
     */
    commitSend(imageIds: readonly DraftAttachmentId[]): void;
    /** Undo the latest transaction (InputBar intercepts the platform chord). */
    undo(): void;
    /** Redo the latest undone transaction. */
    redo(): void;
    /**
     * Paste text over the selection in one transaction, with any hot-snapshot
     * sync matches componentized inside it.
     * @param text - pasted plain text.
     * @param selection - replaced selection in draft coordinates.
     * @param components - sync-matched reference components (disjoint, inside `text`).
     * @param generation - projection generation for late async-upgrade guards.
     */
    pasteBegin(text: string, selection: EditSelection, components?: readonly PasteComponent[], generation?: number): void;
    /** End the live paste-match attempt (caret/selection ops and Slash updates the machine cannot see). */
    invalidatePaste(): void;
    /**
     * Enter adjudication + submit transaction + default sink. Effects fan out
     * from the machine; this method only feeds the event. Lock entry
     * (adjudicating/submitting) force-closes the transient layers: the popup
     * dismisses and the menu tracks frozen.
     */
    submit(mode?: InputSubmitMode): void;
    /**
     * Feed a draft/caret change through trigger detection (guard derived from
     * the machine phase).
     * @param draft - live draft text.
     * @param caret - caret position in draft coordinates.
     */
    track(draft: string, caret: number): void;
    /**
     * Keyboard arbitration while the menu is open.
     * @param key - the intercepted key.
     * @param composing - IME composition guard state.
     * @returns the menu's verdict; 'pass' when no pipeline is mounted.
     */
    arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome;
    /**
     * Steer every still-pending queued message into the running turn (the
     * empty-draft accelerated-Enter gesture). Execution belongs to the hub's
     * queue choreography; absent dep = the gesture falls back to the machine's
     * empty-draft no-op.
     */
    steerQueue(): void;
    /**
     * Space adjudication over the controller's hot state.
     * @returns true = a claim/insert was applied — the caller preventDefaults.
     */
    space(): boolean;
    /** Dismiss the popupSelect shell (any interaction outside the box). */
    dismissPopup(): void;
    /**
     * Hot plain-text reference lexicon source for the decoration scan
     * (the plain-text-reference decision;
     * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
     * delegates to the controller's aggregated store. Stable
     * identity per shell; without a pipeline the snapshot is the empty Map and
     * subscribers never fire.
     */
    readonly lexicon: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>>;
    /**
     * Apply one command claim (scoped begin-command event listener body).
     * @param claim - the command claim from the pick path.
     * @param span - pick-time span snapshot.
     * @returns whether the machine accepted (phase + span CAS passed and the draft mutated).
     */
    beginCommand(claim: CommandClaim, span: TokenSpan): boolean;
    /**
     * Apply one reference insertion (scoped insert-reference event listener body).
     * @param ref - the reference insertion from the pick path.
     * @param span - pick-time span snapshot.
     * @returns whether the machine accepted.
     */
    insertReference(ref: ReferenceInsert, span: TokenSpan): boolean;
    /**
     * Consume one command token after business success (scoped consume-token
     * event listener body). Span guard: revision CAS then splice; bare-token
     * guard: trimmed-draft equality then clear.
     * @param guard - exact span or bare-token guard.
     * @returns whether the token was consumed.
     */
    consumeToken(guard: ConsumeTokenRequest['guard']): boolean;
    /**
     * Insert plain reference text over the pick-time span (scoped insert-text
     * event listener body; plain-text-reference decision, web-input-machine
     * note). Same CAS-then-splice shape as the
     * consume-token span branch: the machine sees an ordinary draft-changed
     * transaction (one undo step), no occurrence is minted — the chip look is
     * a scan-derived decoration, never state.
     * @param text - the plain reference text to splice in (e.g. `/name `).
     * @param span - pick-time span snapshot (draftRev CAS).
     * @returns whether the text was applied.
     */
    insertText(text: string, span: TokenSpan): boolean;
    /**
     * Surface a notice from outside the machine (detached command results).
     * @param level - severity tier.
     * @param text - notice body.
     */
    notify(level: 'info' | 'error', text: string): void;
    /** Teardown: abort any in-flight attempt and stop accepting async settlements. */
    dispose(): void;
    /** Read the live machine state (guard derivation reads here). */
    get snapshot(): InputState;
    /**
     * Bind the draft persistence mirror (chat store write). Adopt-on-bind: the
     * store draft may hold a persisted value from a previous mount; the caller
     * seeds it via setDraft BEFORE binding, and afterwards every machine-adopted
     * draft mirrors out.
     * @param write - store draft write.
     * @returns the unbind disposer.
     */
    bindMirror(write: (text: string) => void): () => void;
    private run;
    private execute;
    /**
     * Prompt serialization before the sink: expand each
     * placeholder to its owner's model form via the session controller's
     * codec routing. Owner missing / serialize failure / disposal blocks the
     * send — notice + draft and chips retained, never a silent downgrade to
     * the clipboard text. Chip-free drafts skip the async detour.
     */
    private sinkSerialized;
    /** Enter adjudication: poll the session controller; failure = notice + draft retained (never a silent downgrade). */
    private adjudicate;
    /** The submit transaction: claim.submit against the session scope; ok maps from the outcome kind. */
    private beginSubmit;
    /** Late-settlement guard: superseded attempts and disposed facades drop silently. */
    private dead;
    private compose;
    private publish;
}
//# sourceMappingURL=facade.d.ts.map