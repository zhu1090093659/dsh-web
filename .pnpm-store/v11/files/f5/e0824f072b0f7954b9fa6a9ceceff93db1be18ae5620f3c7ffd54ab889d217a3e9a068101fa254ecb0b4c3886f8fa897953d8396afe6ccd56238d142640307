/**
 * Event-sourced session service: append-only session log, in-memory store, and
 * the derived LLM message history. Persistence is a plugin concern (subscribe
 * to `session/event`, drain on `session/flush`).
 *
 * @module @deepseek-ai/dsh-session
 */
import { Context, Service } from '@deepseek-ai/cordis';
import type { Scoped } from '@deepseek-ai/dsh-scope';
import type { Message } from '@deepseek-ai/dsh-llm';
import { SessionId } from './types.ts';
import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol';
import type { CreateSessionOptions, EpochHeader, PrepareSessionOptions, RequestContext, SessionEvent, SessionEventMap, SessionEventType, SessionHeader, SurfaceIntent, SurfaceEventType } from './types.ts';
import type { SessionSurface } from './surface.ts';
export * from './types.ts';
export { SessionPreparation } from './preparation.ts';
export type { SessionPreparationOptions } from './preparation.ts';
export type { AssistantMessage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm';
export { isJsonValue, snapshotJsonValue } from './json.ts';
export type { JsonValue } from './json.ts';
export { interruptedTurnClosers, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from './repair.ts';
export { decodeStorageRecord, packChunkRuns } from './chunk-rows.ts';
export type { ChunkRow, StorageRecord } from './chunk-rows.ts';
export type { SessionSurface, SurfaceFoldReplacement, SurfaceFoldResult } from './surface.ts';
export { deriveEventMessage, foldSurface, isAppendSurfaceEvent, isReplacementSurfaceEvent, isSurfaceEvent, isSurfaceEligibleType } from './surface.ts';
export { canonicalHeader, foldRequestHeader, headerEquals } from './request-header.ts';
export { KNOWN_SESSION_EVENT_TYPES } from './known-event-types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessions: SessionStore;
    }
    interface Events {
        /**
         * Creation announcement during session publication. A synchronous throw vetoes and rolls
         * back with a paired disposal; detach requested during dispatch is deferred.
         * A returned-promise rejection is logged but cannot retroactively veto this
         * synchronous boundary.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
         * receive only sessions entered through that agent's context.
         * @param session - the session just entered and announced.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'session/created'(this: Scoped<Session>, session: Session): void;
        /**
         * Emitted once when an announced session leaves the store, including
         * publication rollback, but never for an entry whose creation announcement
         * did not begin. Listener failures are logged and contained.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
         * @param session - the session that is no longer live in the store.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'session/disposed'(this: Scoped<Session>, session: Session): void;
        /**
         * Post-commit, fire-and-forget append feed. The listener snapshot resolves
         * before the log push, but callbacks run after it; observer failures are
         * logged and contained without making the committed append fail.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
         * receive only events from sessions entered through that agent's context.
         * @param session - the session whose log grew.
         * @param event - the appended event, exactly as recorded.
         * @dshScopeScan unsupported
         * @mode emit
         */
        'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void;
        /**
         * Awaited parallel durability checkpoint: every listener runs and the
         * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
         * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
         * @param session - the session whose buffered events must reach durable storage.
         * @dshScopeScan unsupported
         * @mode parallel
         */
        'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void;
    }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertLookupMap {
        session: TypertLookup<Session, SessionId>;
    }
}
/**
 * Validate an exclusively owned event and deeply freeze its identified message
 * without copying the event. The caller transfers an object graph that no
 * producer retains and that shares no mutable children with another event.
 * Use {@link snapshotSessionEvent} when exclusive ownership is not guaranteed.
 * @param event - exclusively owned event imported across a trusted boundary.
 * @returns the same event object with a validated, deeply frozen message.
 */
export declare function adoptSessionEvent<T extends SessionEvent>(event: T): T;
/**
 * Detach one event while preserving deep immutability for its identified message.
 * @param event - event imported across a query or persistence boundary.
 * @returns a detached event snapshot with a validated, deeply frozen message.
 */
