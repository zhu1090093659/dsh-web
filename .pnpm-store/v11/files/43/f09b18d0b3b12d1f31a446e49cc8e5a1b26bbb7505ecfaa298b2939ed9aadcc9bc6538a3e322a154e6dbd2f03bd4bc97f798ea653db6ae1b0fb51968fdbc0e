//#region lib/types/invariant.js
/** Package-owned invariant companion for the subprocess seam. @module @deepseek-ai/dsh-subprocess/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-subprocess";
/** Cordis companion plugin name. */
const name = "subprocess-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** No runtime invariant: this stateless Service Definition owns spawn-spec/handle types, while Service Providers own observations. */
const install = () => {};
/**
* Register the subprocess invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
