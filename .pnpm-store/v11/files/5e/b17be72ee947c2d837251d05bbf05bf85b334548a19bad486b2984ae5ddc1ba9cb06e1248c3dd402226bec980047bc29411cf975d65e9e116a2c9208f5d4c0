//#region lib/types/invariant.js
/** Package-owned invariant companion for `@deepseek-ai/dsh-api-remotes`. */
const PACKAGE_NAME = "@deepseek-ai/dsh-api-remotes";
/** Cordis companion plugin name. */
const name = "api-remotes-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** No runtime invariant: Typert and the Agent/Session registries own the observed relationships. */
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
