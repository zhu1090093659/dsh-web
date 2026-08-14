//#region lib/types/invariant.js
/** Package-owned invariant companion for `@deepseek-ai/dsh-attachment`. @module @deepseek-ai/dsh-attachment/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-attachment";
/** Cordis companion plugin name. */
const name = "attachment-invariant";
/** Service required before package ownership can be reserved. */
const inject = ["invariants"];
/** No runtime invariant: this stateless seam owns types while implementations enforce immutable-store checks. */
const install = () => {};
/**
* Register the package invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the registration disposer.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
