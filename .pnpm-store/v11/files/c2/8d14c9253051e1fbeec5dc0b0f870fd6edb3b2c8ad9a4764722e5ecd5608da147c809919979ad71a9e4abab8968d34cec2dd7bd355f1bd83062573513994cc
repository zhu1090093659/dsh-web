//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-typert-protocol`.
* @module @deepseek-ai/dsh-typert-protocol/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-typert-protocol";
/** Cordis companion plugin name. */
const name = "typert-protocol-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: decorators retain private immutable declarations and
* bindings are frozen values with no independent event stream to cross-check.
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
