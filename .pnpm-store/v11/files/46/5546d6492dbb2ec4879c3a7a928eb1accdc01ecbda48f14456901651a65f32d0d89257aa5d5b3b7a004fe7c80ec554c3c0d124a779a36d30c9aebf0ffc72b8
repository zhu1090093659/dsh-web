//#region lib/types/invariant.js
/** Package-owned prompt-assembly invariants. @module @deepseek-ai/dsh-system-prompt/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-system-prompt";
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
/** Cordis companion plugin name. */
const name = "system-prompt-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Validate the authoritative assembly returned by the waterfall. */
function validateAssembly(assembly, fail) {
	const sectionNames = /* @__PURE__ */ new Set();
	for (const section of assembly.sections) {
		if (section.name.length === 0) fail("assembled section names must be non-empty");
		if (sectionNames.has(section.name)) fail(`assembled section name ${JSON.stringify(section.name)} is duplicated`);
		sectionNames.add(section.name);
		if (typeof section.text !== "string") fail(`assembled section ${JSON.stringify(section.name)} text must be a string`);
	}
	const contextNames = /* @__PURE__ */ new Set();
	for (const context of assembly.contexts) {
		if (context.name.length === 0) fail("assembled context names must be non-empty");
		if (contextNames.has(context.name)) fail(`assembled context name ${JSON.stringify(context.name)} is duplicated`);
		contextNames.add(context.name);
		if (typeof context.text !== "string") fail(`assembled context ${JSON.stringify(context.name)} text must be a string`);
	}
	for (const tool of assembly.tools) if (tool.name.length === 0) fail("assembled tool names must be non-empty");
	for (const [name, value] of Object.entries(assembly.variables)) {
		if (!VARIABLE_NAME.test(name)) fail(`assembled variable name ${JSON.stringify(name)} is invalid`);
		if (value !== void 0 && typeof value !== "string") fail(`assembled variable ${JSON.stringify(name)} must be a string or undefined`);
	}
}
/** Install validation around the authoritative assembly waterfall result. */
const install = (ctx, fail) => {
	ctx.on("system-prompt/assemble", async (_assembly, _context, next) => {
		const assembled = await next();
		validateAssembly(assembled, fail);
		return assembled;
	}, {
		global: true,
		prepend: true
	});
};
/**
* Register the system-prompt invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
