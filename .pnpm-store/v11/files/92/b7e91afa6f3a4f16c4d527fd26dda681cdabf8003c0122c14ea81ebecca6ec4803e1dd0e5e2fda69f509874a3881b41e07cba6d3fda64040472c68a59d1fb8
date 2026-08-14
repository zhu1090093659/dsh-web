/**
 * SessionRuntime: root sessions service — list snapshot store (manager
 * projection; carries `current`, the persisted selection every
 * session-scoped surface keys off), Agent scope tree (mintScope pattern: no-op plugin
 * Fiber + ctx.extend scope tag; one scope per session, agent id === session
 * id), stable SessionBinding cache, breadcrumb-route projection.
 *
 * Scope lifecycle is stage-driven: a scope is minted lazily on first
 * resolution (pure — resolution has no side effects and is render-safe);
 * the event window and deferred teardown key off the STAGED session, which
 * follows `list.current` exactly. Staging is the open signal: the window
 * opens ⟺ the session is on stage (today the stage is `current`; the staged
 * state can widen to a multi-pane list later). A session leaving the list
 * tears its scope down immediately unless it is the staged one, whose scope
 * survives frozen (read-only view) until the stage moves on.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { IApiClient, RpcError, RpcResult, SessionId, SubagentAddress, JobView, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client';
import type { HostObservable, SessionMaybeProvideInfo } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';
import type { SnapshotStore } from '../contract/store.ts';
import type { SessionFace } from '../contract/session.ts';
import type { AgentContext, ISessions } from '../contract/sessions.ts';
import type { ConversationRuntime } from './conversation-assembler.ts';
import { SessionManager } from './manager.ts';
import type { SessionRemotes } from './remotes.ts';
import type { SessionListPhase, SessionSearchResultItem, SubagentCatalogSnapshot } from './manager.ts';
import type { PendingInteractionStatus } from './pending.ts';
/** Session list row projected from the host list RPC plus live stream increments. */
export interface SessionSummary {
    id: SessionId;
    /** Latest durable log-backed title, absent until the host projects one. */
    title?: string;
    /** Human-facing label: durable title, project basename, then session id. */
    displayTitle: string;
    cwd?: string;
    /**
     * Agent preset this session's agent was composed from; absent when the
     * deployment composes no presets. The session header labels what the
     * session actually runs rather than the deployment's current default.
     */
    agentPreset?: string;
    parentId?: SessionId;
    /** Coarse durable origin for navigation filtering; not a continuation capability. */
    origin?: 'subagent';
    running: boolean;
    /** User interaction currently blocking this session (sidebar amber-dot state). */
    pendingInteraction?: PendingInteractionStatus;
    /** Finished while not selected and not yet opened — the sidebar's green "done" reminder. Absent = false. */
    completed?: boolean;
    /**
     * Empty-log bit (host summary derivation mirror). New Session reuses a blank
     * one targeting the same workspace. Filtering stays with the consumer: the
     * store carries every row, while the Workspace browser shows only the
     * selected blank entry.
     */
    blank: boolean;
    updatedAt: number;
    /** Current host-computed projection values retained by the object layer. */
    projectionValues?: Readonly<Partial<SessionProjectionMap>>;
}
/**
 * Session list store shape. `current` rides the same snapshot (arbitrated:
 * the single useSessions standard hook reads list and selection together —
 * sidebar highlighting and SessionProvider share one fact source).
 */
export interface SessionListState {
    /** Host-list order; addressed breadcrumb-only rows are excluded. */
    ids: SessionId[];
    /** Host rows plus the current addressed subagent route used by navigation. */
    byId: Record<SessionId, SessionSummary>;
    current: SessionId | undefined;
    /** Arrival lifecycle projected 1:1 from the manager snapshot (see SessionListPhase): empty-with-ready means "truly no sessions". */
    phase: SessionListPhase;
    /** Direct durable catalogs keyed by their selected parent address. */
    subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>;
    /**
     * Background jobs each session can see, mirrored last-wins from
     * `session/jobs`. A missing key is an empty set — the Host sends no baseline
     * for a session without tasks — so consumers read absence, never a sentinel.
     */
    jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>;
    /** Current session's catalog-derived address, absent on ordinary navigation. */
    currentAddress: SubagentAddress | undefined;
}
/** Structured session-create failure. */
export declare class SessionCreateError extends Error {
    readonly rpcError: RpcError;
    readonly requestedSessionId: SessionId | undefined;
    readonly name = "SessionCreateError";
    /**
     * @param rpcError - Host business or folded transport error.
     * @param requestedSessionId - caller-preallocated id used for later stream/list reconciliation.
     */
    constructor(rpcError: RpcError, requestedSessionId: SessionId | undefined);
}
/** Structured session-fork failure. */
export declare class SessionForkError extends Error {
    readonly rpcError: RpcError;
    readonly sourceSessionId: SessionId;
    readonly name = "SessionForkError";
    /**
     * @param rpcError - Host business or folded transport error.
     * @param sourceSessionId - the session the fork was cut from.
     */
    constructor(rpcError: RpcError, sourceSessionId: SessionId);
}
/** Session assembly handle for SessionProvider/inject factories (identity-stable per session). */
export interface SessionBinding {
    readonly sessionId: SessionId;
    /** The outward session face only — feature code never sees the concrete class. */
    readonly session: SessionFace;
    readonly ctx: AgentContext;
}
export { scopeOf } from '../agents/scope.ts';
/**
 * Workspace display title of a session cwd: the path's last non-empty
 * segment (both separators accepted; trailing separators ignored), or ''
 * for separator-only paths — callers own their fallback (session id, raw
 * cwd, default-directory copy). The repo-wide single basename derivation —
 * every surface naming a workspace (picker rows, toggle labels, list titles)
 * calls this instead of re-splitting paths.
 * @param cwd - workspace directory path.
 * @returns basename title, or '' when no non-empty segment exists.
 */
export declare function workspaceTitleOf(cwd: string): string;
/** One plugin's per-session standard-props contribution (see {@link SessionRuntime.provide}). */
export interface SessionProvideContribution {
    /** Bare observable sources, keyed by hook base name ('input' → useInput). */
    hooks?: Record<string, HostObservable<unknown>>;
    /** Stable plain members (action callbacks etc.), spread into standard props verbatim. */
    props?: Record<string, unknown>;
}
/**
 * Static declaration plus per-session resolver for one standard-kit
 * contribution. The declared names let the renderer construct the same hook
 * and prop surface while no session is current.
 */
