//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-invariants`.
* @module @deepseek-ai/dsh-invariants/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-invariants";
/** Cordis companion plugin name. */
const name = "invariants-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: registration ownership and child lifecycle are the service's mutation
* boundary itself; observing them from the same registry would only duplicate its implementation.
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
