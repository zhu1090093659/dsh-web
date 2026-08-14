/** React-free Workspace entity with a client-local materialization lifecycle. */
import type { IApiClient, RpcResult, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client';
import type { ObservableSnapshot } from '../contract/store.ts';
/** Host input retained by a local Workspace until materialization succeeds. */
export type WorkspaceCreateInput = {
    path: string;
};
/** Observable state of a client-local Workspace intent. */
export interface WorkspaceIntentSnapshot {
    name: string;
    phase: 'ready' | 'creating';
    error?: string;
}
/** A Workspace is either a local intent or a materialized Host view. */
export interface WorkspaceSnapshot {
    view: WorkspaceView | undefined;
    intent: WorkspaceIntentSnapshot | undefined;
}
/**
 * Observable Workspace object whose identity survives Host materialization.
 * Local instances retain their create input and failure state; materialized
 * instances expose the latest Host view.
 */
export declare class Workspace implements ObservableSnapshot<WorkspaceSnapshot> {
    private readonly api;
    private view;
    private intent;
    private materialization;
    private snapshotCache;
    private readonly notifier;
    /**
     * @param api - shared wire client.
     * @param source - local create input or an existing Host Workspace view.
     */
    constructor(api: IApiClient, source: WorkspaceCreateInput | WorkspaceView);
    /**
     * Materialize this local Workspace through the Host create API.
     * Re-entry shares the in-flight completion; a materialized instance returns undefined.
     * @returns the Host result, or undefined when this Workspace is already materialized.
     */
    materialize(): Promise<RpcResult<{
        workspace: WorkspaceView;
        created: boolean;
    }>> | undefined;
    /**
     * Adopt a Host view without replacing this Workspace object.
     * An existing materialized identity accepts updates only for the same Workspace id.
     * @param view - latest Host projection.
     */
    adopt(view: WorkspaceView): void;
    /**
     * Subscribe to Workspace snapshot invalidation.
     * @param listener - snapshot invalidation callback.
     * @returns unsubscribe function.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Read the cached Workspace snapshot after flushing pending notifications.
     * @returns the cached Workspace snapshot.
     */
    getSnapshot(): WorkspaceSnapshot;
    private completeMaterialization;
    private buildSnapshot;
}
//# sourceMappingURL=workspace.d.ts.map