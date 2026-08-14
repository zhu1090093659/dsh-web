import { t as JavaScriptScanner } from "./scanner-DX8LRFGE.mjs";
import { toRegExp } from "oniguruma-to-es";
//#region src/engine-compile.ts
/**
* The default regex constructor for the JavaScript RegExp engine.
*/
function defaultJavaScriptRegexConstructor(pattern, options) {
	return toRegExp(pattern, {
		global: true,
		hasIndices: true,
		lazyCompileLength: 3e3,
		rules: {
			allowOrphanBackrefs: true,
			asciiWordBoundaries: true,
			captureGroup: true,
			recursionLimit: 5,
			singleline: true
		},
		...options
	});
}
/**
* Use the modern JavaScript RegExp engine to implement the OnigScanner.
*
* As Oniguruma supports some features that can't be emulated using native JavaScript regexes, some
* patterns are not supported. Errors will be thrown when parsing TextMate grammars with
* unsupported patterns, and when the grammar includes patterns that use invalid Oniguruma syntax.
* Set `forgiving` to `true` to ignore these errors and skip any unsupported or invalid patterns.
*/
function createJavaScriptRegexEngine(options = {}) {
	const _options = {
		target: "auto",
		cache: /* @__PURE__ */ new Map(),
		...options
	};
	_options.regexConstructor ||= (pattern) => defaultJavaScriptRegexConstructor(pattern, { target: _options.target });
	return {
		createScanner(patterns) {
			return new JavaScriptScanner(patterns, _options);
		},
		createString(s) {
			return { content: s };
		}
	};
}
//#endregion
export { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor };
