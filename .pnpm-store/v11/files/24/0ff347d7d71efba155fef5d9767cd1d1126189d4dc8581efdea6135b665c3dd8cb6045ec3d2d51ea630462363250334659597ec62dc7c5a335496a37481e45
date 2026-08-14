import type { AssistantMessageNode, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client';
/** Latency and decode-throughput readings for one turn's footer. */
export interface TurnMetrics {
    /** First-step TTFT in ms; absent when that step carries no recorded timing. */
    ttftMs?: number;
    /** Decode throughput over steps carrying both timing and provider usage. */
    tokensPerSecond?: number;
}
/** One assistant step's derivable latency facts; null marks an unrecorded part. */
export interface StepReading {
    /** step/start → first token delta, in ms. */
    ttftMs: number | null;
    /** First token delta → final message, in ms. */
    decodeMs: number | null;
    /** Provider-reported completion tokens. */
    outputTokens: number | null;
}
type AssistantNode = AssistantMessageNode;
/**
 * Read one assistant node's TTFT, decode wall time, and output tokens.
 * @param node - A settled assistant node.
 * @returns Per-part readings with `null` for unrecorded values.
 */
export declare function assistantStepReading(node: AssistantNode): StepReading;
/**
 * Fold assistant nodes into per-turn footer metrics.
 *
 * TTFT is the turn's lowest-step request-dispatch-to-first-token reading, so
 * it is only meaningful when the turn's start is inside
 * the loaded window (the caller gates on `turnTimings`, which shares that
 * window). Throughput divides summed output tokens by summed decode wall time,
 * counting only steps that carry both.
 * @param nodes - Snapshot nodes of the loaded window.
 * @returns Turn number → available metrics; turns with none are absent.
 */
export declare function deriveTurnMetrics(nodes: readonly ConversationNode[]): Map<number, TurnMetrics>;
export {};
//# sourceMappingURL=turn-metrics.d.ts.map