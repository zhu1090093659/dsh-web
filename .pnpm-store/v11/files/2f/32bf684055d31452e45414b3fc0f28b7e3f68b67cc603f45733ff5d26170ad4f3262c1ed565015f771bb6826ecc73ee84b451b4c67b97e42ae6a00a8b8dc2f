import type { ConversationSnapshot, UseProjection } from '@deepseek-ai/dsh-client-runtime/client';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client';
import type { ComposerBarProps } from '../contract/slots.ts';
interface WindowStats {
    turns: number;
    steps: number;
    /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
    llmMs: number;
    /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
    toolMs: number;
    /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
    ttftMs: number;
    /** Steps carrying a recorded TTFT. */
    ttftSteps: number;
    /** Summed decode wall time over steps that also report output tokens. */
    decodeMs: number;
    /** Summed output tokens over the same decode-timed steps. */
    decodeTokens: number;
}
/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export declare function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats;
/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export declare function formatTokens(n: number): string;
/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export declare function formatDuration(ms: number): string;
/**
 * Cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns rounded integer percent, or null when no input was billed.
 */
export declare function cacheHitPercent(usage: TokenUsageProjection): number | null;
/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export declare function billedInputTokens(usage: TokenUsageProjection): number;
interface ContextOccupancy {
    percent: number;
    usedTokens: number;
    contextWindow: number;
}
/**
 * Approximate context occupancy, using the TUI's integer rounding and upper
 * clamp. The numerator is `projectedTokens` — the provider sample carried
 * forward over the surface's movement since — so compaction shows immediately
 * instead of waiting for the next request to report usage; it falls back to the
 * bare sample only for a log whose projection predates that field. Numerator
 * and capacity remain independent last-wins projection fields, so this is a
 * reference figure rather than an exact measurement of one request (see the
 * token-meter README).
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy with its numerator and denominator, or null until both values are known.
 */
export declare function contextOccupancy(pressure: ContextPressureProjection | undefined): ContextOccupancy | null;
/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsLineProps {
    useSession: SnapshotSelectorHook<ConversationSnapshot>;
    useProjection: UseProjection;
    /** The owning dock's locale seat. */
    t: ComposerBarProps['t'];
}
export declare const StatsLine: import("react").MemoExoticComponent<({ useSession, useProjection, t }: StatsLineProps) => import("react").JSX.Element | null>;
export {};
//# sourceMappingURL=StatsLine.d.ts.map