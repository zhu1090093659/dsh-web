/**
 * How one agent log accounts for the work it consumed.
 *
 * The turn and step vocabulary alone cannot answer this. A turn that stops
 * before its first step leaves a `turn/end` shaped exactly like the balanced
 * no-op turns a rejection or an empty claim produces, so reading turns in
 * isolation either credits cut-short work as finished or convicts every no-op.
 * The missing fact is the inbox's own record: {@link Inbox} logs each mutation
 * with `removedCount` and marks a cancellation `outcome: 'canceled'`, which
 * separates a turn claiming its input from work being dropped unrun.
 *
 * @module @deepseek-ai/dsh-agent/consumed-work
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** How one agent log accounts for the work it consumed. */
export interface ConsumedWork {
    /**
     * The latest closed turn that accounts for consumed work: one that entered a
     * model step, or one that claimed inbox input and then failed, was stopped,
     * or was rejected. Absent when no turn closed over any work.
     */
    readonly end?: SessionEvent<'turn/end'>;
    /**
     * Whether accepted work was cancelled out of the inbox, unrun, after that
     * turn. This is the only account of input a cancellation took before any turn
     * could open over it — no `turn/end` describes it.
     */
    readonly droppedUnrun: boolean;
}
/**
 * Fold one agent log, or an owned suffix of one, into its account of consumed
 * work. Single pass, and every input is the log itself: no caller has to sample
 * live state before cancelling, so a cancellation issued by anyone — the owner's
 * teardown, an ancestor's interrupt, an unloading plugin — reads the same.
 * @param events - the log, or an owned suffix, to fold.
 * @returns the accounting turn when one closed, and whether work was dropped unrun after it.
 */
export declare function foldConsumedWork(events: readonly SessionEvent[]): ConsumedWork;
//# sourceMappingURL=consumed-work.d.ts.map