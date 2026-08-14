/** Shared event metadata and semantic-document projection. */
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionEventRecord, SessionEventSearchDocument } from './types.ts';
/**
 * Project a raw log into lightweight surface-aware event records.
 * @param sessionId - session that owns the log.
 * @param events - complete contiguous raw event log.
 * @returns one record per event in ascending seq order.
 */
export declare function buildSessionEventRecords(sessionId: SessionId, events: readonly SessionEvent[]): SessionEventRecord[];
/**
 * Build first-party semantic documents for one complete raw event log.
 * @param sessionId - session that owns the log.
 * @param events - complete contiguous raw event log.
 * @returns searchable documents in ascending seq order; structural events are omitted.
 */
export declare function buildSessionEventSearchDocuments(sessionId: SessionId, events: readonly SessionEvent[]): SessionEventSearchDocument[];
//# sourceMappingURL=documents.d.ts.map