export declare function snapshotSessionEvent<T extends SessionEvent>(event: T): T;
/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
export declare class Session {
    private log;
    /** Single incremental owner of surface acceptance and projection state. */
    private readonly surfaceManager;
    /** The ordered surface over this session's event log. */
    get surface(): SessionSurface;
    /**
     * Detached, deep-frozen creation metadata (format version, cwd, lineage,
     * seed boundary). Supplied by the store via `ctx.sessions.create()`. When a
     * `Session` is created without a store-owned header, a minimal header is
     * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
     * `session.header` is always present. Kept out of the event log — it is a
     * storage concern, not replayable conversation state.
     */
    readonly header: SessionHeader;
    /** The session identity, derived from its durable header's single copy. */
    get id(): SessionId;
    /**
     * The first seq appended IN THIS PROCESS: the length of the constructor
     * seed (0 without one). Events with smaller seq values entered through
     * construction — replay, fork, or resume — and were never published on the
     * `session/event` firehose (constructor seeds do not emit), so consumers
     * that replay the log as a publication substitute (telemetry adoption)
     * start here. Distinct from `header.seedLength`, the DURABLE fork-lineage
     * boundary: a resumed session's constructor seed is its full stored log,
     * while its header keeps the original fork value — this field is the
     * in-process construction fact.
     *
     * Not persisted itself: a seeded session projects it into the log as the
     * `session/end-seed` event, which is what a consumer reading STORED history
     * reads. Locate the LAST such event, not necessarily one at this seq — a
     * seed already ending in one is not re-marked, so reopening an untouched
     * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
     * this field in-process: it is exact before the marker reaches storage.
     *
     * When this lifecycle appends the marker, it occupies this seq before the
     * store attaches and therefore does not publish either. Otherwise this seq
     * holds an ordinary published write.
     */
    readonly firstLiveSeq: number;
    /**
     * Create a detached session by validating and snapshotting borrowed seed
     * events and storage metadata.
     * @param id - session identity.
     * @param seed - optional borrowed replay or fork events.
     * @param header - optional borrowed storage metadata.
     * @returns a detached session.
     */
    static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader): Session;
    /**
     * Restore a detached session by taking ownership of fresh persistence values.
     * The storage format, event envelopes, sequence continuity, surface transitions,
     * and header fields are validated before the restored objects are frozen.
     * @param id - restored session identity.
     * @param seed - fresh detached events whose ownership is transferred.
     * @param header - fresh detached metadata whose ownership is transferred.
     * @returns a restored detached session.
     */
    static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader): Session;
    private constructor();
    /** Cached immutable public snapshot of the private append-only log. */
    private eventsSnapshot;
    /**
     * An immutable snapshot of the append-only event log. The snapshot is reused
     * until the next append; a previously returned array does not grow later.
     * Events and their nested data are deep-frozen at acceptance, so neither a
     * cast nor ordinary JavaScript can rewrite durable history.
     */
    get events(): readonly SessionEvent[];
    /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
    get seq(): number;
    /**
     * Append one typed event to the log and synchronously notify observers via
     * the store-owned, module-private publication hooks. The hot path never blocks
     * on I/O — persistence plugins buffer asynchronously. Once the event enters
     * the log, the append is committed: observer failures are logged and
     * contained per listener, so they do not change the return value or prevent
     * later listeners from observing the same accepted event.
     *
     * @param type - The event type (key of {@link SessionEventMap}).
     * @param data - The event payload; must be JSON-serializable.
     * @param opts - Surface metadata: `surfaceOp` controls how the event enters
     *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
     *   events this one derives from. REQUIRED for
     *   {@link SurfaceEventType} events (every message-producing event must
     *   declare how it joins the surface, the sole source of derived model
     *   history) and
     *   rejected by the compiler for non-surface types like `turn/start` or
     *   `assistant/chunk`.
     * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
     *   `data` that entered the log, so reading `event.data` back sees the logged
     *   value, never the caller's still-mutable input.
     * @throws if `data` or surface metadata is not losslessly JSON-serializable
     *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
     *   circular reference, sparse array, or an exotic object such as
     *   Map/Set/Date/class instance), or when the candidate violates the
     *   canonical surface contract (marker shape and eligibility, unique
     *   earlier source-event references, positional replacement validity, and complete
     *   shadowed-node coverage). One recursive pass reads, validates, and
     *   copies each nested value once, so a stateful getter cannot supply one value
     *   to validation and another to storage. The event log is the durable source
     *   of truth, so a bad event fails at the append site rather than later during
     *   a backend flush. A synchronous internal dispatch validation failure or an
     *   append reentered while this acceptance/publication boundary is open also
     *   rejects before the log changes.
     */
    append<T extends SessionEventType>(type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []): SessionEvent<T>;
    /** Cached fold of the request-header events — see {@link requestHeader}. */
    private headerFold;
    /** Log position (events consumed) the header fold has reached. */
    private headerFoldSeq;
    /**
     * The {@link EpochHeader} in force after the log's last header event — the
     * header the NEXT request will be compared against — or undefined before
     * the first `request/header` snapshot. The live, incrementally-maintained
     * form of `foldRequestHeader(session.events)`: each header event is folded
     * once, when first seen, so a per-step read costs O(new events).
     * @returns the folded header, or undefined when no header event exists yet.
     */
    requestHeader(): EpochHeader | undefined;
    /** Cached fold of `request/context` events. */
    private contextFold;
    private contextFoldSeq;
    /**
     * Return the latest resolved route metadata, or `undefined` before the first
     * `request/context` event. Each event is folded once.
     * @returns the latest immutable route metadata.
     */
    requestContext(): RequestContext | undefined;
    /** The derived-message cache: frozen projections, extended per unseen node. */
    private derived;
    /** Surface position (nodes projected) the cache has reached. */
    private derivedNodes;
    /** {@link SurfaceManager.replaceGeneration} the cache was built under. */
    private derivedGeneration;
    /**
     * Derive the LLM message history by walking the ordered sequences of
     * message-producing events maintained by `surfaceOp` markers. The
     * surface is the single source of derived history: every message-producing
     * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
     * turn boundary) is correctly absent, and a compaction `replace` deletes the
     * shadowed nodes from the derivation. The projection rules are
     * {@link deriveEventMessage}, folded per node.
     *
     * CACHED: each surface node is projected exactly once, when first seen — a
     * call costs O(new nodes), and a surface rewrite (a `replace`;
     * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
     * a fresh snapshot per call (later appends never grow an array a caller
     * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
     * Their content reuses the already frozen durable event data, so the cache
     * needs no second deep clone and consumers still cannot mutate the log.
     * @returns a fresh array of the shared, frozen derived history.
     */
    deriveMessages(): Message[];
    /**
     * Instance face of the pure per-node `deriveEventMessage` export from
     * `surface.ts`.
     * @param event - the event to project.
     * @returns the derived message, or null when the event produces none.
     */
    deriveEventMessage(event: SessionEvent): Message | null;
}
/** A fork source: either the live session object or its live store id. */
export type SessionForkSource = Session | SessionId;
/**
 * Rejection codes for session forking: the fork source id is unknown to the
 * live store (`SESSION_NOT_FOUND`) or names a session object that is not the
 * store's live instance (`SESSION_NOT_LIVE`); the requested child id is
 * already taken (`SESSION_ALREADY_EXISTS`); the boundary is not a contiguous
 * existing seq (`INVALID_BOUNDARY`); or the selected prefix ends inside an
 * open turn (`OPEN_TURN`).
 */
