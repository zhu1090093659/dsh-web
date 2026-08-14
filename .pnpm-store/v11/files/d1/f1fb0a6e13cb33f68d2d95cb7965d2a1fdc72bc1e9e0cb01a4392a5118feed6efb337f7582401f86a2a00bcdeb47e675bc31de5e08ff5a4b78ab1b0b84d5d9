import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#region lib/types/paths.js
/**
* Path canonicalization for workspace identity.
* @module @deepseek-ai/dsh-workspace/src/paths
*/
/**
* Canonicalize a directory path via `fs.realpath`: trailing slashes, `..`
* segments, and symlinks are all resolved. This is the ONE uniqueness canon of
* the package — workspace paths are stored canonicalized, uniqueness is
* string equality of canonicalized paths (a symlink to an existing
* workspace's directory collides), and attach-time session `cwd` checks go
* through the same canon. A path that does not exist rejects with the
* original `ENOENT` — this is `create`'s reject path (a workspace must point
* at an existing directory).
* @param path - The path to canonicalize.
* @returns the canonical absolute path.
*/
async function realpathNormalize(path) {
	return await realpath(path);
}
//#endregion
//#region lib/types/entity.js
/**
* Package-private workspace entity: the single {@link Workspace}
* implementation. Holds a record snapshot that is swapped in place after each
* durable mutation; every write funnels through the private `mutate` so
* `updatedAt` stamping and invalid-account pruning happen exactly once.
* Not re-exported from the package entrypoint — consumers see only the
* `Workspace` interface.
* @module @deepseek-ai/dsh-workspace/src/entity
*/
/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
var WorkspaceMoveInvalidError = class extends Error {
	/**
	* @param message - Which id was unaccounted and where.
	*/
	constructor(message) {
		super(message);
		this.name = "WorkspaceMoveInvalidError";
	}
};
/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = /* @__PURE__ */ new Error("workspace record unchanged (internal sentinel)");
/** The single {@link Workspace} implementation; constructed only by the registry. */
var WorkspaceEntity = class {
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
		return this.record.sessionIds.filter((id) => this.host.sessionPath(id) === this.record.path);
	}
	async setTitle(title) {
		await this.mutate((record) => ({
			...record,
			title
		}));
	}
	async attachSession(sessionId) {
		if (!this.record.sessionIds.includes(sessionId)) {
			const header = await this.host.readSessionHeader(sessionId);
			if (header.cwd === void 0) throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its stored header carries no cwd to validate against`);
			let cwd;
			try {
				cwd = await realpathNormalize(header.cwd);
			} catch (error) {
				throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its cwd '${header.cwd}' does not resolve, so it cannot be validated`, { cause: error });
			}
			if (!(await stat(cwd)).isDirectory()) throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its cwd '${header.cwd}' is not a directory`);
			if (cwd !== this.record.path) throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its cwd resolves to '${cwd}'`);
			this.host.rememberSessionPath(sessionId, cwd);
		}
		await this.mutate((record) => record.sessionIds.includes(sessionId) ? record : {
			...record,
			sessionIds: [sessionId, ...record.sessionIds]
		});
	}
	async insertSessionBefore(sessionId, beforeSessionId) {
		await this.mutate((record) => {
			if (!record.sessionIds.includes(sessionId)) throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`);
			if (beforeSessionId !== void 0 && !record.sessionIds.includes(beforeSessionId)) throw new WorkspaceMoveInvalidError(`cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': the anchor session is not accounted`);
			if (beforeSessionId === sessionId) return record;
			const without = record.sessionIds.filter((id) => id !== sessionId);
			const at = beforeSessionId === void 0 ? without.length : without.indexOf(beforeSessionId);
			const sessionIds = [
				...without.slice(0, at),
				sessionId,
				...without.slice(at)
			];
			return sessionIds.every((id, index) => id === record.sessionIds[index]) ? record : {
				...record,
				sessionIds
			};
		});
	}
	async detachSession(sessionId) {
		await this.mutate((record) => record.sessionIds.includes(sessionId) ? {
			...record,
			sessionIds: record.sessionIds.filter((id) => id !== sessionId)
		} : record);
	}
	async status() {
		try {
			return (await stat(this.record.path)).isDirectory() ? "ok" : "missing-dir";
		} catch {
			return "missing-dir";
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
				const sessionIds = changed.sessionIds.filter((id) => this.host.sessionPath(id) === changed.path);
				if (changed === current && sessionIds.length === current.sessionIds.length) throw unchangedSentinel;
				return {
					...changed,
					sessionIds,
					updatedAt: (/* @__PURE__ */ new Date()).toISOString()
				};
			});
		} catch (error) {
			if (error === unchangedSentinel) return;
			throw error;
		}
		this.record = next;
	}
};
//#endregion
//#region lib/types/spec.js
/**
* The workspace domain declaration: record schema and the `defineDomain` spec
* the registry opens. The zod schema is the durable-boundary validator today
* and the direct source of the RPC wire projection in a later phase.
* @module @deepseek-ai/dsh-workspace/src/spec
*/
/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceId = z.string().transform((value) => value);
/**
* Durable shape of one workspace record. `path` is the `fs.realpath` canon
* stamped at create; `sessionIds` is the ordered ownership account (array
* order is display order); timestamps are ISO-8601 strings.
*/
const workspaceRecord = z.object({
	path: z.string(),
	title: z.string(),
	sessionIds: z.array(z.string().transform(SessionId)),
	createdAt: z.string(),
	updatedAt: z.string()
});
/**
* Recoverable two-write mutation marker. The marker is persisted before the
* record/order pair can diverge, so startup can distinguish an interrupted
* registry operation from unexplained medium corruption.
*/
const workspacePendingMutation = z.discriminatedUnion("operation", [z.object({
	operation: z.literal("create"),
	workspaceId
}), z.object({
	operation: z.literal("delete"),
	workspaceId
})]);
/**
* Durable registry state. `initialized` distinguishes a valid empty registry
* from one that still needs the header-only history bootstrap;
* `workspaceIds` is the authoritative display order. `archivedSessionIds` is
* the registry-global archive set layered over workspace accounting: an
* archived session keeps its `sessionIds` slot (unarchiving must restore the
* position), so the set never participates in the one-owner accounting
* invariant. Defaulted so records written before the field parse unchanged.
*/
const workspaceDomainState = z.object({
	initialized: z.boolean(),
	workspaceIds: z.array(workspaceId),
	archivedSessionIds: z.array(z.string().transform(SessionId)).default([]),
	pendingMutation: workspacePendingMutation.optional()
});
/**
* The workspace domain spec: one `workspaces` table keyed by
* {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
* this through `ctx.storage.domain`; the spec object is the single source of
* the domain's identity, version, and schemas.
*/
const workspaceDomainSpec = defineDomain({
	name: "workspace",
	version: 2,
	global: {
		schema: workspaceDomainState,
		initial: {
			initialized: false,
			workspaceIds: [],
			archivedSessionIds: []
		}
	},
	tables: { workspaces: domainTable(workspaceRecord) }
});
//#endregion
//#region lib/types/index.js
/**
* Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
* stable registry order, and header-validated session membership over the
* domain data form.
* @module @deepseek-ai/dsh-workspace
*/
/**
* Brand a string as a {@link WorkspaceId}.
* @param id - Raw workspace id string.
* @returns the same string, branded at compile time.
*/
function WorkspaceId(id) {
	return id;
}
/**
* An archiveSession request named a session neither live nor in session
* persistence — a definite miss only; storage faults propagate as themselves.
*/
var WorkspaceUnknownSessionError = class extends Error {
	sessionId;
	/**
	* @param sessionId - The unknown session id.
	*/
	constructor(sessionId) {
		super(`cannot archive session '${sessionId}': live sessions and session persistence hold no such session`);
		this.sessionId = sessionId;
		this.name = "WorkspaceUnknownSessionError";
	}
};
/** A workspace reorder named a source or anchor absent from the durable registry order. */
var WorkspaceOrderInvalidError = class extends Error {
	workspaceId;
	/**
	* @param workspaceId - Missing source or anchor id.
	*/
	constructor(workspaceId) {
		super(`cannot reorder unknown workspace '${workspaceId}'`);
		this.workspaceId = workspaceId;
		this.name = "WorkspaceOrderInvalidError";
	}
};
const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
const compareHeaders = (left, right) => right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id));
/**
* Durable workspace registry. Startup waits for `sessionPersistence`, builds
* one canonical-cwd header index, and completes the one-time history
* bootstrap before the service becomes active. The persistence dependency is
* mandatory so an unavailable peer can never be mistaken for an empty
* history and commit the initialized marker.
*/
var WorkspaceRegistry = class extends Service {
	static inject = ["storageDomain", "sessionPersistence"];
	table;
	global;
	state;
	entities = /* @__PURE__ */ new Map();
	headers = /* @__PURE__ */ new Map();
	sessionPaths = /* @__PURE__ */ new Map();
	invalidSessionPaths = /* @__PURE__ */ new Map();
	operationTail = Promise.resolve();
	host = {
		table: () => this.requireTable(),
		sessionPath: (id) => this.sessionPaths.get(id),
		readSessionHeader: (id) => this.readSessionHeader(id),
		rememberSessionPath: (id, path) => {
			this.sessionPaths.set(id, path);
			this.invalidSessionPaths.delete(id);
		}
	};
	constructor(ctx) {
		super(ctx, "workspaceRegistry");
	}
	/** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(workspaceDomainSpec);
		this.ctx.effect(() => () => domain.close(), "workspace.domainClose");
		this.table = domain.table("workspaces");
		this.global = domain.global;
		this.state = domain.global.get();
		await this.recoverPendingMutation();
		this.validateStoredState(this.state);
		if (!this.state.initialized) {
			const headers = await this.ctx.sessionPersistence.list();
			await this.replaceHeaderIndex(headers);
			await this.bootstrap(headers);
		} else if (this.table.size > 0) await this.replaceHeaderIndex(await this.ctx.sessionPersistence.list());
		await this.indexLiveSessions();
		this.validateStoredState(this.requireState());
		this.rebuildEntities();
		this.reportFilteredCandidates();
	}
	/**
	* Create or reuse a workspace for an existing directory. The path is
	* canonicalized through `fs.realpath`; a nonexistent path rejects with the
	* original error and a non-directory rejects. Repeated calls for the same
	* canonical path return the existing entity without changing its title.
	* A newly created workspace is prepended to the durable registry order.
	* Different canonical paths may share a display title.
	* @param path - Existing directory to own, in any path spelling.
	* @param title - Display title used only when a new record is created.
	* @returns the existing or newly durable workspace.
	*/
	async create(path, title) {
		const canonical = await realpathNormalize(path);
		if (!(await stat(canonical)).isDirectory()) throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`);
		return await this.enqueueOperation(() => this.createCanonical(canonical, title));
	}
	/**
	* Look up a workspace by id.
	* @param id - Workspace id.
	* @returns the workspace, or `undefined` when unknown.
	*/
	get(id) {
		return this.entities.get(id);
	}
	/**
	* Synchronous workspace projection in durable registry order. Every
	* entity's `sessionIds` getter is already filtered by the startup/live
	* canonical-cwd header index; this method performs no persistence reads.
	* @returns a fresh ordered array of workspace entities.
	*/
	list() {
		return this.requireState().workspaceIds.map((id) => {
			const entity = this.entities.get(id);
			if (entity === void 0) throw new Error(`workspace registry order references missing workspace '${id}'`);
			return entity;
		});
	}
	/**
	* Delete one workspace registration while retaining its directory and every
	* session log. The durable order is updated before the table deletion; a
	* failed table write restores the prior order and keeps the entity
	* published. Unknown ids are an idempotent no-op for domain callers.
	* @param id - Workspace registration to remove.
	* @returns `true` when a record was deleted, `false` when it was unknown.
	*/
	delete(id) {
		return this.enqueueOperation(() => this.deleteKnown(id));
	}
	/**
	* Move one workspace within the durable display order, DOM-insertBefore-like.
	* With an anchor it lands before that workspace; without one it appends.
	* @param id - Workspace to move.
	* @param beforeId - Workspace anchor; omitted appends.
	* @returns the complete committed workspace order.
	*/
	insertBefore(id, beforeId) {
		return this.enqueueOperation(async () => {
			const state = this.requireState();
			if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id);
			if (beforeId !== void 0 && !state.workspaceIds.includes(beforeId)) throw new WorkspaceOrderInvalidError(beforeId);
			if (beforeId === id) return state.workspaceIds;
			const without = state.workspaceIds.filter((workspaceId) => workspaceId !== id);
			const at = beforeId === void 0 ? without.length : without.indexOf(beforeId);
			const workspaceIds = [
				...without.slice(0, at),
				id,
				...without.slice(at)
			];
			if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds;
			await this.setState({
				...state,
				workspaceIds
			});
			return workspaceIds;
		});
	}
	/**
	* The registry-global archive set: sessions hidden from every grouping
	* surface. Archiving never touches workspace accounting — an archived
	* session keeps its `sessionIds` slot so unarchiving restores its position.
	* @returns the archived session ids in archive order.
	*/
	get archivedSessionIds() {
		return this.requireState().archivedSessionIds;
	}
	/**
	* Archive one session durably. The session must exist (live or in session
	* persistence); its workspace accounting — or lack of one — is irrelevant.
	* An already archived id resolves without writing.
	* @param sessionId - The session to archive.
	* @returns resolution after durability.
	*/
	archiveSession(sessionId) {
		return this.enqueueOperation(async () => {
			if (this.requireState().archivedSessionIds.includes(sessionId)) return;
			if (!await this.sessionKnown(sessionId)) throw new WorkspaceUnknownSessionError(sessionId);
			const state = this.requireState();
			await this.setState({
				...state,
				archivedSessionIds: [...state.archivedSessionIds, sessionId]
			});
		});
	}
	/**
	* Whether a session is live, header-indexed, or present in a fresh
	* persistence listing. Only a definite miss returns false — a failing
	* `sessionPersistence.list()` propagates so storage faults never
	* masquerade as an unknown session.
	*/
	async sessionKnown(id) {
		if (this.ctx.get("sessions")?.get(id) !== void 0) return true;
		if (this.headers.has(id)) return true;
		await this.indexHeaders(await this.ctx.sessionPersistence.list());
		return this.headers.has(id);
	}
	/**
	* Resolve by canonical directory path without creating or mutating a
	* workspace. A missing path rejects during `realpath`; an existing unowned
	* directory returns `undefined`.
	* @param path - Existing directory path in any spelling.
	* @returns the workspace owning the canonical path, when one exists.
	*/
	async resolveByPath(path) {
		const canonical = await realpathNormalize(path);
		for (const entity of this.entities.values()) if (entity.path === canonical) return entity;
	}
	async createCanonical(canonical, title) {
		for (const entity of this.entities.values()) if (entity.path === canonical) return entity;
		const workspaceName = title ?? basename(canonical);
		const table = this.requireTable();
		const state = this.requireState();
		const id = WorkspaceId(randomUUID());
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const record = {
			path: canonical,
			title: workspaceName,
			sessionIds: [],
			createdAt: now,
			updatedAt: now
		};
		const entity = new WorkspaceEntity(this.host, id, record);
		this.entities.set(id, entity);
		const pendingState = {
			...state,
			pendingMutation: {
				operation: "create",
				workspaceId: id
			}
		};
		try {
			await this.setState(pendingState);
		} catch (error) {
			this.entities.delete(id);
			throw error;
		}
		try {
			await table.put(id, record);
		} catch (error) {
			this.entities.delete(id);
			try {
				await this.setState(state);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `workspace '${id}' record write and pending-marker rollback both failed`);
			}
			throw error;
		}
		try {
			await this.setState({
				initialized: true,
				workspaceIds: [id, ...state.workspaceIds],
				archivedSessionIds: state.archivedSessionIds
			});
		} catch (error) {
			this.entities.delete(id);
			try {
				await table.delete(id);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`);
			}
			try {
				await this.setState(state);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], `workspace '${id}' order write and pending-marker rollback both failed`);
			}
			throw error;
		}
		return entity;
	}
	async deleteKnown(id) {
		const entity = this.entities.get(id);
		if (entity === void 0) return false;
		const state = this.requireState();
		const nextState = {
			initialized: true,
			workspaceIds: state.workspaceIds.filter((workspaceId) => workspaceId !== id),
			archivedSessionIds: state.archivedSessionIds
		};
		await this.setState({
			...nextState,
			pendingMutation: {
				operation: "delete",
				workspaceId: id
			}
		});
		this.entities.delete(id);
		try {
			await this.requireTable().delete(id);
		} catch (error) {
			this.entities.set(id, entity);
			try {
				await this.setState(state);
			} catch (rollbackError) {
				this.entities.delete(id);
				throw new AggregateError([error, rollbackError], `workspace '${id}' record deletion and registry-order rollback both failed`);
			}
			throw error;
		}
		try {
			await this.setState(nextState);
		} catch (error) {
			this.ctx.logger.warn(`workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`);
		}
		return true;
	}
	/**
	* Complete the one mutation explicitly named by durable state. Unexplained
	* order/table divergence still reaches {@link validateStoredState} and
	* fails loud; this path never guesses which operation created a row from its shape alone.
	*/
	async recoverPendingMutation() {
		const state = this.requireState();
		const pending = state.pendingMutation;
		if (pending === void 0) return;
		if (state.workspaceIds.includes(pending.workspaceId)) throw new Error(`workspace domain is inconsistent: pending ${pending.operation} workspace '${pending.workspaceId}' is still present in registry order`);
		await this.requireTable().delete(pending.workspaceId);
		await this.setState({
			initialized: state.initialized,
			workspaceIds: state.workspaceIds,
			archivedSessionIds: state.archivedSessionIds
		});
	}
	async bootstrap(headers) {
		const table = this.requireTable();
		const state = this.requireState();
		const groupsByPath = /* @__PURE__ */ new Map();
		for (const header of headers) {
			const path = this.sessionPaths.get(header.id);
			if (path === void 0) continue;
			const group = groupsByPath.get(path);
			if (group === void 0) groupsByPath.set(path, [header]);
			else group.push(header);
		}
		const groups = [...groupsByPath].map(([path, groupHeaders]) => {
			groupHeaders.sort(compareHeaders);
			return {
				path,
				headers: groupHeaders,
				newestAt: groupHeaders[0].createdAt
			};
		}).sort((left, right) => right.newestAt - left.newestAt || left.path.localeCompare(right.path));
		const byPath = /* @__PURE__ */ new Map();
		const accounted = /* @__PURE__ */ new Map();
		for (const [id, record] of table.entries()) {
			byPath.set(record.path, id);
			for (const sessionId of record.sessionIds) accounted.set(sessionId, id);
		}
		for (const group of groups) {
			let id = byPath.get(group.path);
			if (id === void 0) {
				const sessionIds = group.headers.map((header) => header.id).filter((sessionId) => !accounted.has(sessionId));
				if (sessionIds.length === 0) continue;
				id = WorkspaceId(randomUUID());
				const createdAt = new Date(group.newestAt).toISOString();
				const record = {
					path: group.path,
					title: basename(group.path),
					sessionIds,
					createdAt,
					updatedAt: createdAt
				};
				await table.put(id, record);
				byPath.set(group.path, id);
				for (const sessionId of sessionIds) accounted.set(sessionId, id);
				continue;
			}
			const current = table.get(id);
			const historical = group.headers.map((header) => header.id).filter((sessionId) => accounted.get(sessionId) === void 0 || accounted.get(sessionId) === id);
			const historicalSet = new Set(historical);
			const sessionIds = [...historical, ...current.sessionIds.filter((sessionId) => !historicalSet.has(sessionId))];
			if (sameSessionIds(current.sessionIds, sessionIds)) continue;
			await table.update(id, (record) => ({
				...record,
				sessionIds,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			}));
			for (const sessionId of historical) accounted.set(sessionId, id);
		}
		const groupRank = new Map(groups.map((group) => [group.path, group.newestAt]));
		const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]));
		const workspaceIds = [...table.entries()].sort(([leftId, left], [rightId, right]) => {
			const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt);
			return (groupRank.get(right.path) ?? Date.parse(right.createdAt)) - leftTime || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER) || String(leftId).localeCompare(String(rightId));
		}).map(([id]) => id);
		if (!sameIds(state.workspaceIds, workspaceIds)) await this.setState({
			initialized: false,
			workspaceIds,
			archivedSessionIds: state.archivedSessionIds
		});
		await this.setState({
			initialized: true,
			workspaceIds,
			archivedSessionIds: state.archivedSessionIds
		});
	}
	validateStoredState(state) {
		const table = this.requireTable();
		const order = /* @__PURE__ */ new Set();
		for (const id of state.workspaceIds) {
			if (order.has(id)) throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`);
			if (table.get(id) === void 0) throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`);
			order.add(id);
		}
		if (state.initialized && order.size !== table.size) {
			const orphan = [...table.keys()].find((id) => !order.has(id));
			throw new Error(`workspace domain is inconsistent: workspace '${orphan}' is absent from registry order`);
		}
		const paths = /* @__PURE__ */ new Map();
		const accounted = /* @__PURE__ */ new Map();
		for (const [id, record] of table.entries()) {
			const pathHolder = paths.get(record.path);
			if (pathHolder !== void 0) throw new Error(`workspace domain is inconsistent: path '${record.path}' is claimed by both workspace '${pathHolder}' and workspace '${id}'`);
			paths.set(record.path, id);
			for (const sessionId of record.sessionIds) {
				const holder = accounted.get(sessionId);
				if (holder !== void 0) throw new Error(`workspace domain is inconsistent: session '${sessionId}' is accounted by both workspace '${holder}' and workspace '${id}'`);
				accounted.set(sessionId, id);
			}
		}
	}
	rebuildEntities() {
		this.entities.clear();
		for (const id of this.requireState().workspaceIds) {
			const record = this.requireTable().get(id);
			this.entities.set(id, new WorkspaceEntity(this.host, id, record));
		}
	}
	async replaceHeaderIndex(headers) {
		this.headers.clear();
		this.sessionPaths.clear();
		this.invalidSessionPaths.clear();
		await this.indexHeaders(headers);
	}
	async indexHeaders(headers) {
		for (const header of headers) await this.indexHeader(header);
	}
	async indexHeader(header) {
		this.headers.set(header.id, header);
		this.sessionPaths.delete(header.id);
		if (header.cwd === void 0) {
			this.invalidSessionPaths.set(header.id, "header has no cwd");
			return;
		}
		try {
			const path = await realpathNormalize(header.cwd);
			if (!(await stat(path)).isDirectory()) {
				this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`);
				return;
			}
			this.sessionPaths.set(header.id, path);
			this.invalidSessionPaths.delete(header.id);
		} catch {
			this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`);
		}
	}
	async indexLiveSessions() {
		const sessions = this.ctx.get("sessions");
		if (sessions === void 0) return;
		await this.indexHeaders(sessions.list().map((session) => session.header));
	}
	reportFilteredCandidates() {
		for (const entity of this.entities.values()) {
			const record = this.requireTable().get(entity.id);
			for (const sessionId of record.sessionIds) {
				const path = this.sessionPaths.get(sessionId);
				if (path === record.path) continue;
				const reason = this.invalidSessionPaths.get(sessionId) ?? (this.headers.has(sessionId) ? `canonical cwd '${path}' differs from workspace path '${record.path}'` : "session header is missing");
				this.ctx.logger.warn(`workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`);
			}
		}
	}
	async readSessionHeader(id) {
		const live = this.ctx.get("sessions")?.get(id);
		if (live !== void 0) {
			this.headers.set(id, live.header);
			return live.header;
		}
		const cached = this.headers.get(id);
		if (cached !== void 0) return cached;
		const headers = await this.ctx.sessionPersistence.list();
		await this.indexHeaders(headers);
		const header = this.headers.get(id);
		if (header === void 0) throw new Error(`cannot validate session '${id}': session persistence holds no such session`);
		return header;
	}
	requireTable() {
		if (this.table === void 0) throw new Error("workspace registry is not started yet");
		return this.table;
	}
	requireState() {
		if (this.state === void 0) throw new Error("workspace registry is not started yet");
		return this.state;
	}
	async setState(state) {
		await this.global.set(state);
		this.state = state;
	}
	enqueueOperation(operation) {
		const result = this.operationTail.then(async () => {
			await this.recoverPendingMutation();
			return await operation();
		});
		this.operationTail = result.then(() => {}, () => {});
		return result;
	}
};
const sameSessionIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
//#endregion
export { WorkspaceId, WorkspaceMoveInvalidError, WorkspaceOrderInvalidError, WorkspaceRegistry, WorkspaceRegistry as default, WorkspaceUnknownSessionError, realpathNormalize, workspaceDomainSpec, workspaceDomainState, workspaceRecord };
