/**
 * Service Definition for combined session-history reads, traces, filters, and full-text search.
 *
 * @module @deepseek-ai/dsh-session-query
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { type SessionId } from '@deepseek-ai/dsh-session';
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title';
import type { SessionEventResultFilter, SessionEventSearchPage, SessionEventReadRequest, SessionEventRecord, SessionEventSearchDocument, SessionEventSearchRequest, SessionEventTraceObservation, SessionEventTraceRequest, SessionEventWindow, SessionLineageTrace, SessionLogSnapshot, SessionRecord, SessionResultFilter, SessionSearchExecContext, SessionSearchHit, SessionSearchPage, SessionSearchRequest, SessionSurfaceSnapshot, SessionTitleObservation, SessionTitleObservationResult } from './types.ts';
import { type Config } from './config.ts';
export type * from './types.ts';
export { SessionSearchCursor } from './cursor.ts';
export type { Config, SessionQueryErrorCode } from './config.ts';
export { SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY, SESSION_QUERY_READ_WINDOW_MAX, SessionQueryError, } from './config.ts';
export { extractSessionEventText } from './extraction.ts';
export { buildSessionEventRecords, buildSessionEventSearchDocuments } from './documents.ts';
export { compileSessionTextFilter, filterSessionEventDocuments, filterSessionResults, materializeSessionEventResultFilters, materializeSessionResultFilters, } from './filters.ts';
export { assertSessionHeadersCompatible } from './sources.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessionQuery: SessionQueryEngine;
    }
}
/**
 * Unified live-preferred session query service.
 *
 * Exact reads, filters, and traces are backend-independent concrete behavior.
 * A backend implements full-text observation, reconciliation, ranking, cursor
 * generations, and query execution on the same `ctx.sessionQuery` service.
 */
export declare abstract class SessionQueryEngine extends Service {
    static inject: string[];
    private readonly _readWindowMax;
    private readonly _corpus;
    constructor(ctx: Context, config?: Config);
    /**
     * Search the live-preferred logical corpus and group by session.
     * @param request - query text, metadata filters, page size, and cursor.
     * @param exec - optional cancellation control.
     * @returns session hits ranked by their strongest matching event.
     */
    abstract searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>;
    /**
     * Search events within one live-preferred logical session.
     * @param request - target session, query text, filters, page size, and cursor.
     * @param exec - optional cancellation control.
     * @returns matching event hits and their target header from one indexed generation.
     */
    abstract searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage>;
    /**
     * List the complete logical corpus using live-preferred records.
     * @param signal - optional cancellation for persistence listing.
     * @returns deterministic newest-first cloned session records.
     */
    listSessions(signal?: AbortSignal): Promise<SessionRecord[]>;
    /**
     * Read and replay-validate one complete logical session log without making it live.
     * @param sessionId - live or persisted session id to read.
     * @returns cloned header and complete raw event log from one observation.
     * @throws when persistence, header compatibility, or replay validation fails.
     */
    readSession(sessionId: SessionId): Promise<SessionLogSnapshot>;
    /**
     * Filter the complete logical corpus with provider-independent predicates.
     * @param filters - ANDed session metadata and availability clauses.
     * @param signal - optional cancellation for persistence listing.
     * @returns matching cloned records in deterministic newest-first order.
     */
    filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]>;
    /**
     * Fold the latest log-backed title from one live-preferred logical session.
     * @param sessionId - live or persisted session id to read.
     * @param signal - optional cancellation for source resolution and title folding.
     * @returns latest title snapshot, or `undefined` when the log has no title event.
     */
    readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>;
    /**
     * Fold the latest title and return its source header from one corpus observation.
     * @param sessionId - live or persisted session id to read.
     * @param signal - optional cancellation for source resolution and title folding.
     * @returns cloned source header and optional latest title snapshot.
     */
    readTitleSnapshot(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleObservation>;
    /**
     * Fold titles for unique sessions from one cancellable corpus observation.
     *
     * Results preserve first-occurrence input order. Operational failures stay
     * isolated per session, while cancellation rejects the complete operation.
     * @param sessionIds - live or persisted session ids to observe.
     * @param signal - optional cancellation shared by all source reads.
     * @returns one fulfilled or rejected result per unique requested id.
     */
    readTitleSnapshots(sessionIds: readonly SessionId[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]>;
    /**
     * List lightweight raw-log event records for one logical session.
     * @param sessionId - live-preferred session id to read.
     * @returns event records in ascending seq order.
     */
    listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>;
    /**
     * Scan first-party semantic event documents with provider-independent filters.
     * @param sessionId - live-preferred session id to scan.
     * @param filters - ANDed metadata and literal-text predicates.
     * @returns matching semantic documents in ascending seq order.
     */
    filterEvents(sessionId: SessionId, filters: readonly SessionEventResultFilter[]): Promise<SessionEventSearchDocument[]>;
    private _filterSessions;
    private _filterEvents;
    /**
     * Read one session's complete current model surface from one corpus observation.
     * @param sessionId - live-preferred session id to read.
     * @returns cloned header, current surface, and the last sequence number included in the raw-log capture.
     * @throws when source resolution fails or the session surface is invalid.
     */
    readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot>;
    /**
     * Trace known ancestry and descendants from one corpus observation.
     * @param sessionId - logical session id to trace.
     * @param signal - optional cancellation for persistence listing.
     * @returns a complete lineage or the first parent that could not be resolved.
     * @throws when corpus resolution fails, the target is absent, or its known ancestry cycles.
     */
    traceSession(sessionId: SessionId, signal?: AbortSignal): Promise<SessionLineageTrace>;
    /**
     * Trace one event's direct positional replacements and cited source events.
     * @param request - target session id and event seq.
     * @param signal - optional cancellation for persisted source resolution.
     * @returns source header, direct links, and the target's positional replacement chain.
     * @throws when source resolution fails, the target is absent, or surface/source-event validation fails.
     */
    traceEvent(request: SessionEventTraceRequest, signal?: AbortSignal): Promise<SessionEventTraceObservation>;
    /**
     * Read one full event plus a bounded raw-log context window.
     * @param request - target session/seq and context sizes.
     * @param signal - optional cancellation for persisted source resolution.
     * @returns cloned target and neighboring events.
     */
    readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>;
    private _readEvent;
    private _readWindow;
}
export default SessionQueryEngine;
//# sourceMappingURL=index.d.ts.map