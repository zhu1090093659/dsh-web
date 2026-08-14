/**
 * The O(1) surface-token fold shared by the token-meter projection units.
 *
 * A projection state must stay bounded — the persisted projection cache
 * checkpoints every unit's whole state, so carrying the priced surface
 * (one node per model-visible message) would grow a checkpoint without
 * bound over the session's life. Instead, replacements ride the compact
 * seam's shadow-price protocol: the metering event immediately before a
 * surface `replace` (`compaction/summary` or `compaction/prune`) states the
 * heuristic price of the exact replaced range, so the fold keeps a running
 * total plus at most one pending claim and never retains per-node prices.
 * The counts are exact by construction: producers derive them from the same
 * fixed estimator this module prices appends with. A replacement without an
 * armed claim folds with zero delta because bounded state cannot reconstruct
 * the replaced range; this preserves replay at the cost of possible drift.
 *
 * @module @deepseek-ai/dsh-token-meter/surface-projection
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * One armed shadow price: the heuristic tokens of the surface range the
 * IMMEDIATELY following event replaces. Plain JSON — it is part of the
 * persisted unit state while armed.
 */
export interface ShadowPriceClaim {
    /** Declared inclusive first surface-node seq of the priced range. */
    start: number;
    /** Declared inclusive last surface-node seq of the priced range. */
    end: number;
    /** Heuristic tokens of the priced range under the fixed estimator. */
    tokens: number;
}
/** One event's effect on a running surface-token total. */
export interface SurfaceTokensFold {
    /** Signed change in the surface total; 0 for events off the surface. */
    readonly deltaTokens: number;
    /** Claim to carry into the next event; undefined when none survives. */
    readonly claim: ShadowPriceClaim | undefined;
}
/**
 * Fold one committed event onto a running surface-token total.
 *
 * A shadow-price event arms a claim; any other event expires it, and a
 * surface `replace` consumes the claim naming its exact range — the
 * producers append the metering event and the replacement synchronously
 * adjacent, so a surviving claim always prices the very next event.
 * A replace with no claim folds with zero delta because the bounded state
 * cannot reconstruct the replaced range. An armed claim for another range
 * still fails because the adjacent events contradict each other.
 * @param claim - the claim armed by the immediately preceding event, if any.
 * @param event - the next committed session event.
 * @returns the signed token delta and the claim state after this event.
 * @throws when a replacement arrives with an armed claim for a different
 *   range — the metering event was adjacent, so this is a live producer's
 *   shadow-price contract violation, not historical data, and must fail
 *   loud rather than let the total drift.
 */
export declare function foldSurfaceProjection(claim: ShadowPriceClaim | undefined, event: SessionEvent): SurfaceTokensFold;
//# sourceMappingURL=surface-projection.d.ts.map