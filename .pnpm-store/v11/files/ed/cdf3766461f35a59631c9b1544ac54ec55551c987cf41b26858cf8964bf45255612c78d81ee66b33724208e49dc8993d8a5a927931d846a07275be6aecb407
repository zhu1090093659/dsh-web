//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-session-query`.
* @module @deepseek-ai/dsh-session-query/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-session-query";
/** Cordis companion plugin name. */
const name = "session-query-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: query results are immutable per-call projections whose lineage and event
* relations are validated while they are built; the service retains no observable result state.
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
