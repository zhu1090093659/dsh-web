//#region lib/types/invariant.js
/** Package-owned invariant companion for the directory-picker seam. @module @deepseek-ai/dsh-host-directory-picker/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-host-directory-picker";
/** Cordis companion plugin name. */
const name = "host-directory-picker-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: this stateless Service Definition owns the capability
* vocabulary, while backends and the RPC consumer own observations.
*/
const install = () => {};
/**
* Register the directory-picker invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
