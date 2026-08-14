//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings`.
* @module @deepseek-ai/dsh-client-ui-settings/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-settings";
/** Cordis companion plugin name. */
const name = "client-ui-settings-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: a presentation shell projecting the settings.section
* ledger into navigation — it emits no cordis events and owns no cross-plugin
* mutable relation; slot declaration/registration conflicts already fail loud
* in the slot core at load time.
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
