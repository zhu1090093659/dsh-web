/**
 * Pure fold for the heuristic context-composition projection: system prompt
 * and tool schemas from the newest request envelope, conversation from the
 * live surface. Prices with the same shared estimator as the meter service,
 * so the three figures match `measure()`'s heuristic vocabulary exactly.
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { ShadowPriceClaim } from './surface-projection.ts';
interface ContextBreakdownState {
    systemTokens: number;
    toolsTokens: number;
    messageTokens: number;
    /** Shadow price armed by the immediately preceding metering event. */
    claim?: ShadowPriceClaim;
}
/**
 * Token-meter's context-composition projection unit.
 *
 * Envelope figures are last-wins per `request/header`; the message figure
 * rides {@link foldSurfaceProjection} — the same O(1) fold the occupancy
 * projection uses — so fully metered logs equal `measure().surfaceTokens` at
 * every event boundary and compaction shrinks the figure by its logged shadow
 * price. A replacement without a claim preserves the previous total. The
 * state is a fixed handful of numbers, so the persisted checkpoint stays
 * O(1) over the session's life.
 */
export declare const contextBreakdownProjectionDefinition: ProjectionDefinition<'contextBreakdown', ContextBreakdownState>;
export {};
//# sourceMappingURL=breakdown-projection.d.ts.map