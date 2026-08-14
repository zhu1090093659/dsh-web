/**
 * Shared buffering, serialization, adoption, repair, and disposal orchestration
 * for first-party backends. Third-party backends may implement the public
 * persistence seam directly.
 * @module @deepseek-ai/dsh-session-persistence/coordinator
 */
import { Context } from '@deepseek-ai/cordis';
import { SessionPreparation } from '@deepseek-ai/dsh-session';
import type { SessionEvent, SessionId, SessionHeader } from '@deepseek-ai/dsh-session';
import type { SessionInspection, SessionLocation } from './index.ts';
import type { SessionPersistenceRevision } from './revision.ts';
/** Default number of detached session preparations retained by a coordinator. */
export declare const DEFAULT_PREPARED_SESSION_CACHE_SIZE = 5;
/** Default maximum intentional wait before a live session batch starts writing. */
export declare const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200;
/** Largest write batching delay accepted by Node's timer implementation. */
export declare const MAX_WRITE_BATCH_DELAY_MS = 2147483647;
/** Durable session contents failed validation after a successful backend read. */
export declare class SessionPersistenceCorruptionError extends Error {
    /**
     * @param message - stable corruption context.
     * @param options - original validation failure.
     */
    constructor(message: string, options: ErrorOptions);
}
/**
 * The stored log is intact but this runtime cannot faithfully interpret it:
 * the header carries an unsupported format version, or an event's type is
 * unknown to this build and the event is not marked ignorable. Distinct from
 * {@link SessionPersistenceCorruptionError} — nothing is damaged; the raw log
 * remains readable at {@link location} when the backend keeps one artifact
 * per session.
 */
export declare class SessionFormatUnsupportedError extends Error {
    readonly location?: SessionLocation | undefined;
    /**
     * @param message - stable reason the log cannot be interpreted, already
     *   including the raw-log path when one exists.
     * @param location - the backend's artifact location, when one exists.
     */
    constructor(message: string, location?: SessionLocation | undefined);
}
/**
 * Direction-aware refusal text for a stored session whose format version this
 * build does not read. Shared by the coordinator's load-time check and by
 * backends that must refuse BEFORE decoding version-dependent structure (a
 * future format may not satisfy today's structural checks at all, and the
 * user must see "upgrade the harness", never "corrupt").
 * @param id - the stored session id, for message context.
 * @param version - the stored format version.
 * @returns the stable refusal text, without a raw-log path suffix.
 */
export declare function sessionFormatVersionRefusal(id: string, version: number): string;
/** Coordinator policy supplied by a concrete persistence backend. */
export interface PersistenceCoordinatorOptions {
    /** Maximum completed unpublished preparations retained for reuse. */
    readonly preparedSessionCacheSize: number;
    /** Maximum intentional batching wait after an idle live queue receives work. */
    readonly writeBatchMaxDelayMs: number;
}
/**
 * A stored session's header, valid contiguous event prefix, source-qualified
 * revision, and optional opaque torn-tail marker. The revision identifies the
 * exact detached prefix. The coordinator only checks marker presence and
 * returns its value to {@link PersistenceBackend.commitRepair}; each backend
 * owns the marker type.
 */
export interface StoredPrefix<TornMarker = unknown> {
    meta: SessionHeader;
    events: SessionEvent[];
    /** Revision observed for exactly this detached prefix. */
    revision: SessionPersistenceRevision;
    tornMarker?: TornMarker;
}
/**
 * A stored session's header plus the events at or past a requested seq — the
 * return shape of the optional seek-capable
 * {@link PersistenceBackend.loadStoredFrom} hook. Non-mutating reads carry no
 * torn marker: there is nothing to repair.
 */
