//#region lib/types/invariant.js
/** Package-owned agent lifecycle invariants. @module @deepseek-ai/dsh-agent/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-agent";
/** Cordis companion plugin name. */
const name = "agent-invariant";
/** Services required before the companion can register. */
const inject = ["invariants"];
/** Install the agent contribution into its child registration fiber. */
const install = (ctx, fail) => {
	const lastStatus = /* @__PURE__ */ new WeakMap();
	ctx.on("agent/status", ({ agent, status }) => {
		if (lastStatus.get(agent) === status) fail(`agent/status repeated ${status} (no-op transition)`);
		lastStatus.set(agent, status);
	}, { global: true });
};
/**
* Register the agent invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
