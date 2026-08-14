//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-runtime`.
* @module @deepseek-ai/dsh-client-runtime/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-runtime";
/** Cordis companion plugin name. */
const name = "client-runtime-invariant";
/** Service required before the companion can register. */
const inject = ["invariants"];
/**
* Owned relation: every 'slots/changed'(key) emission must observe the
* mutation already applied — SlotCore bumps the key's version synchronously
* before the service re-emits, so a zero version at dispatch time means the
* event fired without (or ahead of) its mutation.
*/
const install = (ctx, fail) => {
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "slots/changed") return;
		const key = args[0];
		if (typeof key !== "string" || key === "") {
			fail("'slots/changed' dispatched without a slot key argument");
			return;
		}
		const slots = ctx.get("slots");
		if (slots !== void 0 && slots.getVersion(key) === 0) fail(`'slots/changed' fired for "${key}" before any mutation bumped its version — emission must follow the applied mutation`);
	}, { global: true });
};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