export type SessionForkErrorCode = 'SESSION_NOT_FOUND' | 'SESSION_NOT_LIVE' | 'SESSION_ALREADY_EXISTS' | 'INVALID_BOUNDARY' | 'OPEN_TURN';
/** Typed error for session fork rejections. */
export declare class SessionForkError extends Error {
    readonly code: SessionForkErrorCode;
    constructor(message: string, code: SessionForkErrorCode);
}
/**
 * In-memory session store (`ctx.sessions`).
 *
 * Persistence is intentionally not implemented here — persistence plugins
 * subscribe to `session/event` and flush on `session/flush` / dispose.
 */
export declare class SessionStore extends Service {
    private store;
    private counter;
    constructor(ctx: Context);
    /**
     * Create a session owned by the calling fiber: disposing that fiber stops
     * event notification and removes the session from the store. `options.seed`
     * populates the session with a copy of those events (replay/fork);
     * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
     * and parent lineage, and delegation depth) as the immutable
     * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
     *
     * For an agent whose session must be torn down IN ORDER with its loop (so the
     * loop's final events are published before the store attachment ends), do NOT use this
     * — fold the session lifecycle into the agent's own effect via
     * {@link prepare} + {@link enter} + {@link announce} (see
     * `dsh-agent-loop`'s creation transaction).
     *
     * @param id - the session id; omitted, the store mints `session-<n>`.
     * @param options - seed events and/or creation metadata for the header.
     * @returns the live session, already entered and announced.
     * @throws if a session with `id` already exists, metadata is not a plain
     *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
     *   non-absolute path (storage backends key directories off it).
     */
    create(id?: SessionId, options?: CreateSessionOptions): Session;
    /**
     * Build a session WITHOUT entering it into the store — validate the id/cwd and
     * construct the {@link Session} (with its immutable {@link SessionHeader}).
     * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
     * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
     * effect so a fiber unload tears the session + agent down as a single ORDERED
     * chain rather than as racing sibling effects — which would remove the publication hooks
     * before the driver's closing events commit, dropping them.
     *
     * @param id - the session id; omitted, the store mints `session-<n>`.
     * @param options - seed events and/or creation metadata for the header. With
     *   `seedSource: 'persistence'`, metadata and events must be fresh detached
     *   graphs whose ownership transfers to this call: they are validated and
     *   frozen in place through {@link Session.fromRestore}, so the caller must
     *   retain no mutable aliases.
     * @returns the constructed session, NOT yet in the store.
     * @throws if a session with `id` already exists, metadata is not a plain
     *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
     *   non-absolute path.
     */
    prepare(id?: SessionId, options?: PrepareSessionOptions): Session;
    /**
     * Enter a {@link prepare}d session into the store: install the module-private
     * append publication hooks and add it to the store. Returns the DETACH
     * disposer (hooks + store removal). Does NOT emit `session/created` —
     * the caller yields this disposer inside its effect and THEN calls
     * {@link announce}, so a throwing `session/created` listener rolls the attach
     * back instead of leaking it.
     *
     * Re-checks the id for a duplicate: `prepare` and `enter` are public
     * cross-package primitives and a caller may interleave arbitrary work (or
     * another create) between them, so a stale prepared session must NOT overwrite
     * a live store entry of the same id — its detach disposer would later delete
     * the REAL session. The {@link create} convenience and the agent factory call
     * the two back-to-back so they never trip this, but the public API cannot
     * assume that.
     *
     * @param session - a {@link prepare}d session not yet in the store.
     * @returns the detach disposer (publication hooks + store removal). When called from
     *   a synchronous `session/created` listener, removal and disposal wait until
     *   that creation dispatch unwinds.
     * @throws if a session with this id is already in the store.
     */
    enter(session: Session): () => void;
    /** Remove one exact entered session and emit its paired disposal when announced. */
    private detachEntered;
    /** Emit `session/created` exactly once for an {@link enter}ed session (with
     * the carrier {@link enter} captured). Separate from {@link enter} so the
     * caller can yield the detach disposer first (rollback safety — see
     * {@link enter}).
     * @param session - the entered session to announce to listeners.
     * @throws if the session is not live or its announcement already began,
     *   including a reentrant call from a creation listener. */
    announce(session: Session): void;
    /** Emit the paired teardown notification with per-listener containment. */
    private emitDisposed;
    /**
     * Dispatch the awaited `session/flush` durability checkpoint for `session`,
     * with the carrier captured at {@link enter}. THE flush entry point: the
     * store owns the carrier, so callers (the checkpoint policy's per-request
     * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
     * that flush themselves before reading storage) must come through here
     * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
     * one spelling, and the scoped-dispatch invariant can pin it.
     * @param session - the session whose buffered events must reach durable storage.
     * @returns whether at least one durability listener participated, after every
     *   listener has settled successfully.
     * @throws the first registered listener failure after every listener settles.
     */
    flush(session: Session): Promise<boolean>;
    /** Return the exact live entry; detached/prepared objects reject. */
    private liveEntryFor;
    /**
     * Look up a live session.
     * @param id - the session id to look up.
     * @returns the session, or undefined when no live session has that id.
     */
    get(id: SessionId): Session | undefined;
    /**
     * All live sessions, in creation order.
     * @returns a fresh array; mutating it does not affect the store.
     */
    list(): Session[];
    /**
     * Create a live child session from a stable prefix of a live source.
     * `boundary` is an inclusive source event seq; omitted means the source's
     * current last event. The selected slice may end with a between-turn event
     * but must not end inside an open turn.
     *
     * @param source - Live source session object or id.
     * @param boundary - Inclusive source event seq to fork through; omitted means
     *   the source's current last event, and omitted on an empty source forks an
     *   empty child.
     * @param childSessionId - Optional child session id; omitted delegates to
     *   `SessionStore`'s id policy.
     * @returns The created live child session.
     */
    fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session;
    private _forkSeed;
    private _resolveForkSource;
}
export default SessionStore;
//# sourceMappingURL=index.d.ts.map