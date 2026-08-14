import { carrierKeyOf, isScopeCarrier } from "@deepseek-ai/dsh-scope";
//#region lib/types/scoped-events.generated.js
/**
* Generated scoped-event routing-subject resolvers for dsh-scope invariants.
* Do not edit by hand; run `pnpm run gen-scoped-events`.
*
* @module @deepseek-ai/dsh-scope/scoped-events.generated
*/
const scopedSubjectResolvers = Object.freeze({
	"agent/created": (args) => args[0]["agent"],
	"agent/disposed": (args) => args[0]["agent"],
	"agent/error": (args) => args[0]["agent"],
	"agent/inbox/claimed": (args) => args[0]["agent"],
	"agent/inbox/discarded": (args) => args[0]["agent"],
	"agent/inbox/inserted": (args) => args[0]["agent"],
	"agent/pre-step": (args) => args[0]["agent"],
	"agent/request": (args) => args[0]["agent"],
	"agent/request-error": (args) => args[0]["agent"],
	"agent/session-start": (args) => args[0]["agent"],
	"agent/status": (args) => args[0]["agent"],
	"agent/turn-stopping": (args) => args[0]["agent"],
	"approval/request": (args) => args[0]["agent"],
	"goal/changed": (args) => args[0]["agent"],
	"session/created": null,
	"session/disposed": null,
	"session/event": null,
	"session/flush": null,
	"subagent/end": null,
	"subagent/start": null,
	"system-prompt/assemble": (args) => args[1]["scope"],
	"tools/code-dispatch-log": (args) => args[0]["agent"],
	"tools/execute": (args) => args[0]["agent"],
	"tools/post-execute": (args) => args[0]["agent"],
	"tools/pre-execute": (args) => args[0]["agent"],
	"tools/result": (args) => args[0]["agent"]
});
/**
* Resolve the routing key named by one scoped event payload. A null
* resolver means the payload cannot expose its external routing key, so the
* invariant checks carrier presence only.
* @param event - runtime Cordis event name.
* @returns the generated subject resolver, null for presence-only,
*   or undefined when the event is not scope-filtered.
*/
function scopedSubjectResolverFor(event) {
	return scopedSubjectResolvers[event];
}
//#endregion
//#region lib/types/invariant.js
/** Package-owned scoped-dispatch invariants. @module @deepseek-ai/dsh-scope/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-scope";
/** Cordis companion plugin name. */
const name = "scope-invariant";
/** Services required before the companion can register. */
const inject = ["invariants"];
/** Install the scoped-dispatch contribution into its child registration fiber. */
const install = (ctx, fail) => {
	ctx.on("internal/dispatch", (_mode, eventName, args, thisArg) => {
		const subjectOf = scopedSubjectResolverFor(eventName);
		if (subjectOf === void 0) return;
		if (!isScopeCarrier(thisArg)) fail(`"${eventName}" is a scope-filtered event but was dispatched without a scope carrier — pass scopeTarget(base, subject) as the dispatch thisArg (agent events: use agentEvents(ctx, agent))`);
		if (subjectOf !== null && carrierKeyOf(thisArg) !== subjectOf(args)) fail(`"${eventName}" was dispatched with a scope carrier keyed to a DIFFERENT subject than its arguments name — the carrier key and the event's subject must be the same object (use agentEvents(ctx, agent))`);
	}, { global: true });
};
/**
* Register the scope invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
