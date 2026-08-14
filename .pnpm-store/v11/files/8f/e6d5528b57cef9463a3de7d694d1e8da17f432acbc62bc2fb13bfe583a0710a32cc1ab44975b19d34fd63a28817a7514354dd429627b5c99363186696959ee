/** Live/persisted logical-corpus resolution for session-query. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionRecord } from './types.ts';
/** Detached source selected for one exact read. */
export interface LogicalSession {
    /** Cloned source header. */
    header: SessionHeader;
    /** Cloned raw event log. */
    events: SessionEvent[];
}
/** Borrowed source visible only during one synchronous batch projection. */
export interface LogicalSessionSource {
    /** Header selected with `events`; callers must clone retained output. */
    readonly header: SessionHeader;
    /** Raw events selected with `header`; valid only for the projection call. */
    readonly events: readonly SessionEvent[];
}
/** One source-projection result in a batch logical-corpus observation. */
export type LogicalProjectionResult<Value> = {
    sessionId: SessionId;
    status: 'fulfilled';
    value: Value;
} | {
    sessionId: SessionId;
    status: 'rejected';
    reason: unknown;
};
/** Resolves a live-preferred corpus against the persistence service mounted now. */
export declare class SessionCorpus {
    private readonly _ctx;
    private readonly _persistedInspectConcurrency;
    private _persistence;
    private readonly _optionalPersistenceFiber;
    constructor(_ctx: Context, _persistedInspectConcurrency: number);
    /**
     * List the complete logical corpus with live precedence and cloned headers.
     * @param signal - optional cancellation for persistence listing.
     * @returns records in deterministic newest-first order.
     */
    listSessions(signal?: AbortSignal): Promise<SessionRecord[]>;
    /**
     * Load one logical source, preferring a detached live snapshot.
     *
     * A known live target never consults persistence, so an optional backend's
     * failure cannot make current in-memory history unreadable.
     * @param sessionId - session to resolve.
     * @param signal - optional cancellation for persisted source resolution.
     * @returns detached live-preferred header and events.
     */
    load(sessionId: SessionId, signal?: AbortSignal): Promise<LogicalSession>;
    /**
     * Project unique logical sources immediately from one persistence listing.
     *
     * The synchronous projector runs before a persisted worker claims its next id.
     * Full logs are borrowed only for that call and never retained by the batch.
     * @param sessionIds - sessions to resolve in first-occurrence order.
     * @param project - synchronous fold that owns/clones every retained value.
     * @param signal - cancellation shared by listing and every persisted inspection.
     * @returns one fulfilled or rejected projected result per unique requested id.
     */
    projectMany<Value>(sessionIds: readonly SessionId[], project: (source: LogicalSessionSource) => Value, signal?: AbortSignal): Promise<LogicalProjectionResult<Value>[]>;
}
//# sourceMappingURL=corpus.d.ts.map