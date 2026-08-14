/** One-shot session-lineage and event-relationship tracing helpers. */
import type { SessionEvent, SessionId, SurfaceEvent } from '@deepseek-ai/dsh-session';
import type { SessionEventRecord, SessionEventTrace, SessionLineageTrace, SessionRecord } from './types.ts';
/**
 * Classify a raw event log with one canonical surface fold.
 * @param sessionId - owner of the event log.
 * @param events - detached raw event log.
 * @returns lightweight records in ascending log order.
 */
export declare function eventRecords(sessionId: SessionId, events: readonly SessionEvent[]): SessionEventRecord[];
/**
 * Fold and return the current model surface after validating the whole log.
 * @param sessionId - owner used in query diagnostics.
 * @param events - detached raw event log from one corpus observation.
 * @returns detached current surface events in folded order.
 */
export declare function currentSurfaceEvents(sessionId: SessionId, events: readonly SessionEvent[]): SurfaceEvent[];
/**
 * Trace one target after one canonical surface fold and whole-log validation.
 * @param sessionId - owner of the event log.
 * @param events - detached raw event log.
 * @param seq - target event seq.
 * @returns direct surface replacements and relationships to cited source events.
 */
export declare function traceEvent(sessionId: SessionId, events: readonly SessionEvent[], seq: number): SessionEventTrace;
/**
 * Trace one target's known ancestry and recursively known descendants.
 * @param records - complete logical corpus from one observation.
 * @param sessionId - target session id.
 * @returns complete or explicitly partial lineage.
 */
export declare function traceSession(records: readonly SessionRecord[], sessionId: SessionId): SessionLineageTrace;
//# sourceMappingURL=tracing.d.ts.map