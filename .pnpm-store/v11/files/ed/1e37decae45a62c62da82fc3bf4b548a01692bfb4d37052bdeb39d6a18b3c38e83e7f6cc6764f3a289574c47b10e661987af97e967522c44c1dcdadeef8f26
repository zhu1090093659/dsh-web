/** Workspace baseline, incremental-frame, and unary-action owner. */
import type { HostFrame, IApiClient, RpcError, RpcRequest, RpcResult, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client';
import { type WorkspaceCreateInput } from './workspace.ts';
/** Monotone workspace-list arrival lifecycle. */
export type WorkspaceListPhase = 'pending' | 'ready';
/** Immutable workspace-list snapshot. */
export interface WorkspaceListSnapshot {
    items: readonly WorkspaceView[];
    /**
     * Registry-global archive set in Host order (hidden from grouping
     * surfaces; accounting slots retained). A plain array, not a Set: public
     * snapshot state stays in the store engine's plain-data vocabulary
     * (immer drafts reject Sets without the MapSet plugin); membership
     * lookups build their own transient Set where they need one.
     */
    archivedSessionIds: readonly SessionId[];
    state: 'idle' | 'loading' | 'error';
    phase: WorkspaceListPhase;
    error: RpcError | null;
}
/** Workspace object cluster driven by one list baseline and changed-frame upserts. */
export declare class WorkspaceManager {
    private readonly api;
    private items;
    private itemViewsSource;
    private itemViewsCache;
    private archivedSessionIds;
    private state;
    private phase;
    private error;
    private inflight;
    private refreshFrames;
    /**
     * True once a frame or unary echo installed the archive set while a list
     * request was in flight: that install is newer than the pending baseline,
     * so the baseline's (older) set must not roll it back — the archive
     * mirror of replaying refreshFrames over the item baseline.
     */
    private archivedSupersedesRefresh;
    /** Latest local reorder request; only its unary echo may install order. */
    private orderRequestGeneration;
    /** Increments on order frames so a later remote commit outranks an older unary echo. */
    private orderFrameGeneration;
    /** Last complete order accepted from a Host baseline, frame, or current unary echo. */
    private committedOrder;
    /**
     * Ids this process has seen removed, kept for the connection's lifetime so
     * a late changed frame or a stale baseline row cannot resurrect a deleted
     * row. Correctness rests on Host ids never being reused (the registry mints
     * a fresh `randomUUID` per record, including when the same directory is
     * registered again) — a path-derived id scheme would turn these entries
     * into permanent blindfolds and must clear them instead.
     */
    private readonly removedIds;
    private snapshotCache;
    private readonly notifier;
    /** @param api - shared wire client. */
    constructor(api: IApiClient);
    /**
     * Refresh from workspace.list. The first successful response establishes
     * Host order; later responses re-establish the durable order so reconnects
     * adopt reorders committed while this client was offline. Frames arriving
     * during the RPC are replayed over its response.
     * @returns the shared in-flight refresh.
     */
    refresh(): Promise<void>;
    /**
     * Create or resolve a real Workspace, then publish its returned snapshot
     * without waiting for the changed frame.
     * @param input - the existing absolute path to adopt.
     * @returns the wire result.
     */
    create(input: WorkspaceCreateInput): Promise<RpcResult<{
        workspace: WorkspaceView;
        created: boolean;
    }>>;
    /**
     * Rename a Workspace, then publish its returned snapshot without waiting
     * for the changed frame.
     * @param workspaceId - target workspace.
     * @param title - new display title.
     * @returns the wire result.
     */
    rename(workspaceId: WorkspaceId, title: string): Promise<RpcResult<{
        workspace: WorkspaceView;
    }>>;
    /**
     * Delete a Workspace registration and remove its local projection from the
     * unary response without waiting for the Host frame.
     * @param workspaceId - target workspace.
     * @returns the wire result.
     */
    delete(workspaceId: WorkspaceId): Promise<RpcResult<{
        deleted: true;
    }>>;
    /**
     * Move a Workspace within the registry display order and install the full
     * returned order without waiting for the Host frame.
     * @param workspaceId - Workspace to move.
     * @param beforeWorkspaceId - Anchor workspace; omitted appends.
     * @returns the wire result.
     */
    insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<RpcResult<{
        workspaceIds: WorkspaceId[];
    }>>;
    /**
     * Move a session within its Workspace's manual order, then publish the
     * returned snapshot without waiting for the changed frame.
     * @param workspaceId - owning workspace.
     * @param sessionId - accounted session to move.
     * @param beforeSessionId - accounted anchor to insert before; omitted appends.
     * @returns the wire result.
     */
    insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<RpcResult<{
        workspace: WorkspaceView;
    }>>;
    /**
     * Archive one session in the registry-global set, then install the
     * returned full set without waiting for the changed frame.
     * @param sessionId - session to archive.
     * @returns the wire result.
     */
    archiveSession(sessionId: SessionId): Promise<RpcResult<{
        archivedSessionIds: SessionId[];
    }>>;
    /**
     * Host-frame entry. Non-workspace frames are ignored so the runtime can
     * fan one host stream out to both object managers.
     * @param envelope - host stream envelope.
     */
    handleHostEnvelope(envelope: RpcRequest<HostFrame>): void;
    /** Re-pull the baseline after each connection generation. */
    handleConnected(): void;
    /**
     * Subscribe to workspace snapshot invalidation.
     * @param listener - snapshot invalidation callback.
     * @returns unsubscribe function.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Read the cached workspace snapshot after flushing pending notifications.
     * @returns the cached workspace snapshot.
     */
    getSnapshot(): WorkspaceListSnapshot;
    private buildSnapshot;
    /**
     * Replace the archive set when membership actually changed (array identity
     * backs Object.is short-circuits). Host snapshots are append-ordered, so
     * positional comparison is exact, not merely heuristic.
     */
    private installArchived;
    /** Reorder known Workspace objects, optionally recording a Host-committed sequence. */
    private installOrder;
    /** Upsert one Host view, optionally retaining the local object that materialized it. */
    private upsert;
    /** Remove one id idempotently and retain a tombstone against late echoes. */
    private remove;
    private installViews;
    private itemViews;
}
//# sourceMappingURL=manager.d.ts.map