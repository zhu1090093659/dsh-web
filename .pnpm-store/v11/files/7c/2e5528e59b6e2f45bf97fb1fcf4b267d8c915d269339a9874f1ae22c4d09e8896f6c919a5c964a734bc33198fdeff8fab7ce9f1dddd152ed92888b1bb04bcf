/** WorkspaceRuntime projects the Workspace object manager for UI consumers. */
import type { Context } from '@deepseek-ai/cordis';
import type { DirectoryListing, IApiClient, RpcError, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client';
import type { SnapshotStore } from '../contract/store.ts';
import type { SessionsPort } from '../contract/sessions-port.ts';
import type { IWorkspaces } from '../contract/workspaces.ts';
import { WorkspaceManager, type WorkspaceListPhase } from './manager.ts';
/** Workspace list plus the two-baseline readiness and default-target projection. */
export interface WorkspaceListState {
    items: readonly WorkspaceView[];
    /**
     * Registry-global archive set in Host order: grouping surfaces hide these
     * sessions everywhere (workspace groups and the ungrouped bucket) while
     * their session logs and workspace accounting slots remain. A plain array
     * (store-engine vocabulary; immer drafts reject Sets) — membership lookups
     * build their own transient Set.
     */
    archivedSessionIds: readonly SessionId[];
    state: 'idle' | 'loading' | 'error';
    phase: WorkspaceListPhase;
    error: RpcError | null;
    /** True only after both workspace.list and session.list have succeeded. */
    baselinesReady: boolean;
    /** Most recently active Workspace, derived without changing `items` order. */
    recentWorkspaceId: WorkspaceId | undefined;
}
/** Structured create failure for UI flows that distinguish Host business errors. */
export declare class WorkspaceCreateError extends Error {
    readonly rpcError: RpcError;
    constructor(rpcError: RpcError);
}
/** Structured browse failure so the directory browser can branch on Host business codes. */
export declare class DirectoryBrowseError extends Error {
    readonly rpcError: RpcError;
    constructor(rpcError: RpcError);
}
/** Real Workspace object layer and Host actions. */
export declare class WorkspaceRuntime implements IWorkspaces {
    private readonly api;
    private readonly sessions;
    /** UI-facing immutable projection; the manager remains wire truth. */
    readonly list: SnapshotStore<WorkspaceListState>;
    /** Workspace baseline and frame owner. */
    private readonly manager;
    /** In-flight blank-session creates keyed by workspace (connectWorkspace coalescing). */
    private readonly connecting;
    /** Guards the runtime-owned one-shot initial-selection subscription. */
    private initialSelectionStarted;
    /**
     * @param ctx - client root context.
     * @param api - shared wire client.
     * @param sessions - cross-domain sessions face used for recency and blank-session reuse.
     */
    constructor(ctx: Context, api: IApiClient, sessions: SessionsPort);
    /**
     * Resolve the session a New Session flow lands in once this Workspace is
     * chosen: reuse the workspace's existing blank session when one is in the
     * list mirror, else create a fresh one on the host (`session.create` births
     * the full Session+Agent — the client holds no intermediate state). The
     * caller owns navigation: take the returned id to `sessions.open`.
     * Resolution guarantee (both arms): the returned id is already in the list
     * store and `sessions.binding(id)` resolves synchronously — draft hand-off
     * may write the new scope's machine before opening.
     * @param workspaceId - chosen Workspace (must be in the workspace list).
     * @returns the reused or newly created session id.
     */
    connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>;
    /**
     * Follow the first complete Workspace/Session baseline and select a default
     * session exactly once. A restored current session wins; otherwise the most
     * recent Workspace is connected (reusing or creating its blank session).
     * Later explicit clears stay cleared instead of retriggering this startup
     * policy. A failed connect may retry on the next baseline projection.
     * @returns disposer for the baseline subscription; late work cannot navigate after disposal.
     */
    startInitialSelection(): () => void;
    /**
     * The shared New Session action behind the shell entry points (sidebar
     * button, workspace browser): resolve the target Workspace — explicit wins,
     * then the current Session's Workspace, then the recent-Workspace
     * projection — connect its blank session and navigate there; with no
     * Workspace at all, clear the selection into the New Session view state.
     * Connect failures are non-fatal (console diagnostics; the current view
     * stays usable).
     * @param workspaceId - explicit target Workspace for scoped actions.
     */
    startSession(workspaceId?: WorkspaceId): void;
    /**
     * Register an existing path as a Workspace.
     * @param input - the Host create payload.
     * @returns the created or idempotently resolved Workspace.
     */
    create(input: {
        path: string;
    }): Promise<WorkspaceView>;
    /**
     * Open the Host's native directory picker (the `native` capability).
     * @returns the selected path, or null when the user cancelled.
     */
    pickDirectory(): Promise<string | null>;
    /**
     * List one directory level through the Host's `browse` capability.
     * @param path - absolute directory to list; absent lists the Host home directory.
     * @param signal - aborts the wire request (and the Host's scan) when the caller supersedes it.
     * @returns the level's listing with breadcrumb ancestry.
     */
    listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>;
    /**
     * Create one child directory through the Host's `browse` capability.
     * @param path - absolute existing parent directory.
     * @param name - single non-blank path segment.
     * @returns the created directory's absolute path.
     */
    createDirectory(path: string, name: string): Promise<string>;
    /**
     * Open a filesystem path with the Host operating system's default application.
     * @param path - absolute or host-resolvable path.
     */
    openPath(path: string): Promise<void>;
    /**
     * Rename a Workspace.
     * @param workspaceId - target workspace.
     * @param title - new display title (trimmed non-empty by the Host).
     * @returns the renamed Workspace view.
     */
    rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>;
    /**
     * Delete one Workspace registration. Sessions, session logs, and the
     * directory remain Host-owned outside this operation.
     * @param workspaceId - target workspace.
     */
    delete(workspaceId: WorkspaceId): Promise<void>;
    /**
     * Move a Workspace within the durable registry display order.
     * @param workspaceId - Workspace to move.
     * @param beforeWorkspaceId - Anchor workspace; omitted appends.
     */
    insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>;
    /**
     * Archive a session into the registry-global set. Clearing an archived
     * current selection is the projection sweep's job (one rule for the local
     * echo and a remote tab's frame alike).
     * @param sessionId - session to archive.
     */
    archiveSession(sessionId: SessionId): Promise<void>;
    /**
     * Move a session within its Workspace's manual order (DOM-insertBefore-like).
     * @param workspaceId - owning workspace.
     * @param sessionId - accounted session to move.
     * @param beforeSessionId - accounted anchor to insert before; omitted appends.
     * @returns the updated Workspace view.
     */
    insertSessionBefore(workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId): Promise<WorkspaceView>;
    /**
     * Refresh the workspace baseline, reusing an in-flight pull.
     * @returns completion of the current or newly started workspace baseline pull.
     */
    refresh(): Promise<void>;
    /**
     * Route a Host stream envelope into the Workspace object layer.
     * @param envelope - validated Host stream envelope.
     */
    handleHostEnvelope(envelope: Parameters<WorkspaceManager['handleHostEnvelope']>[0]): void;
    /** Rebuild the Workspace baseline after connection. */
    handleConnected(): void;
    private project;
}
//# sourceMappingURL=service.d.ts.map