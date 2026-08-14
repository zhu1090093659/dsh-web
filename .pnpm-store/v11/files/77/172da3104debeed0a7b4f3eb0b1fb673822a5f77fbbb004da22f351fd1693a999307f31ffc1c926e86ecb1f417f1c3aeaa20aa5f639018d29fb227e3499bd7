//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-session-projection-cache`.
* @module @deepseek-ai/dsh-session-projection-cache/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-session-projection-cache";
/** Cordis companion plugin name. */
const name = "session-projection-cache-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the cache's correctness relation (a stored row equals
* the registry fold at its `seq` watermark) is only checkable by re-running the
* fold over the persisted log — duplicating the implementation rather than
* detecting drift — and its staleness is by design (fail-soft writes). The
* durable boundary is already schema-validated by the storage-domain layer
* on every reopen, and the read ladder's version/watermark guards are proven
* by the package spec.
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
