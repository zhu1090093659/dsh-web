/**
 * Persisted projection cache (`ctx.sessionProjectionCache`): durable
 * checkpoints of every registered projection unit's state, one record per
 * session on the domain data form (`session_projcache` domain — the shipped
 * json backend lands it beside `workspace.json`). The cache is a fold
 * shortcut, never an authority: a row is possibly stale (its `seq`
 * says how stale) but never wrong, so every write path is fail-soft (a lost
 * write costs a longer tail replay on the next cold read) and a
 * `ver` mismatch discards the row instead of migrating it. Design
 * authority: the session-projection RFC
 * (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
 * @module @deepseek-ai/dsh-session-projection-cache
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Session, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection';
export { checkpointIdentity, checkpointRecord, checkpointRow, projectionCacheDomainSpec } from './spec.ts';
export type { CheckpointIdentity, CheckpointRecord } from './spec.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessionProjectionCache: SessionProjectionCache;
    }
}
/**
 * Plugin config. Both throttle triggers are deployment choices with no
 * universally correct value, so the composition states them explicitly
 * (cordis.yml); the two mandatory write points (`turn/end` and session
 * disposal) are policy, not tunables, and always fire.
 */
export interface Config {
    /** Committed events per session that force a durable checkpoint write between mandatory points. */
    writeEveryEvents: number;
    /** Longest time (milliseconds) a dirty checkpoint may stay unwritten between mandatory points. */
    writeIntervalMs: number;
}
export declare const Config: z<Config>;
/**
 * The persisted projection cache service. Opens the `session_projcache`
 * domain at init, checkpoints live sessions on a throttled write-behind
 * (count/interval triggers from {@link Config}) plus two mandatory points —
 * `turn/end` and session disposal (the live-to-cold moment) — and serves the
 * cold-read ladder: cached row, persistence `readFrom` tail, registry
 * `restore`, durable write-back. Every durable write is fail-soft: failures
 * log a warning and the cache self-heals on the next write or cold read.
 */
export declare class SessionProjectionCache extends Service {
    config: Config;
    static inject: string[];
    static Config: z<Config>;
    private table?;
    private readonly dirty;
    constructor(ctx: Context, config: Config);
    /** Open the domain and install the write-behind listeners. */
    protected [Service.init](): Promise<void>;
    /**
     * The stored record for one session, accepted only when its bound log
     * identity matches `expected`. A session id names a slot, not a lifecycle:
     * a recreated id or a persistence store swapped under a surviving cache
     * must not let an old record seed state folded from an unrelated log.
     * Synchronous from the domain's in-memory state.
     * @param id - the session whose record is read.
     * @param expected - the log identity the caller holds (live or stored header).
     * @returns the identity-matching record, or `undefined` (absent or unrelated).
     */
    private recordFor;
    /**
     * The zero-I/O listing read: whole values viewed straight from the stored
     * rows (version-matching keys only), each cut carried with its watermark
     * so a client value store can seed under its higher-seq-wins rule — as
     * stale as the last durable checkpoint but never wrong, and never from an
     * unrelated log (the caller's header is the identity witness). Fresher
     * paths (the history tail baseline, {@link coldSnapshot}) supersede these
     * values whenever a session is actually opened.
     * @param meta - the listed session's header (identity witness; no log read).
     * @returns the cut (`asOfSeq` = lowest served-row watermark), or
     *   `undefined` when no usable row exists for this lifecycle.
     */
    cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined;
    /**
     * Durably checkpoint one live session NOW (both mandatory points call
     * this; tests and carriers may too). The registry cut is snapshotted at
     * this boundary (states are live references), then the whole record is
     * replaced. NOT fail-soft — callers on the fail-soft paths contain it.
     * @param session - the live session to checkpoint.
     * @returns resolution after durability and event emission.
     */
    write(session: Session): Promise<void>;
    /**
     * Cold-read one persisted session's projections with zero full-log load:
     * cached rows + a persistence `readFrom` tail from the registry's restore
     * floor, refolded by the registry and written back (fail-soft) so the next
     * cold read starts closer. A cache row invalidated by a shrunk log
     * (crash-repair truncation) triggers one full re-read from seq 0 — the
     * ladder's slow rung, still no crash. Rejects when the session has no
     * persisted log (`not found` from the persistence seam).
     * @param id - the persisted session to read.
     * @param signal - optional cancellation for the persistence reads.
     * @returns the snapshot cut at the stored log end.
     */
    coldSnapshot(id: SessionId, signal?: AbortSignal): Promise<ProjectionSnapshot>;
    private installWritePath;
    /**
     * One fail-soft durable checkpoint. Every caller has work by construction:
     * the throttle triggers only fire dirty (markClean clears the timer with
     * the counter) and the two mandatory points write unconditionally.
     */
    private flushSoft;
    /** Reset one session's dirty bookkeeping (its checkpoint is being written). */
    private markClean;
    /** Replace one session's stored record with its log identity and a detached snapshot of `rows`. */
    private put;
    /** Fail-soft {@link put}: cache writes must never fail their caller's read or event path. */
    private putSoft;
    private requireTable;
}
export default SessionProjectionCache;
//# sourceMappingURL=index.d.ts.map