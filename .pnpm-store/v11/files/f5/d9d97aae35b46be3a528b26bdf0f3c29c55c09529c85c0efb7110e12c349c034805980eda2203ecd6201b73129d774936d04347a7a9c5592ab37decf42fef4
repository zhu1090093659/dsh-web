/**
 * Crash-recovery repair for an interrupted session log. It preserves a fully
 * written final turn and supplies the missing tool, step, and turn boundaries
 * needed to resume with a provider-valid transcript.
 * @module @deepseek-ai/dsh-session/repair
 */
import type { SessionEvent } from './types.ts';
/** Recovery code for an assistant tool request that never reached a recorded call start. */
export declare const TOOL_NOT_STARTED = "TOOL_NOT_STARTED";
/** Recovery code for a recorded tool call whose completed outcome was not durably recorded. */
export declare const TOOL_OUTCOME_UNKNOWN = "TOOL_OUTCOME_UNKNOWN";
/**
 * Return deterministic synthetic events that close an open tail turn. Unmatched
 * calls receive error results first, followed by an open `step/end` and an
 * interrupted `turn/end`; sequences continue the log and timestamps reuse the
 * last real event. A balanced or empty log returns no events.
 *
 * @param events - the loaded durable log to scan (a valid committed prefix, possibly with a crash tail).
 * @returns the synthetic closer events to append after `events`, in order; empty when the log is already balanced.
 */
export declare function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[];
//# sourceMappingURL=repair.d.ts.map