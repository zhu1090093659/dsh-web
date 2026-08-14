//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-user-questions`.
* @module @deepseek-ai/dsh-user-questions/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-user-questions";
/** Cordis companion plugin name. */
const name = "user-questions-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the single provider slot is validated at registration and asks return
* directly to their caller; the seam publishes no independent request/answer audit stream.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
