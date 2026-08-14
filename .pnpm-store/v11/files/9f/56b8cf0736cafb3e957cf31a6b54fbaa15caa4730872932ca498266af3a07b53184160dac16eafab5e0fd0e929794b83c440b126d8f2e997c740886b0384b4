import { t as JavaScriptScanner } from "./scanner-DX8LRFGE.mjs";
//#region src/engine-raw.ts
/**
* Raw JavaScript regex engine that only supports precompiled grammars.
*
* This further simplifies the engine by excluding the regex compilation step.
*
* Zero dependencies.
*/
function createJavaScriptRawEngine() {
	const options = {
		cache: /* @__PURE__ */ new Map(),
		regexConstructor: () => {
			throw new Error("JavaScriptRawEngine: only support precompiled grammar");
		}
	};
	return {
		createScanner(patterns) {
			return new JavaScriptScanner(patterns, options);
		},
		createString(s) {
			return { content: s };
		}
	};
}
//#endregion
export { createJavaScriptRawEngine };
