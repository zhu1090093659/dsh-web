//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-primitives`.
* @module @deepseek-ai/dsh-client-ui-primitives/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-primitives";
/** Cordis companion plugin name. */
const name = "client-ui-primitives-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: pure props-in React atoms with no Cordis API —
* no events, no services, no mutable cross-plugin state; rendering contracts
* are asserted directly by this package's component specs.
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
