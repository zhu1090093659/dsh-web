//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-slots`.
* @module @deepseek-ai/dsh-client-ui-slots/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-slots";
/** Cordis companion plugin name. */
const name = "client-ui-slots-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: a zero-dependency pure registry core — it emits no
* cordis events itself (the runtime SlotRegistry wrapper owns the event
* bridge and its invariants); define/register/dispose sequencing is asserted
* directly by this package's behavior specs.
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
