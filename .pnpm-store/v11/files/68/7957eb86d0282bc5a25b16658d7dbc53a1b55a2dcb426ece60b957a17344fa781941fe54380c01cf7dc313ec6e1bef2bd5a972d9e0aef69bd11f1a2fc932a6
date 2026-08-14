//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-native-command`.
* @module @deepseek-ai/dsh-native-command/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-native-command";
/** Cordis companion plugin name. */
const name = "native-command-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: each run is one stateless child-process round trip
* with no owned event stream or mutable runtime data; behavior is enforced by
* unit tests.
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
