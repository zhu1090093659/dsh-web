import { TypertLookupFailure } from "@deepseek-ai/dsh-typert-protocol";
//#region lib/types/remote-events.js
/**
* The one home of this application's forwarded-Host-event allowlist. Both
* compiler faces list this file, so the Host forwarding loop and the consumer
* `ctx.remote.$on` key face read one declaration instead of two copies that
* could drift; `./types.ts` derives the type projection from it and stays
* type-only.
*/
/**
* Host events this application forwards to consumers verbatim: no projection,
* no redaction, no renaming. The wire name is the Host cordis event name and
* the payload is its argument list, so this array is simultaneously the whole
* control point over what a consumer can receive and the legal key set of
* `ctx.remote.$on`. Forwarding one more event is an entry here and nothing
* else.
*/
const API_REMOTE_FORWARDED_EVENTS = [
	"agent-preset/selected",
	"commands/change",
	"credentials/updated",
	"cordis/request-run",
	"cordis/request-run-resolved",
	"cordis/dynamic-package",
	"cordis/dynamic-retract",
	"cordis/inspect-query",
	"cordis/inspect-query-resolved",
	"llm/adapters-updated",
	"settings/document-updated"
];
//#endregion
//#region lib/types/agent-lookup.js
/** Host BFF policy for resolving Remote Agent and Session identities. */
/** Cold identity absent from the durable session store. */
var ApiRemoteSessionNotFound = class extends Error {};
/** Session identity whose lifecycle belongs to subagent routing. */
var ApiRemoteSubagentSessionOwnership = class extends Error {
	sessionId;
	/**
	* Construct the ownership fence.
	* @param sessionId - identity reserved to subagent routing.
	*/
	constructor(sessionId) {
		super(`session "${sessionId}" is a subagent session; use subagent delivery`);
		this.sessionId = sessionId;
	}
};
/**
* Test whether generic Host routing must leave an identity to subagent routing.
* @param ctx - Host Context carrying the live Agent registry.
* @param session - attached or live Session metadata.
* @param agent - live Agent when one is registered.
* @returns whether generic Remote and legacy API calls must reject the identity.
*/
function hasApiRemoteSubagentOwner(ctx, session, agent) {
	if (session.header.origin === "subagent") return true;
	const parentId = session.header.parentSession;
	if (parentId === void 0 || agent === void 0) return false;
	const parent = ctx.agents.get(parentId);
	return parent !== void 0 && ctx.agents.isOwnedBy(agent.id, parent);
}
/**
* Build the stable caller-facing ownership rejection.
* @param sessionId - identity reserved to subagent routing.
* @returns the existing `agent-busy` RPC shape.
*/
function apiRemoteSubagentOwnershipError(sessionId) {
	return {
		code: "agent-busy",
		message: `session "${sessionId}" is owned by subagent routing`,
		details: { reason: "use subagent delivery for this child session" }
	};
}
/**
* Inspect one cold served session without repairing, resuming, or publishing it.
* @param ctx - Host Context carrying the optional persistence provider.
* @param sessionId - durable identity to inspect.
* @returns detached metadata and events for a servable session.
* @throws {@link ApiRemoteSessionNotFound} when the identity has no project-backed session.
*/
async function inspectApiRemoteSession(ctx, sessionId) {
	const persistence = ctx.get("sessionPersistence");
	if (persistence === void 0) throw new Error("session persistence is not configured (load a dsh-session-persistence backend)");
	const meta = (await persistence.list()).find((candidate) => candidate.id === sessionId);
	if (meta === void 0 || meta.cwd === void 0) throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`);
	const inspected = await persistence.inspect(sessionId);
	if (inspected.meta.cwd === void 0) throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`);
	return {
		meta: inspected.meta,
		events: [...inspected.events]
	};
}
/**
* Create the Host's shared Agent resolver and configure Agent/Session Typert lookups.
* Live Agents are reused, ordinary cold sessions resume once per identity, and
* subagent-owned identities retain the legacy `agent-busy` fence.
* @param ctx - owning Host Context.
* @param options - defaults and Agent-scope setup used only for cold resume.
* @returns resolver shared by legacy API Proxy methods and Typert lookups.
*/
function createApiRemoteAgentResolver(ctx, options) {
	const resumes = /* @__PURE__ */ new Map();
	const fencedLiveAgent = (sessionId) => {
		const live = ctx.agents.get(sessionId);
		if (live === void 0) return void 0;
		if (hasApiRemoteSubagentOwner(ctx, live.session, live)) return { error: apiRemoteSubagentOwnershipError(sessionId) };
		return { agent: live };
	};
	const agentFor = async (sessionId) => {
		const fenced = fencedLiveAgent(sessionId);
		if (fenced !== void 0) return fenced;
		const attached = ctx.sessions.get(sessionId);
		if (attached !== void 0 && hasApiRemoteSubagentOwner(ctx, attached, void 0)) return { error: apiRemoteSubagentOwnershipError(sessionId) };
		let resume = resumes.get(sessionId);
		if (resume === void 0) {
			resume = (async () => {
				try {
					const inspected = await inspectApiRemoteSession(ctx, sessionId);
					if (hasApiRemoteSubagentOwner(ctx, { header: inspected.meta }, void 0)) throw new ApiRemoteSubagentSessionOwnership(sessionId);
					const setup = options.setup === void 0 ? void 0 : await options.setup(inspected);
					const publishedSession = ctx.sessions.get(sessionId);
					const publishedAgent = ctx.agents.get(sessionId);
					if (publishedSession !== void 0 && hasApiRemoteSubagentOwner(ctx, publishedSession, publishedAgent)) throw new ApiRemoteSubagentSessionOwnership(sessionId);
					return (await ctx.agents.resume({
						resumeSessionId: sessionId,
						...options.agentOptions === void 0 ? {} : { agentOptions: options.agentOptions() },
						...setup === void 0 ? {} : { setup }
					})).agent;
				} finally {
					resumes.delete(sessionId);
				}
			})();
			resumes.set(sessionId, resume);
		}
		try {
			return { agent: await resume };
		} catch (error) {
			if (error instanceof ApiRemoteSessionNotFound) return { error: {
				code: "session-not-found",
				message: error.message,
				details: { sessionId }
			} };
			if (error instanceof ApiRemoteSubagentSessionOwnership) return { error: apiRemoteSubagentOwnershipError(error.sessionId) };
			const fenced = fencedLiveAgent(sessionId);
			if (fenced !== void 0) return fenced;
			const attached = ctx.sessions.get(sessionId);
			if (attached !== void 0 && hasApiRemoteSubagentOwner(ctx, attached, void 0)) return { error: apiRemoteSubagentOwnershipError(sessionId) };
			return { error: {
				code: "internal",
				message: `resume failed for session "${sessionId}": ${String(error)}`,
				details: {}
			} };
		}
	};
	ctx.inject(["typert"], (typeCtx) => {
		const resolveAgent = async (sessionId) => {
			const found = await agentFor(sessionId);
			if ("error" in found) throw new TypertLookupFailure(found.error);
			return found.agent;
		};
		typeCtx.typert.lookups.configure("agent", resolveAgent);
		typeCtx.typert.lookups.configure("session", async (sessionId) => (await resolveAgent(sessionId)).session);
		typeCtx.typert.contexts.configureHost("agent", async (sessionId) => (await resolveAgent(sessionId)).ctx);
	});
	return agentFor;
}
//#endregion
//#region lib/types/index.js
/** Host plugin body; the selected contributions mount only in Client environments. */
function apply() {}
//#endregion
export { API_REMOTE_FORWARDED_EVENTS, ApiRemoteSessionNotFound, ApiRemoteSubagentSessionOwnership, apiRemoteSubagentOwnershipError, apply, createApiRemoteAgentResolver, hasApiRemoteSubagentOwner, inspectApiRemoteSession };