export interface StoredSuffix {
    meta: SessionHeader;
    events: SessionEvent[];
}
/**
 * The storage contract between {@link PersistenceCoordinator} and a concrete
 * backend: the minimal set of durable primitives the orchestration calls. A
 * backend implements these (over files, rows, an object store, …); the
 * coordinator supplies everything else (buffering, serialization, cursors,
 * adoption, crash repair sequencing, dispose quiescence).
 *
 * @typeParam TornMarker - the backend's opaque torn-tail repair token (see
 * {@link StoredPrefix}). The coordinator treats it as fully opaque.
 */
export interface PersistenceBackend<TornMarker = unknown> {
    /** Human-readable backend name, used in the dispose-failure AggregateError. */
    readonly name: string;
    /**
     * Read a stored prefix by id, scanning every backend storage scope. Returns
     * `undefined` if no stored artifact exists. Returned metadata must identify
     * `id` before repair or state publication. Used by resume/load, live adoption,
     * and — via `!== undefined` — the create-collision probe. The returned
     * `tornMarker` is present iff there is a torn tail to truncate. Every header
     * and event graph must be fresh, mutually unaliased, and unretained by the
     * backend because preparation freezes and publishes them in place. The
     * returned revision must identify exactly those values and use the same
     * representation as {@link readStoredRevision}.
     * @param id - persisted session id to resolve.
     * @param signal - optional cancellation for backend read work.
     */
    loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<TornMarker> | undefined>;
    /**
     * Read the current source-qualified revision for one stored session without
     * loading its event log. Returns `undefined` when the identity is absent.
     * @param id - persisted session id to observe.
     * @param signal - optional cancellation for backend read work.
     */
    readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined>;
    /**
     * Optional seek-capable suffix read behind the service's `readFrom`: return
     * the header plus the stored events with `seq >= fromSeq` without reading
     * the whole log. A backend whose medium can address events by seq (SQLite)
     * implements this so `readFrom` scales with the suffix; sequential backends
     * omit it and the coordinator falls back to {@link loadStored} plus a
     * forward skip. Non-mutating (no truncation, no closers). Validation of the
     * region strictly below `fromSeq` is limited to seq contiguity — the
     * service contract scopes this read to the suffix — unless that suffix
     * contains a supported legacy shape whose normalization needs earlier
     * message-identity facts, in which case the coordinator falls back
     * to the complete stored prefix.
     * Unknown-type refusal follows the same suffix scope: a seek-capable
     * backend's `readFrom` checks only the returned suffix, while the
     * sequential fallback parses the whole artifact and refuses on an unknown
     * required event anywhere in it — over-refusal on the sequential side is
     * accepted rather than widening the seek read.
     * @param id - persisted session id to resolve.
     * @param fromSeq - first event seq to include (non-negative safe integer,
     *   validated by the coordinator before this hook runs).
     * @param signal - optional cancellation for backend read work.
     */
    loadStoredFrom?(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<StoredSuffix | undefined>;
    /**
     * Durably append a CONTIGUOUS batch, lazily materializing the session first
     * when `!isMaterialized`. The materialize-write and the first event batch MUST
     * commit ATOMICALLY (a crash between them must not leave a materialized-but-
     * empty session). Returns once the batch is durable.
     */
    appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void>;
    /**
     * Make a crash repair durable: truncate the torn tail (iff
     * `tornMarker !== undefined`) and append `closers` (iff any). NOT required to
     * be atomic — a file backend may truncate-then-append in two fsync'd steps.
     * Used by load (truncate + synthetic closers) and by live-adoption (truncate
     * only, `closers = []`).
     */
    commitRepair(meta: SessionHeader, tornMarker: TornMarker | undefined, closers: readonly SessionEvent[]): Promise<void>;
    /**
     * List all stored (materialized) sessions' metadata.
     * @param signal - optional cancellation for backend listing work.
     */
    list(signal?: AbortSignal): Promise<SessionHeader[]>;
    /**
     * Optional side-effect-free artifact locator, used to point refusal
     * diagnostics ({@link SessionFormatUnsupportedError}) at the raw log.
     * Backends without one artifact per session omit it or return `undefined`.
     * @param meta - the header whose artifact is requested.
     */
    locate?(meta: SessionHeader): SessionLocation | undefined;
    /**
     * Optional lifecycle teardown (e.g. close a database handle). Awaited by the
     * coordinator's dispose effect AFTER the quiescence drain. A stateless file
     * backend omits it.
     */
    close?(): Promise<void>;
}
/**
 * Owns the backend-agnostic session write-path orchestration. A backend
 * constructs one (`new PersistenceCoordinator(ctx, this)`), implements
 * {@link PersistenceBackend}, and delegates its write/read service methods to
 * the matching coordinator methods.
 *
 * All per-id operations are serialized (a per-id promise chain) so concurrent
 * flushes / a flush racing a load never interleave storage writes. The
 * constructor installs the write-path listeners, per-session retirement, and
 * the backend dispose effect.
 *
 * @typeParam TornMarker - the backend's opaque torn-tail repair token.
 */
export declare class PersistenceCoordinator<TornMarker = unknown> {
    private ctx;
    private backend;
    /** Backend bookkeeping keyed by session id (NOT the live Session object). */
    private states;
    /** Lifecycle and write-behind state keyed by the exact live Session. */
    private live;
    /** Exact disposed lifecycles whose buffered tail is still draining. */
    private retirements;
    /** Shared cold reads, unpublished reservations, and completed LRU entries. */
    private readonly preparations;
    /**
     * Per-session serialization: every operation chains onto the prior one for the
     * same id, so writes for one session never interleave. Keyed by session id.
     */
    private chains;
    /** Resolved fixed write-batching window shared by per-session controllers. */
    private readonly writeBatchMaxDelayMs;
    constructor(ctx: Context, backend: PersistenceBackend<TornMarker>, options?: PersistenceCoordinatorOptions);
    /**
     * Register detached session metadata for lazy creation on the first append.
     * @param meta - header to snapshot; duplicate tracked or persisted ids reject.
     */
    create(meta: SessionHeader): Promise<void>;
    private createCore;
    /**
     * Durably persist a batch of events. Honors the append-only and contiguous-seq
     * contracts; rejects non-JSON-serializable `event.data`.
     * @param id - the session the batch belongs to.
     * @param events - the contiguous batch to persist, in seq order; materialized
     *   as a detached lossless-JSON snapshot at call time.
     */
    append(id: SessionId, events: readonly SessionEvent[]): Promise<void>;
    private appendCore;
    /**
     * Prepare and reserve the exact unpublished Session used by resume.
     * Revision retries converge once the durable log remains unchanged for one
     * read/check round trip; continuous external writers may delay completion.
     * @param id - persisted session to prepare.
     * @param signal - optional cancellation for reading and repair.
     * @returns an owned preparation released after publication or rollback.
     */
    prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>;
    /**
     * Commit recovery and return its immutable logical view without publication.
     * Revision retries converge once the durable log remains unchanged for one
     * read/check round trip; continuous external writers may delay completion.
     * @param id - persisted session to load.
     * @returns prepared header and balanced events.
     */
    load(id: SessionId): Promise<SessionInspection>;
    /**
     * Inspect a logical session without publishing it or committing recovery.
     * A stale ready source is reloaded. A source already committing or reserved
     * for resume remains exclusive, and inspection may borrow its immutable view.
     * Revision retries converge once the log is stable for one read/check round
     * trip; continuous external writers may delay completion.
     * @param id - persisted session to inspect.
     * @param signal - optional cancellation for preparation work.
     * @returns immutable prepared metadata and events; a live view may have an open turn.
     */
    inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>;
    /**
     * Read the stored events from `fromSeq` onward, detached and non-mutating
     * (the read-from-seq primitive behind the service's `readFrom`). Runs on
     * the same per-id chain as writes; a backend with the seek-capable
     * {@link PersistenceBackend.loadStoredFrom} hook reads only the suffix,
     * every other backend reads its stored prefix and skips forward here.
     * @param id - persisted session to read.
     * @param fromSeq - first event seq to include; a non-negative safe integer.
     * @param signal - optional cancellation for queued and backend read work.
     * @returns stored header and the valid stored events with `seq >= fromSeq`.
     */
    readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{
        meta: SessionHeader;
        events: SessionEvent[];
    }>;
    private readFromCore;
    /** Read one detached physical prefix without logical recovery or caching. */
    private readStoredPrefix;
    /** Read, repair in memory, validate, and freeze one cold source once. */
    private prepareCore;
    /** Commit one prepared repair and establish its ownerless durable cursor. */
    private commitPrepared;
    /** Whether one cached source still names the current durable log revision. */
    private isPreparedSourceCurrent;
    /** Return one durable immutable view of an already-live Session. */
    private loadLiveSnapshot;
    /** Borrow one immutable view from an already-live Session. */
    private inspectLive;
    /** Await one retiring lifecycle with caller cancellation. */
    private waitForRetirement;
    /**
     * Run `op` after any in-flight operation for the same session id, so writes for
     * one session never interleave. Errors do not poison the chain. NOTE: serialized
     * public methods must NOT call each other (deadlock); they call the unserialized
     * `*Core` helpers instead.
     */
    private serialize;
    /** Build a state for a session discovered in storage but not yet in memory. */
    private adopt;
    private assertVersion;
    /**
     * Refuse a log containing an event type this build does not know, unless the
     * writer marked the event ignorable: an unrecognized required event may
     * change how the rest of the log must be interpreted, so silently skipping
     * it would reconstruct a wrong session (the envelope contract on
     * `SessionEvent.ignorable`). Runs on NORMALIZED events — after
     * `snapshotStoredEvents`/`adoptStoredEvents` has upgraded the legacy shapes
     * this build still reads and rejected the ones it does not, so those keep
     * their specific diagnostics.
     */
    private assertEventsSupported;
    /** Build a format refusal that points at the raw artifact when the backend has one. */
    private unsupported;
    /** Reject backend metadata that is not bound to the requested session id. */
    private assertStoredId;
    private installWritePath;
    /** Start and observe one disposed session's final drain. */
    private retire;
    /** Drain and release state owned by one exact disposed Session lifecycle. */
    private retireCore;
    /** Return the one lifecycle controller for a live session, creating it if needed. */
    private initFor;
    /** Bind one exact prepared Session and persist only its unpublished suffix. */
    private attachPrepared;
    /**
     * Whether a live session's `seed` reproduces the first `cursor` persisted
     * events. A `cursor` of 0 (nothing persisted yet) trivially matches. Used when
     * a live session claims ownerless state left by a prior `load()`/`create()`.
     */
    private seedMatchesPersisted;
    /**
     * On session/created: sync the backend's in-memory state to a live Session.
     *
     * Cases, by whether this backend tracks the id and whether an artifact exists:
     *   1. Already tracked → no-op (or claim ownerless state if the seed matches,
     *      or reclaim a truly-abandoned id, else reject as a collision).
     *   2. Not tracked, an artifact EXISTS at the same cwd and is a seq-aligned
     *      PREFIX of the live events → ADOPT it, persisting any live suffix.
     *   3. Not tracked, an artifact EXISTS at another cwd or is NOT a prefix →
     *      REJECT (collision).
     *   4. Not tracked and NO artifact → a genuinely new session: register meta
     *      (lazy) and persist its seed once.
     */
    private onCreated;
    /**
     * Adopt a stored prefix as a live session's history (HMR/reload): verify the
     * seed covers the stored prefix, truncate any torn tail (NOT the open turn —
     * the live Session is still the authority), bind ownership, and persist the
     * live suffix that was ahead of the stored prefix.
     */
    private adoptLivePrefix;
    private flush;
    /** Build one package-private write controller around initialization and id serialization. */
    private createWriteBehind;
    /** Append one controller-owned prefix after filtering events initialization already stored. */
    private appendLiveBatch;
}
//# sourceMappingURL=coordinator.d.ts.map