//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-credentials`.
* @module @deepseek-ai/dsh-credentials/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-credentials";
/** Cordis companion plugin name. */
const name = "credentials-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* Install the commit-event lifecycle contract: `credentials/updated` names a
* committed provider-source change, so it can only fire while a credentials
* service is live — an emission after disposal means a provider leaked work
* past its teardown quiescence. The value relation itself (`describe`
* agreeing with `resolve`) is asynchronous provider I/O and stays pinned by
* each provider's own suite.
*/
const install = (ctx, fail) => {
	ctx.on("credentials/updated", (ref) => {
		if (ctx.get("credentials") === void 0) fail(`credentials/updated for "${ref}" emitted without a live credentials service`);
	});
};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