export interface SessionProvideDescriptor {
    /** Hook base names (`input` becomes `useInput`). */
    hooks?: readonly string[];
    /** Plain standard-prop names. */
    props?: readonly string[];
    /** Resolve every declared member for one definite session. */
    resolve(binding: SessionBinding): SessionProvideContribution;
}
/** Root sessions service: list store, current selection, object-layer manager, scope tree, bindings, and breadcrumb routes. */
export declare class SessionRuntime implements ISessions {
    private readonly rootCtx;
    /**
     * The wire schema's own result bound, re-exposed for presentation plugins as
     * injected data. Not per-connection state: the `session.search` response
     * schema caps `items` at this constant, so every transport (fixture included)
     * reports the same number.
     */
    readonly searchResultLimit = 20;
    /** List snapshot store (list RPC + host stream increments; re-pulled on reconnect) — the useSessions standard feed, current included. */
    readonly list: SnapshotStore<SessionListState>;
    /** The object-layer instance cluster and frame dispatch entry. */
    private readonly manager;
    /**
     * Atomic current-session provide projection: selection changes and
     * provider-roster changes publish through this one source (the renderer
     * host's `sessions.provide` feed), so a roster change under a stable
     * current id republishes the bundle instead of stranding mounted entries.
     */
    readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>;
    /**
     * Persisted selection cell (the durable half of `list.current`). Private on
     * purpose: reads go through the list snapshot; writes through {@link
     * SessionRuntime.open} / {@link SessionRuntime.clear}. Projection
     * validates it against the live list instead of destructively pruning, so a
     * selection survives transient list states (reconnect re-pull) and
     * resurfaces when its session returns.
     */
    private readonly selection;
    private readonly scopes;
    /** The provide channel (roster, materialization rules, current projection) — shared with the test runtime's double. */
    private readonly provideChannel;
    /**
     * The staged session id — follows `list.current` exactly, holding its last
     * defined value across masked gaps (a transiently absent selection blanks
     * `current` without moving the stage, so reconnect re-pulls and removals
     * keep the staged scope's frozen view alive until the stage moves on).
     */
    private watched;
    /** Removed-while-staged sessions whose teardown waits for the stage to move away. */
    private readonly deferredRemovals;
    /**
     * @param ctx - client root context (scope fibers mount under it).
     * @param api - wire client shared with every Session.
     * @param remote - generated Remote namespaces shared with every Session.
     * @param conversationRuntime - same-pass registry instances, when runtime apply owns them.
     */
    constructor(rootCtx: Context, api: IApiClient, remote: SessionRemotes, conversationRuntime?: ConversationRuntime);
    /**
     * Register a per-session standard-props provider: every session-scope slot
     * component receives the contributed members as standard props (`hooks`
     * sources become `use<Name>` selector hooks on the render side; `props`
     * spread verbatim). Contributions materialize lazily with the session's
     * scope record and die with it. Registration order is resolution order;
     * duplicate member names fail loud at materialization.
     * @param descriptor - static member roster plus per-session resolver.
     * @returns disposer removing the provider (already-materialized bundles keep their members until their scope drops).
     */
    provide(descriptor: SessionProvideDescriptor): () => void;
    /**
     * Select a listed or retained catalog-addressed session as current.
     * @param id - listed or addressed session id.
     */
    open(id: SessionId): void;
    /**
     * Open a healthy catalog child through its direct-parent address.
     * @param address - catalog-derived parent and child ids.
     */
    openSubagent(address: SubagentAddress): void;
    /**
     * Resolve an already discovered direct-parent address without opening it.
     * Feature plugins use this to avoid Agent-bound RPCs in persisted child views.
     * @param id - possible addressed child id.
     * @returns The retained address, when present.
     */
    subagentAddress(id: SessionId): SubagentAddress | undefined;
    /**
     * Inform the runtime whether a catalog menu is consuming membership updates.
     * @param parentSessionId - selected parent.
     * @param open - menu state.
     */
    setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void;
    /**
     * Refresh one direct-child catalog.
     * @param parentSessionId - catalog owner.
     */
    refreshSubagents(parentSessionId: SessionId): Promise<void>;
    noteAgentPreset(sessionId: SessionId, agentPreset: string): void;
    /**
     * Clear the current selection so the layout shows the no-session empty
     * state (new-session affordance and the workspace preselection flow).
     * Wipes the persisted selection too — a reload stays on empty until the
     * user opens or starts a session. The staged scope keeps its frozen view
     * per the masked-gap contract until the next open() moves the stage.
     */
    clear(): void;
    /**
     * Refresh the real Session baseline, reusing an in-flight pull.
     * @returns completion of the current or newly started baseline pull.
     */
    refresh(): Promise<void>;
    /**
     * Search the Host's visible message-content index. Results stay
     * request-local; the list snapshot remains the metadata authority.
     * @param query - non-blank literal phrase.
     * @param signal - cancellation for a superseded search.
     * @returns bounded results or a business/transport error.
     */
    search(query: string, signal: AbortSignal): Promise<RpcResult<{
        items: SessionSearchResultItem[];
        hasMore: boolean;
    }>>;
    /**
     * Route a mux stream envelope into the Session object layer.
     * @param envelope - validated mux stream envelope.
     */
    handleMuxEnvelope(envelope: Parameters<SessionManager['handleMuxEnvelope']>[0]): void;
    /**
     * Route a Host stream envelope into the Session object layer.
     * @param envelope - validated Host stream envelope.
     */
    handleHostEnvelope(envelope: Parameters<SessionManager['handleHostEnvelope']>[0]): void;
    /** Rebuild the Session baseline and every opened window after connection. */
    handleConnected(): void;
    /** Drop generation-scoped live interaction state the moment a connection generation dies. */
    handleDisconnected(): void;
    /**
     * Create a session on the host. Resolution guarantee: by the time the
     * promise resolves, the created session is in the list store and
     * {@link SessionRuntime.binding} resolves it — callers (New Session
     * draft hand-off) may address the scope synchronously, without waiting a
     * notifier flush. The synchronous projection below makes this structural
     * rather than an accident of microtask ordering.
     * @param opts - target workspace or directory and an optional preallocated id.
     * @returns the new session id.
     * @throws {SessionCreateError} with the requested id.
     */
    create(opts?: {
        workspaceId?: WorkspaceId;
        cwd?: string;
        sessionId?: SessionId;
    }): Promise<SessionId>;
    /**
     * Fork a session from a completed-turn prefix of the source (same
     * synchronous-addressability guarantee as {@link SessionRuntime.create}:
     * on resolution the child is in the list store and open() can target it).
     * @param opts - source session id, the optional event seq anchoring the
     *   cut (the boundary is the first turn/end at or after it; an in-log
     *   anchor in an open turn is unavailable rather than clipped backward),
     *   and whether to increment an inherited durable title before resolving.
     *   A fractional anchor floors to a real event seq: the frozen nodes of an
     *   interrupted turn carry flow-ordering seqs between two events, and the
     *   wire takes integers only.
     * @returns the child session id.
     * @throws {SessionForkError} with the source id.
     * @throws {Error} when a requested child-title rename fails after creation.
     */
    fork(opts: {
        sessionId: SessionId;
        atSeq?: number;
        increaseTitle?: boolean;
    }): Promise<SessionId>;
    /**
     * Resolve an Agent-scoped context view (use-and-discard).
     * @param id - session id (the agent identity — 1:1 same axis).
     * @returns scoped ctx, or undefined for a session neither listed nor already scoped.
     */
    scope(id: SessionId): AgentContext | undefined;
    /**
     * Read the Agent scope tag off a context. Service-method boundary: fetch
     * bundles must reach scope resolution through ctx.sessions — a cross-bundle
     * value import of the standalone helper would inline a second module
     * instance whose private tag Symbol never matches.
     * @param ctx - any client context.
     * @returns the session id, or undefined on root contexts.
     */
    scopeOf(ctx: Context): SessionId | undefined;
    /**
     * Resolve the business Session behind an Agent-scoped context — the one
     * hop every scoped consumer (event listeners, per-session controllers)
     * takes from ctx-space into object-space (the client mirror of host
     * `agent.session`). Same service-method boundary as
     * {@link SessionRuntime.scopeOf}.
     * @param ctx - an Agent-scoped context.
     * @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
     */
    sessionOf(ctx: Context): SessionFace | undefined;
    /**
     * Resolve the stable session binding (scope-addressed assembly feed). Pure
     * resolution — no staging, no window side effects.
     * @param id - session id.
     * @returns binding, or undefined for a session neither listed nor already scoped.
     */
    binding(id: SessionId): SessionBinding | undefined;
    /**
     * Resolve one session's render-layer standard-props bundle (ctx never
     * enters the render layer; the renderer subscribes to
     * {@link SessionRuntime.currentProvideInfo}). Pure resolution — render-safe:
     * no staging, no window side effects (StrictMode double-invokes and
     * concurrent discarded passes must stay free).
     */
    private provideInfo;
    /**
     * Resolve the current-session-optional standard kit. Unknown or absent ids
     * return the static no-session projection rather than removing hook props.
     */
    private maybeProvideInfo;
    /**
     * Move the stage to the list's current session: sweep teardowns deferred
     * behind the previous occupant and pull the new occupant's history window.
     * Staging IS the open signal — the window opens ⟺ the session is on stage
     * — and open() is idempotent (an in-flight or completed open no-ops; a
     * failed one retries the next time current is touched).
     */
    private followCurrent;
    /**
     * Lazily mint the scope + binding for an eligible session. Eligibility and
     * prune share one predicate: listed on the host or selected
     * through a retained subagent address. Breadcrumb-only ancestors remain
     * summary data and do not keep scopes alive.
     */
    private resolve;
    /** The one aliveness predicate shared by scope mint and prune: host-listed or currently addressed. */
    private eligible;
    /** Project the manager's list snapshot into the store (title derivation is display-only). */
    private projectList;
    /** Tear down scope + instance for no-longer-eligible sessions off stage; the staged one defers until the stage moves. */
    private pruneScopes;
    /**
     * One teardown for the whole per-session axis: the scope
     * fiber (cascading every actx-registered effect: input shell, slash
     * controller, popup, plugin stores, listeners), the session-keyed slot
     * stores, and the Session instance itself — the host session log is the
     * durable truth, a reopen lazily rebuilds and backfills via open().
     */
    private dropScope;
    /** Run deferred teardowns whose session is no longer staged (called when the stage moves). */
    private sweepDeferred;
}
//# sourceMappingURL=service.d.ts.map