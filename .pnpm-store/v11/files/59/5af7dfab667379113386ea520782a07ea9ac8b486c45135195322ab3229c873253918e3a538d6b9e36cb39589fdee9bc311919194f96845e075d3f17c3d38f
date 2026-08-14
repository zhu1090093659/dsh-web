/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */
import { stat } from 'node:fs/promises';
import { realpathNormalize } from "./paths.js";
/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
    /**
     * @param message - Which id was unaccounted and where.
     */
    constructor(message) {
        super(message);
        this.name = 'WorkspaceMoveInvalidError';
    }
}
/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)');
/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity {
    host;
    id;
    record;
    /**
     * @param host - Registry-owned table, session-path index, and header reads.
     * @param id - The record's stable id.
     * @param record - The validated record snapshot loaded or just written.
     */
    constructor(host, id, record) {
        this.host = host;
        this.id = id;
        this.record = record;
    }
    get path() {
        return this.record.path;
    }
    get title() {
        return this.record.title;
    }
    get createdAt() {
        return this.record.createdAt;
    }
    get updatedAt() {
        return this.record.updatedAt;
    }
    get sessionIds() {
        return this.record.sessionIds.filter(id => this.host.sessionPath(id) === this.record.path);
    }
    async setTitle(title) {
        await this.mutate(record => ({ ...record, title }));
    }
    async attachSession(sessionId) {
        // Validation is skipped when the settled snapshot already accounts the
        // id: the cwd fact was checked when it first attached and both inputs
        // (stored header cwd, workspace path) are immutable. Membership itself is
        // decided on the write chain inside `mutate`, never on this snapshot.
        if (!this.record.sessionIds.includes(sessionId)) {
            const header = await this.host.readSessionHeader(sessionId);
            if (header.cwd === undefined) {
                throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': `
                    + 'its stored header carries no cwd to validate against');
            }
            let cwd;
            try {
                cwd = await realpathNormalize(header.cwd);
            }
            catch (error) {
                throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': `
                    + `its cwd '${header.cwd}' does not resolve, so it cannot be validated`, { cause: error });
            }
            if (!(await stat(cwd)).isDirectory()) {
                throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': `
                    + `its cwd '${header.cwd}' is not a directory`);
            }
            if (cwd !== this.record.path) {
                throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': `
                    + `its cwd resolves to '${cwd}'`);
            }
            this.host.rememberSessionPath(sessionId, cwd);
        }
        await this.mutate(record => record.sessionIds.includes(sessionId)
            ? record
            : { ...record, sessionIds: [sessionId, ...record.sessionIds] });
    }
    async insertSessionBefore(sessionId, beforeSessionId) {
        await this.mutate((record) => {
            if (!record.sessionIds.includes(sessionId)) {
                throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`);
            }
            if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
                throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
                    + 'the anchor session is not accounted');
            }
            if (beforeSessionId === sessionId)
                return record;
            const without = record.sessionIds.filter(id => id !== sessionId);
            const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId);
            const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)];
            return sessionIds.every((id, index) => id === record.sessionIds[index])
                ? record
                : { ...record, sessionIds };
        });
    }
    async detachSession(sessionId) {
        await this.mutate(record => record.sessionIds.includes(sessionId)
            ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
            : record);
    }
    async status() {
        try {
            return (await stat(this.record.path)).isDirectory() ? 'ok' : 'missing-dir';
        }
        catch {
            // Any stat failure (ENOENT, dangling parent, permission loss) means the
            // directory is not usable right now; the record itself never mutates.
            return 'missing-dir';
        }
    }
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
    async mutate(fn) {
        let next;
        try {
            next = await this.host.table().update(this.id, (current) => {
                const changed = fn(current);
                const sessionIds = changed.sessionIds.filter(id => this.host.sessionPath(id) === changed.path);
                if (changed === current && sessionIds.length === current.sessionIds.length) {
                    throw unchangedSentinel;
                }
                return { ...changed, sessionIds, updatedAt: new Date().toISOString() };
            });
        }
        catch (error) {
            if (error === unchangedSentinel)
                return;
            throw error;
        }
        this.record = next;
    }
}
//# sourceMappingURL=entity.js.map