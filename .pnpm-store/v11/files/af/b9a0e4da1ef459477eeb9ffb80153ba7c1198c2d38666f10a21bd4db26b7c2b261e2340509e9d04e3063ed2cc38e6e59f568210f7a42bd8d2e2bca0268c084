/**
 * Pure session projections for subagent identity (mode/label) and active-turn
 * duration.
 *
 * @module @deepseek-ai/dsh-subagent/projection
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { SubagentIdentityProjection } from './projection-types.ts';
interface TimingState {
    /** Milliseconds accumulated across completed post-descriptor turns. */
    settledMs: number;
    /** Current open interval kept paired inside the fold. */
    active?: {
        since: number;
        through: number;
    };
    /** Latest pre-descriptor turn start, promoted when the child's own descriptor arrives. */
    pendingTurnStart?: number;
    /** Whether the fold has crossed a descriptor in this logical log. */
    descriptorSeen: boolean;
}
/**
 * Fold turn boundaries around the child's own durable descriptor.
 *
 * A fork seed may contain an ancestor descriptor and completed turns. Every
 * descriptor therefore resets the accumulated state; the healthy catalog
 * admits only a child with exactly one descriptor in its own suffix, making
 * the final reset the child's authoritative timing origin.
 */
export declare const subagentTimingProjectionDefinition: ProjectionDefinition<'subagentTiming', TimingState>;
interface IdentityState {
    /** Identity from the last valid descriptor; absent before one, and after an invalid one. */
    identity?: SubagentIdentityProjection;
}
/**
 * Fold the durable mode/label identity from `subagent/descriptor` events,
 * last-wins: a fork seed may replay an ancestor's descriptor, and the child's
 * own descriptor must override it — the same reset discipline as
 * {@link subagentTimingProjectionDefinition}. A malformed or unknown-version
 * payload resets to the `null` sentinel instead of throwing, so a fork of a
 * healthy ancestor never inherits an identity its own descriptor failed to
 * establish — and the reset survives every JSON push frame, so a consumer
 * holding the earlier identity replaces it instead of keeping it stale;
 * `null` ⟺ no valid descriptor, with the causes deliberately undistinguished.
 */
export declare const subagentIdentityProjectionDefinition: ProjectionDefinition<'subagent', IdentityState>;
export {};
//# sourceMappingURL=projection.d.ts.map