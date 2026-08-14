/**
 * Pure folds for durable provider-reported token usage and context occupancy.
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { TokenUsageProjection } from './projection.ts';
import type { ShadowPriceClaim } from './surface-projection.ts';
interface UsageSample {
    turn: number;
    step: number;
    buckets: TokenUsageProjection;
}
interface TokenUsageState {
    totals: TokenUsageProjection;
    last: UsageSample | null;
}
/**
 * Context-occupancy state: the two independent last-wins records plus the
 * O(1) running surface total needed to carry the newest sample forward.
 */
interface ContextPressureState {
    contextWindow?: number;
    pressureTokens?: number;
    /** Running heuristic total over the current surface ({@link foldSurfaceProjection}). */
    surfaceTokens: number;
    /** {@link surfaceTokens} at the newest usage sample; absent until one lands. */
    sampledSurfaceTokens?: number;
    /** Shadow price armed by the immediately preceding metering event. */
    claim?: ShadowPriceClaim;
}
/**
 * Token-meter's session projection unit.
 *
 * Usage chunks provide an early sample that survives a later request failure;
 * an assistant message provides the final sample for the same turn/step. A
 * repeated sample replaces that step's earlier value instead of double
 * counting it. The single `last` slot relies on the session-log invariant
 * that usage reports for one turn/step are adjacent: once a later step begins,
 * a legal log never reports usage for an earlier step again.
 */
export declare const tokenUsageProjectionDefinition: ProjectionDefinition<'tokenUsage', TokenUsageState>;
/**
 * Token-meter's context-occupancy projection unit.
 *
 * Independent last-wins slots: the newest usage sample supplies the provider
 * numerator, the newest `request/context` record the denominator. Both are
 * whole values, so replay order alone decides the result and no cross-field
 * consistency is claimed — the pair is explicitly not one atomic request
 * observation (see {@link ContextPressureProjection}).
 *
 * `pressureTokens` is prompt-side only, so it holds still while a turn streams
 * and steps forward once the next request reports its usage. Because nothing
 * but a request reports usage, it also cannot see a compaction: the fold
 * therefore carries a running surface total alongside it and publishes
 * `projectedTokens` — the sample plus the surface's signed movement since it
 * was taken — so occupancy answers for the next request rather than the last
 * one. The total rides {@link foldSurfaceProjection}, so the state stays O(1)
 * and a replacement shrinks it by its logged shadow price. A replacement
 * without a claim preserves the previous total. A usage sample is stamped
 * BEFORE the same event joins the surface, so an `assistant/message` anchors
 * against the surface its own request saw.
 */
export declare const contextPressureProjectionDefinition: ProjectionDefinition<'contextPressure', ContextPressureState>;
export {};
//# sourceMappingURL=usage-projection.d.ts.map