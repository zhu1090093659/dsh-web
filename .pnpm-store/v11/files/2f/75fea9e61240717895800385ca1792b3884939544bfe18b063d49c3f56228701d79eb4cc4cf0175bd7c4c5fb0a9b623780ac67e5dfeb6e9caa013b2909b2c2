//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-conversation`.
* @module @deepseek-ai/dsh-client-ui-conversation/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-conversation";
/** Cordis companion plugin name. */
const name = "client-ui-conversation-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the conversation service emits no cordis events, and
* both rings this package owns (the 'conversation.view' tab ring and the
* 'conversation.chat.node' business renderer seat) ride the slot system, whose ledger
* invariants live with the runtime slots package.
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
