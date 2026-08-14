/** Pure replay fold and strict decoder for durable goal changes. */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { GoalRef, GoalSnapshot } from './types.ts';
import type { FoldedGoal, GoalChangeMeta } from './domain.ts';
/** Mutable accumulator kept private to the pure fold. */
export interface GoalFoldState {
    goal: GoalSnapshot | undefined;
    roundsStarted: number;
    createdAt: number | undefined;
    updatedAt: number | undefined;
    lastRef: GoalRef | undefined;
    seenGoalIds: Set<GoalSnapshot['id']>;
}
/**
 * Build an empty replay accumulator.
 * @returns mutable state with no current goal or prior ref.
 */
export declare function emptyGoalFoldState(): GoalFoldState;
/**
 * Decode a value that declares itself as a goal change. Unrelated values
 * return `undefined`; malformed goal changes fail replay loudly.
 * @param value - candidate source change.
 * @returns validated goal change or `undefined` for another value kind.
 */
export declare function decodeGoalChange(value: unknown): GoalChangeMeta | undefined;
/**
 * Return the revision identity carried by a snapshot or tombstone.
 * @param change - decoded goal mutation.
 * @returns stable identity used to reconcile a deferred change with its log event.
 */
export declare function goalChangeRef(change: GoalChangeMeta): GoalRef;
/**
 * Validate and apply one decoded change to a mutable accumulator.
 * @param state - preceding durable goal projection.
 * @param change - decoded full snapshot or clear tombstone.
 */
export declare function applyGoalChange(state: GoalFoldState, change: GoalChangeMeta): void;
/**
 * Apply one session event to the strict durable goal fold.
 * @param state - mutable fold accumulator.
 * @param event - next event in sequence order.
 */
export declare function applyGoalEvent(state: GoalFoldState, event: SessionEvent): void;
/**
 * Fold current goal state from a contiguous session event log.
 * @param events - session events in sequence order.
 * @returns a fresh durable projection; activation is deliberately absent.
 */
export declare function foldGoal(events: readonly SessionEvent[]): FoldedGoal;
//# sourceMappingURL=fold.d.ts.map