//#region lib/types/invariant.js
/** Package-owned LLM stream-protocol invariants. @module @deepseek-ai/dsh-llm/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-llm";
/** Cordis companion plugin name. */
const name = "llm-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Require one chunk index to be a non-negative safe integer. */
function validateIndex(index, fail) {
	if (!Number.isSafeInteger(index) || index < 0) fail(`LLM stream block index must be a non-negative safe integer, got ${index}`);
}
/** Require a delta to address an open block of its matching type. */
function validateDelta(open, index, expected, fail) {
	validateIndex(index, fail);
	const actual = open.get(index);
	if (actual !== expected) fail(`${expected} delta at index ${index} requires an open ${expected} block, got ${String(actual)}`);
}
/** Wrap one provider stream and enforce its grammar as chunks are consumed. */
async function* validateStream(source, fail) {
	const open = /* @__PURE__ */ new Map();
	let usageSeen = false;
	let finished = false;
	for await (const chunk of source) {
		if (finished) fail(`LLM stream emitted ${chunk.type} after terminal finish`);
		switch (chunk.type) {
			case "block-start":
				validateIndex(chunk.index, fail);
				if (open.has(chunk.index)) fail(`LLM stream repeated block-start index ${chunk.index}`);
				open.set(chunk.index, chunk.blockType);
				break;
			case "text-delta":
				validateDelta(open, chunk.index, "text", fail);
				break;
			case "reasoning-delta":
				validateDelta(open, chunk.index, "reasoning", fail);
				break;
			case "tool-call-delta":
				validateDelta(open, chunk.index, "tool-call", fail);
				break;
			case "block-end": {
				validateIndex(chunk.index, fail);
				const blockType = open.get(chunk.index);
				if (blockType === void 0) fail(`LLM stream block-end index ${chunk.index} has no open block`);
				if (chunk.block.type !== blockType) fail(`LLM stream block-end index ${chunk.index} closes ${chunk.block.type}, expected ${blockType}`);
				open.delete(chunk.index);
				break;
			}
			case "usage":
				if (usageSeen) fail("LLM stream emitted usage more than once");
				usageSeen = true;
				break;
			case "finish":
				if (open.size > 0 && chunk.reason.kind !== "error" && chunk.reason.kind !== "aborted") fail(`LLM stream finished with ${open.size} open block(s)`);
				finished = true;
				break;
		}
		yield chunk;
	}
	if (!finished) fail("LLM stream ended without a terminal finish chunk");
}
/** Install validation around every provider stream. */
const install = (ctx, fail) => {
	ctx.on("llm/stream", (_options, next) => validateStream(next(), fail), {
		global: true,
		prepend: true
	});
	ctx.on("llm/adapters-updated", () => {
		const llm = ctx.get("llm");
		if (llm === void 0) return;
		for (const provider of llm.listProviders()) try {
			llm.providerRetryPolicy(provider.id);
		} catch {
			fail(`llm/adapters-updated fired while provider "${provider.id}" has no readable registration`);
		}
	}, { global: true });
};
/**
* Register the LLM invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
