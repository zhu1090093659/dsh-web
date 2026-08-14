/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import type { WorkspaceRecord } from './spec.ts';
import type { Workspace, WorkspaceId } from './types.ts';
/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export declare class WorkspaceMoveInvalidError extends Error {
    /**
     * @param message - Which id was unaccounted and where.
     */
    constructor(message: string);
}
/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
    /**
     * Resolve the open `workspaces` table.
     * @returns the table; throws while the registry has not started yet.
     */
    table(): KvTable<WorkspaceId, WorkspaceRecord>;
    /**
     * Read a session's canonical directory from the registry's header index.
     * @param id - Session whose indexed path is requested.
     * @returns the canonical directory, or `undefined` when the header is
     * missing or its cwd cannot identify an existing directory.
     */
    sessionPath(id: SessionId): string | undefined;
    /**
     * Read one stored session header for attach validation.
     * @param id - The session whose header to read.
     * @returns the header; rejects when session persistence is absent or holds
     * no session with this id.
     */
    readSessionHeader(id: SessionId): Promise<SessionHeader>;
    /**
     * Publish a successfully validated canonical cwd to the projection index.
     * @param id - Validated session id.
     * @param path - Canonical existing directory from the immutable header cwd.
     */
    rememberSessionPath(id: SessionId, path: string): void;
}
/** The single {@link Workspace} implementation; constructed only by the registry. */
export declare class WorkspaceEntity implements Workspace {
    private readonly host;
    readonly id: WorkspaceId;
    private record;
    /**
     * @param host - Registry-owned table, session-path index, and header reads.
     * @param id - The record's stable id.
     * @param record - The validated record snapshot loaded or just written.
     */
    constructor(host: WorkspaceEntityHost, id: WorkspaceId, record: WorkspaceRecord);
    get path(): string;
    get title(): string;
    get createdAt(): string;
    get updatedAt(): string;
    get sessionIds(): readonly SessionId[];
    setTitle(title: string): Promise<void>;
    attachSession(sessionId: SessionId): Promise<void>;
    insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>;
    detachSession(sessionId: SessionId): Promise<void>;
    status(): Promise<'ok' | 'missing-dir'>;
    /**
     * The single write path: run `fn` on the domain write chain via
     * `table.update`, stamping `updatedAt` and pruning candidates that no
     * longer pass the id-plus-canonical-cwd membership check, then swap the
     * snapshot.
     *
     * `fn` sees the value current at its chain slot, so membership decisions
     * (attach/detach idempotence) are race-free against queued writes; a fn
     * signalling no change by returning `current` verbatim aborts the slot
     * through the sentinel when pruning also finds nothing, so a no-op neither
     * rewrites the medium nor emits a change event.
     */
    private mutate;
}
//# sourceMappingURL=entity.d.ts.map