import "node:crypto";
import "node:fs/promises";
import "node:path";
import { Service } from "@deepseek-ai/cordis";
import { z } from "zod";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#endregion
//#region src/spec.ts
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
defineDomain({
	name: "workspace",
	version: 2,
	global: {
		schema: z.object({
			initialized: z.boolean(),
			workspaceIds: z.array(workspaceId),
			archivedSessionIds: z.array(z.string().transform(SessionId)).default([]),
			pendingMutation: workspacePendingMutation.optional()
		}),
		initial: {
			initialized: false,
			workspaceIds: [],
			archivedSessionIds: []
		}
	},
	tables: { workspaces: domainTable(workspaceRecord) }
});
//#endregion
//#region src/index.ts
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
Service.init;
//#endregion
//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-workspace`.
* @module @deepseek-ai/dsh-workspace/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-workspace";
/** Cordis companion plugin name. */
const name = "workspace-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* Owned relationship: the registry's entity cache mirrors the workspace
* domain's durable table. Every `domain/changed` for the `workspaces` table
* must name a record the cache already holds an entity for (the registry
* caches before the durable put and mutates only through cached entities).
* A delete is valid only after the registry has removed the entity from its
* cache, whether for create rollback or an explicit registration deletion;
* deleting while the cache still publishes the entity proves a bypass.
*/
const install = Object.assign((ctx, fail) => {
	ctx.on("domain/changed", (change) => {
		if (change.domain !== "workspace" || change.table !== "workspaces") return;
		if (change.operation === "deleted") {
			if (ctx.workspaceRegistry.get(WorkspaceId(change.key)) !== void 0) fail(`workspace record '${change.key}' was deleted while the registry cache still publishes it — some write path bypassed ctx.workspaceRegistry`);
			return;
		}
		if (ctx.workspaceRegistry.get(WorkspaceId(change.key)) === void 0) fail(`workspace record '${change.key}' landed durably but the registry cache holds no entity for it — the cache and the domain table have diverged`);
	});
}, { inject: ["workspaceRegistry"] });
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
