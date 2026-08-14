import { ShikiError } from "@shikijs/types";
import { EncodedTokenMetadata, INITIAL, Registry as Registry$1, Theme } from "@shikijs/vscode-textmate";
export * from "@shikijs/types";
//#region src/utils/colors.ts
function resolveColorReplacements(theme, options) {
	const replacements = typeof theme === "string" ? {} : { ...theme.colorReplacements };
	const themeName = typeof theme === "string" ? theme : theme.name;
	for (const [key, value] of Object.entries(options?.colorReplacements || {})) if (typeof value === "string") replacements[key] = value;
	else if (key === themeName) Object.assign(replacements, value);
	return replacements;
}
function applyColorReplacements(color, replacements) {
	if (!color) return color;
	return replacements?.[color?.toLowerCase()] || color;
}
//#endregion
//#region src/utils/general.ts
function toArray(x) {
	return Array.isArray(x) ? x : [x];
}
/**
* Normalize a getter to a promise.
*/
async function normalizeGetter(p) {
	return Promise.resolve(typeof p === "function" ? p() : p).then((r) => r.default || r);
}
/**
* Check if the language is plaintext that is ignored by Shiki.
*
* Hard-coded plain text languages: `plaintext`, `txt`, `text`, `plain`.
*/
function isPlainLang(lang) {
	return !lang || [
		"plaintext",
		"txt",
		"text",
		"plain"
	].includes(lang);
}
/**
* Check if the language is specially handled or bypassed by Shiki.
*
* Hard-coded languages: `ansi` and plaintexts like `plaintext`, `txt`, `text`, `plain`.
*/
function isSpecialLang(lang) {
	return lang === "ansi" || isPlainLang(lang);
}
/**
* Check if the theme is specially handled or bypassed by Shiki.
*
* Hard-coded themes: `none`.
*/
function isNoneTheme(theme) {
	return theme === "none";
}
/**
* Check if the theme is specially handled or bypassed by Shiki.
*
* Hard-coded themes: `none`.
*/
function isSpecialTheme(theme) {
	return isNoneTheme(theme);
}
//#endregion
//#region src/utils/strings.ts
/**
* Split a string into lines, each line preserves the line ending.
*
* @param code - The code string to split into lines
* @param preserveEnding - Whether to preserve line endings in the result
* @returns Array of tuples containing [line content, offset index]
*
* @example
* ```ts
* splitLines('hello\nworld', false)
* // => [['hello', 0], ['world', 6]]
*
* splitLines('hello\nworld', true)
* // => [['hello\n', 0], ['world', 6]]
* ```
*/
const RE_NEWLINE = /(\r?\n)/g;
function splitLines(code, preserveEnding = false) {
	if (code.length === 0) return [["", 0]];
	const parts = code.split(RE_NEWLINE);
	let index = 0;
	const lines = [];
	for (let i = 0; i < parts.length; i += 2) {
		const line = preserveEnding ? parts[i] + (parts[i + 1] || "") : parts[i];
		lines.push([line, index]);
		index += parts[i].length;
		index += parts[i + 1]?.length || 0;
	}
	return lines;
}
//#endregion
//#region src/textmate/normalize-theme.ts
/**
* https://github.com/microsoft/vscode/blob/f7f05dee53fb33fe023db2e06e30a89d3094488f/src/vs/platform/theme/common/colorRegistry.ts#L258-L268
*/
const VSCODE_FALLBACK_EDITOR_FG = {
	light: "#333333",
	dark: "#bbbbbb"
};
const VSCODE_FALLBACK_EDITOR_BG = {
	light: "#fffffe",
	dark: "#1e1e1e"
};
const RESOLVED_KEY = "__shiki_resolved";
/**
* Normalize a textmate theme to shiki theme
*/
function normalizeTheme(rawTheme) {
	if (rawTheme?.[RESOLVED_KEY]) return rawTheme;
	const theme = { ...rawTheme };
	if (theme.tokenColors && !theme.settings) {
		theme.settings = theme.tokenColors;
		delete theme.tokenColors;
	}
	theme.type ||= "dark";
	theme.colorReplacements = { ...theme.colorReplacements };
	theme.settings ||= [];
	let { bg, fg } = theme;
	if (!bg || !fg) {
		/**
		* First try:
		* Theme might contain a global `tokenColor` without `name` or `scope`
		* Used as default value for foreground/background
		*/
		const globalSetting = theme.settings ? theme.settings.find((s) => !s.name && !s.scope) : void 0;
		if (globalSetting?.settings?.foreground) fg = globalSetting.settings.foreground;
		if (globalSetting?.settings?.background) bg = globalSetting.settings.background;
		/**
		* Second try:
		* If there's no global `tokenColor` without `name` or `scope`
		* Use `editor.foreground` and `editor.background`
		*/
		if (!fg && theme?.colors?.["editor.foreground"]) fg = theme.colors["editor.foreground"];
		if (!bg && theme?.colors?.["editor.background"]) bg = theme.colors["editor.background"];
		/**
		* Last try:
		* If there's no fg/bg color specified in theme, use default
		*/
		if (!fg) fg = theme.type === "light" ? VSCODE_FALLBACK_EDITOR_FG.light : VSCODE_FALLBACK_EDITOR_FG.dark;
		if (!bg) bg = theme.type === "light" ? VSCODE_FALLBACK_EDITOR_BG.light : VSCODE_FALLBACK_EDITOR_BG.dark;
		theme.fg = fg;
		theme.bg = bg;
	}
	if (!(theme.settings[0] && theme.settings[0].settings && !theme.settings[0].scope)) theme.settings.unshift({ settings: {
		foreground: theme.fg,
		background: theme.bg
	} });
	let replacementCount = 0;
	const replacementMap = /* @__PURE__ */ new Map();
	function getReplacementColor(value) {
		if (replacementMap.has(value)) return replacementMap.get(value);
		replacementCount += 1;
		const hex = `#${replacementCount.toString(16).padStart(8, "0").toLowerCase()}`;
		if (theme.colorReplacements?.[`#${hex}`]) return getReplacementColor(value);
		replacementMap.set(value, hex);
		return hex;
	}
	theme.settings = theme.settings.map((setting) => {
		const replaceFg = setting.settings?.foreground && !setting.settings.foreground.startsWith("#");
		const replaceBg = setting.settings?.background && !setting.settings.background.startsWith("#");
		if (!replaceFg && !replaceBg) return setting;
		const clone = {
			...setting,
			settings: { ...setting.settings }
		};
		if (replaceFg) {
			const replacement = getReplacementColor(setting.settings.foreground);
			theme.colorReplacements[replacement] = setting.settings.foreground;
			clone.settings.foreground = replacement;
		}
		if (replaceBg) {
			const replacement = getReplacementColor(setting.settings.background);
			theme.colorReplacements[replacement] = setting.settings.background;
			clone.settings.background = replacement;
		}
		return clone;
	});
	for (const key of Object.keys(theme.colors || {})) if (key === "editor.foreground" || key === "editor.background" || key.startsWith("terminal.ansi")) {
		if (!theme.colors[key]?.startsWith("#")) {
			const replacement = getReplacementColor(theme.colors[key]);
			theme.colorReplacements[replacement] = theme.colors[key];
			theme.colors[key] = replacement;
		}
	}
	Object.defineProperty(theme, RESOLVED_KEY, {
		enumerable: false,
		writable: false,
		value: true
	});
	return theme;
}
//#endregion
//#region src/textmate/getters-resolve.ts
/**
* Resolve
*/
async function resolveLangs(langs) {
	return [...new Set((await Promise.all(langs.filter((l) => !isSpecialLang(l)).map(async (lang) => await normalizeGetter(lang).then((r) => Array.isArray(r) ? r : [r])))).flat())];
}
async function resolveThemes(themes) {
	return (await Promise.all(themes.map(async (theme) => isSpecialTheme(theme) ? null : normalizeTheme(await normalizeGetter(theme))))).filter((i) => !!i);
}
//#endregion
//#region src/utils/alias.ts
function resolveLangAlias(name, alias) {
	if (!alias) return name;
	if (alias[name]) {
		const resolved = /* @__PURE__ */ new Set([name]);
		while (alias[name]) {
			name = alias[name];
			if (resolved.has(name)) throw new ShikiError(`Circular alias \`${[...resolved].join(" -> ")} -> ${name}\``);
			resolved.add(name);
		}
	}
	return name;
}
//#endregion
//#region src/textmate/registry.ts
var Registry = class extends Registry$1 {
	_resolver;
	_themes;
	_langs;
	_alias;
	_resolvedThemes = /* @__PURE__ */ new Map();
	_resolvedGrammars = /* @__PURE__ */ new Map();
	_langMap = /* @__PURE__ */ new Map();
	_langGraph = /* @__PURE__ */ new Map();
	_textmateThemeCache = /* @__PURE__ */ new WeakMap();
	_loadedThemesCache = null;
	_loadedLanguagesCache = null;
	constructor(_resolver, _themes, _langs, _alias = {}) {
		super(_resolver);
		this._resolver = _resolver;
		this._themes = _themes;
		this._langs = _langs;
		this._alias = _alias;
		this._themes.map((t) => this.loadTheme(t));
		this.loadLanguages(this._langs);
	}
	getTheme(theme) {
		if (typeof theme === "string") return this._resolvedThemes.get(theme);
		else return this.loadTheme(theme);
	}
	loadTheme(theme) {
		const _theme = normalizeTheme(theme);
		if (_theme.name) {
			this._resolvedThemes.set(_theme.name, _theme);
			this._loadedThemesCache = null;
		}
		return _theme;
	}
	getLoadedThemes() {
		if (!this._loadedThemesCache) this._loadedThemesCache = [...this._resolvedThemes.keys()];
		return this._loadedThemesCache;
	}
	setTheme(theme) {
		let textmateTheme = this._textmateThemeCache.get(theme);
		if (!textmateTheme) {
			textmateTheme = Theme.createFromRawTheme(theme);
			this._textmateThemeCache.set(theme, textmateTheme);
		}
		this._syncRegistry.setTheme(textmateTheme);
	}
	getGrammar(name) {
		name = resolveLangAlias(name, this._alias);
		return this._resolvedGrammars.get(name);
	}
	loadLanguage(lang) {
		if (this.getGrammar(lang.name)) return;
		const embeddedLazilyBy = new Set([...this._langMap.values()].filter((i) => i.embeddedLangsLazy?.includes(lang.name)));
		this._resolver.addLanguage(lang);
		const grammarConfig = {
			balancedBracketSelectors: lang.balancedBracketSelectors || ["*"],
			unbalancedBracketSelectors: lang.unbalancedBracketSelectors || []
		};
		this._syncRegistry._rawGrammars.set(lang.scopeName, lang);
		const g = this.loadGrammarWithConfiguration(lang.scopeName, 1, grammarConfig);
		g.name = lang.name;
		this._resolvedGrammars.set(lang.name, g);
		if (lang.aliases) lang.aliases.forEach((alias) => {
			this._alias[alias] = lang.name;
		});
		this._loadedLanguagesCache = null;
		if (embeddedLazilyBy.size) for (const e of embeddedLazilyBy) {
			this._resolvedGrammars.delete(e.name);
			this._loadedLanguagesCache = null;
			this._syncRegistry?._injectionGrammars?.delete(e.scopeName);
			this._syncRegistry?._grammars?.delete(e.scopeName);
			this.loadLanguage(this._langMap.get(e.name));
		}
	}
	dispose() {
		super.dispose();
		this._resolvedThemes.clear();
		this._resolvedGrammars.clear();
		this._langMap.clear();
		this._langGraph.clear();
		this._loadedThemesCache = null;
	}
	loadLanguages(langs) {
		for (const lang of langs) this.resolveEmbeddedLanguages(lang);
		const langsGraphArray = [...this._langGraph.entries()];
		const missingLangs = langsGraphArray.filter(([_, lang]) => !lang);
		if (missingLangs.length) {
			const dependents = langsGraphArray.filter(([_, lang]) => {
				if (!lang) return false;
				return (lang.embeddedLanguages || lang.embeddedLangs)?.some((l) => missingLangs.map(([name]) => name).includes(l));
			}).filter((lang) => !missingLangs.includes(lang));
			throw new ShikiError(`Missing languages ${missingLangs.map(([name]) => `\`${name}\``).join(", ")}, required by ${dependents.map(([name]) => `\`${name}\``).join(", ")}`);
		}
		for (const [_, lang] of langsGraphArray) this._resolver.addLanguage(lang);
		for (const [_, lang] of langsGraphArray) this.loadLanguage(lang);
	}
	getLoadedLanguages() {
		if (!this._loadedLanguagesCache) this._loadedLanguagesCache = [.../* @__PURE__ */ new Set([...this._resolvedGrammars.keys(), ...Object.keys(this._alias)])];
		return this._loadedLanguagesCache;
	}
	resolveEmbeddedLanguages(lang) {
		this._langMap.set(lang.name, lang);
		this._langGraph.set(lang.name, lang);
		const embedded = lang.embeddedLanguages ?? lang.embeddedLangs;
		if (embedded) for (const embeddedLang of embedded) this._langGraph.set(embeddedLang, this._langMap.get(embeddedLang));
	}
};
//#endregion
//#region src/textmate/resolver.ts
var Resolver = class {
	_langs = /* @__PURE__ */ new Map();
	_scopeToLang = /* @__PURE__ */ new Map();
	_injections = /* @__PURE__ */ new Map();
	_onigLib;
	constructor(engine, langs) {
		this._onigLib = {
			createOnigScanner: (patterns) => engine.createScanner(patterns),
			createOnigString: (s) => engine.createString(s)
		};
		langs.forEach((i) => this.addLanguage(i));
	}
	get onigLib() {
		return this._onigLib;
	}
	getLangRegistration(langIdOrAlias) {
		return this._langs.get(langIdOrAlias);
	}
	loadGrammar(scopeName) {
		return this._scopeToLang.get(scopeName);
	}
	addLanguage(l) {
		this._langs.set(l.name, l);
		if (l.aliases) l.aliases.forEach((a) => {
			this._langs.set(a, l);
		});
		this._scopeToLang.set(l.scopeName, l);
		if (l.injectTo) l.injectTo.forEach((i) => {
			if (!this._injections.get(i)) this._injections.set(i, []);
			this._injections.get(i).push(l.scopeName);
		});
	}
	getInjections(scopeName) {
		const scopeParts = scopeName.split(".");
		let injections = [];
		for (let i = 1; i <= scopeParts.length; i++) {
			const subScopeName = scopeParts.slice(0, i).join(".");
			injections = [...injections, ...this._injections.get(subScopeName) || []];
		}
		return injections;
	}
};
//#endregion
//#region src/constructors/primitive.ts
let instancesCount = 0;
/**
* Get the minimal shiki primitive instance.
*
* Requires to provide the engine and all themes and languages upfront.
*/
function createShikiPrimitive(options) {
	instancesCount += 1;
	if (options.warnings !== false && instancesCount >= 10 && instancesCount % 10 === 0) console.warn(`[Shiki] ${instancesCount} instances have been created. Shiki is supposed to be used as a singleton, consider refactoring your code to cache your highlighter instance; Or call \`highlighter.dispose()\` to release unused instances.`);
	let isDisposed = false;
	if (!options.engine) throw new ShikiError("`engine` option is required for synchronous mode");
	const langs = (options.langs || []).flat(1);
	const themes = (options.themes || []).flat(1).map(normalizeTheme);
	const _registry = new Registry(new Resolver(options.engine, langs), themes, langs, options.langAlias);
	let _lastTheme;
	function resolveLangAlias$1(name) {
		return resolveLangAlias(name, options.langAlias);
	}
	function getLanguage(name) {
		ensureNotDisposed();
		const _lang = _registry.getGrammar(typeof name === "string" ? name : name.name);
		if (!_lang) throw new ShikiError(`Language \`${name}\` not found, you may need to load it first`);
		return _lang;
	}
	function getTheme(name) {
		if (name === "none") return {
			bg: "",
			fg: "",
			name: "none",
			settings: [],
			type: "dark"
		};
		ensureNotDisposed();
		const _theme = _registry.getTheme(name);
		if (!_theme) throw new ShikiError(`Theme \`${name}\` not found, you may need to load it first`);
		return _theme;
	}
	function setTheme(name) {
		ensureNotDisposed();
		const theme = getTheme(name);
		if (_lastTheme !== name) {
			_registry.setTheme(theme);
			_lastTheme = name;
		}
		return {
			theme,
			colorMap: _registry.getColorMap()
		};
	}
	function getLoadedThemes() {
		ensureNotDisposed();
		return _registry.getLoadedThemes();
	}
	function getLoadedLanguages() {
		ensureNotDisposed();
		return _registry.getLoadedLanguages();
	}
	function loadLanguageSync(...langs) {
		ensureNotDisposed();
		_registry.loadLanguages(langs.flat(1));
	}
	async function loadLanguage(...langs) {
		return loadLanguageSync(await resolveLangs(langs));
	}
	function loadThemeSync(...themes) {
		ensureNotDisposed();
		for (const theme of themes.flat(1)) _registry.loadTheme(theme);
	}
	async function loadTheme(...themes) {
		ensureNotDisposed();
		return loadThemeSync(await resolveThemes(themes));
	}
	function ensureNotDisposed() {
		if (isDisposed) throw new ShikiError("Shiki instance has been disposed");
	}
	function dispose() {
		if (isDisposed) return;
		isDisposed = true;
		_registry.dispose();
		instancesCount -= 1;
	}
	return {
		setTheme,
		getTheme,
		getLanguage,
		getLoadedThemes,
		getLoadedLanguages,
		resolveLangAlias: resolveLangAlias$1,
		loadLanguage,
		loadLanguageSync,
		loadTheme,
		loadThemeSync,
		dispose,
		[Symbol.dispose]: dispose
	};
}
/**
* @deprecated Use `createShikiPrimitive` instead.
*/
const createShikiInternalSync = createShikiPrimitive;
//#endregion
//#region src/constructors/async.ts
/**
* Get the minimal shiki primitive instance.
*/
async function createShikiPrimitiveAsync(options) {
	if (!options.engine) console.warn("`engine` option is required. Use `createOnigurumaEngine` or `createJavaScriptRegexEngine` to create an engine.");
	const [themes, langs, engine] = await Promise.all([
		resolveThemes(options.themes || []),
		resolveLangs(options.langs || []),
		options.engine
	]);
	return createShikiPrimitive({
		...options,
		themes,
		langs,
		engine
	});
}
/**
* @deprecated Use `createShikiPrimitiveAsync` instead.
*/
const createShikiInternal = createShikiPrimitiveAsync;
//#endregion
//#region src/textmate/grammar-state.ts
const _grammarStateMap = /* @__PURE__ */ new WeakMap();
function setLastGrammarStateToMap(keys, state) {
	_grammarStateMap.set(keys, state);
}
function getLastGrammarStateFromMap(keys) {
	return _grammarStateMap.get(keys);
}
/**
* GrammarState is a special reference object that holds the state of a grammar.
*
* It's used to highlight code snippets that are part of the target language.
*/
var GrammarState = class GrammarState {
	/**
	* Theme to Stack mapping
	*/
	_stacks = {};
	lang;
	get themes() {
		return Object.keys(this._stacks);
	}
	get theme() {
		return this.themes[0];
	}
	get _stack() {
		return this._stacks[this.theme];
	}
	/**
	* Static method to create a initial grammar state.
	*/
	static initial(lang, themes) {
		return new GrammarState(Object.fromEntries(toArray(themes).map((theme) => [theme, INITIAL])), lang);
	}
	constructor(...args) {
		if (args.length === 2) {
			const [stacksMap, lang] = args;
			this.lang = lang;
			this._stacks = stacksMap;
		} else {
			const [stack, lang, theme] = args;
			this.lang = lang;
			this._stacks = { [theme]: stack };
		}
	}
	/**
	* Get the internal stack object.
	* @internal
	*/
	getInternalStack(theme = this.theme) {
		return this._stacks[theme];
	}
	getScopes(theme = this.theme) {
		return getScopes(this._stacks[theme]);
	}
	toJSON() {
		return {
			lang: this.lang,
			theme: this.theme,
			themes: this.themes,
			scopes: this.getScopes()
		};
	}
};
function getScopes(stack) {
	const scopes = [];
	const visited = /* @__PURE__ */ new Set();
	function pushScope(stack) {
		if (visited.has(stack)) return;
		visited.add(stack);
		const name = stack?.nameScopesList?.scopeName;
		if (name) scopes.push(name);
		if (stack.parent) pushScope(stack.parent);
	}
	pushScope(stack);
	return scopes;
}
function getGrammarStack(state, theme) {
	if (!(state instanceof GrammarState)) throw new ShikiError("Invalid grammar state");
	return state.getInternalStack(theme);
}
//#endregion
//#region src/highlight/code-to-tokens-base.ts
const RE_COMMA = /,/;
const RE_SPACE = / /;
/**
* Code to tokens, with a simple theme.
*/
function codeToTokensBase(primitive, code, options = {}) {
	const { theme: themeName = primitive.getLoadedThemes()[0] } = options;
	if (isPlainLang(primitive.resolveLangAlias(options.lang || "text")) || isNoneTheme(themeName)) return splitLines(code).map((line) => [{
		content: line[0],
		offset: line[1]
	}]);
	const { theme, colorMap } = primitive.setTheme(themeName);
	const _grammar = primitive.getLanguage(options.lang || "text");
	if (options.grammarState) {
		if (options.grammarState.lang !== _grammar.name) throw new ShikiError(`Grammar state language "${options.grammarState.lang}" does not match highlight language "${_grammar.name}"`);
		if (!options.grammarState.themes.includes(theme.name)) throw new ShikiError(`Grammar state themes "${options.grammarState.themes}" do not contain highlight theme "${theme.name}"`);
	}
	return tokenizeWithTheme(code, _grammar, theme, colorMap, options);
}
function getLastGrammarState(...args) {
	if (args.length === 2) return getLastGrammarStateFromMap(args[1]);
	const [primitive, code, options = {}] = args;
	const { lang = "text", theme: themeName = primitive.getLoadedThemes()[0] } = options;
	if (isPlainLang(lang) || isNoneTheme(themeName)) throw new ShikiError("Plain language does not have grammar state");
	if (lang === "ansi") throw new ShikiError("ANSI language does not have grammar state");
	const { theme, colorMap } = primitive.setTheme(themeName);
	const _grammar = primitive.getLanguage(lang);
	return new GrammarState(_tokenizeWithTheme(code, _grammar, theme, colorMap, options).stateStack, _grammar.name, theme.name);
}
function tokenizeWithTheme(code, grammar, theme, colorMap, options) {
	const result = _tokenizeWithTheme(code, grammar, theme, colorMap, options);
	const grammarState = new GrammarState(result.stateStack, grammar.name, theme.name);
	setLastGrammarStateToMap(result.tokens, grammarState);
	return result.tokens;
}
function _tokenizeWithTheme(code, grammar, theme, colorMap, options) {
	const colorReplacements = resolveColorReplacements(theme, options);
	const { tokenizeMaxLineLength = 0, tokenizeTimeLimit = 500, includeExplanation = false } = options;
	const lines = splitLines(code);
	let stateStack = options.grammarState ? getGrammarStack(options.grammarState, theme.name) ?? INITIAL : options.grammarContextCode != null ? _tokenizeWithTheme(options.grammarContextCode, grammar, theme, colorMap, {
		...options,
		grammarState: void 0,
		grammarContextCode: void 0
	}).stateStack : INITIAL;
	let actual = [];
	const final = [];
	for (let i = 0, len = lines.length; i < len; i++) {
		const [line, lineOffset] = lines[i];
		if (line === "") {
			actual = [];
			final.push([]);
			continue;
		}
		if (tokenizeMaxLineLength > 0 && line.length >= tokenizeMaxLineLength) {
			actual = [];
			final.push([{
				content: line,
				offset: lineOffset,
				color: "",
				fontStyle: 0
			}]);
			continue;
		}
		let resultWithScopes;
		let tokensWithScopes;
		let tokensWithScopesIndex;
		if (includeExplanation && includeExplanation !== "tokenType") {
			resultWithScopes = grammar.tokenizeLine(line, stateStack, tokenizeTimeLimit);
			tokensWithScopes = resultWithScopes.tokens;
			tokensWithScopesIndex = 0;
		}
		const result = grammar.tokenizeLine2(line, stateStack, tokenizeTimeLimit);
		const tokensLength = result.tokens.length / 2;
		for (let j = 0; j < tokensLength; j++) {
			const startIndex = result.tokens[2 * j];
			const nextStartIndex = j + 1 < tokensLength ? result.tokens[2 * j + 2] : line.length;
			if (startIndex === nextStartIndex) continue;
			const metadata = result.tokens[2 * j + 1];
			const color = applyColorReplacements(colorMap[EncodedTokenMetadata.getForeground(metadata)], colorReplacements);
			const fontStyle = EncodedTokenMetadata.getFontStyle(metadata);
			const token = {
				content: line.substring(startIndex, nextStartIndex),
				offset: lineOffset + startIndex,
				color,
				fontStyle
			};
			if (includeExplanation === "tokenType") token.type = EncodedTokenMetadata.getTokenType(metadata);
			else if (includeExplanation) {
				const themeSettingsSelectors = [];
				if (includeExplanation !== "scopeName") for (const setting of theme.settings) {
					let selectors;
					switch (typeof setting.scope) {
						case "string":
							selectors = setting.scope.split(RE_COMMA).map((scope) => scope.trim());
							break;
						case "object":
							selectors = setting.scope;
							break;
						default: continue;
					}
					themeSettingsSelectors.push({
						settings: setting,
						selectors: selectors.map((selector) => selector.split(RE_SPACE))
					});
				}
				token.explanation = [];
				let offset = 0;
				while (startIndex + offset < nextStartIndex) {
					const tokenWithScopes = tokensWithScopes[tokensWithScopesIndex];
					const tokenWithScopesText = line.substring(tokenWithScopes.startIndex, tokenWithScopes.endIndex);
					offset += tokenWithScopesText.length;
					token.explanation.push({
						content: tokenWithScopesText,
						scopes: includeExplanation === "scopeName" ? explainThemeScopesNameOnly(tokenWithScopes.scopes) : explainThemeScopesFull(themeSettingsSelectors, tokenWithScopes.scopes)
					});
					tokensWithScopesIndex += 1;
				}
			}
			actual.push(token);
		}
		final.push(actual);
		actual = [];
		stateStack = result.ruleStack;
	}
	return {
		tokens: final,
		stateStack
	};
}
function explainThemeScopesNameOnly(scopes) {
	return scopes.map((scope) => ({ scopeName: scope }));
}
function explainThemeScopesFull(themeSelectors, scopes) {
	const result = [];
	for (let i = 0, len = scopes.length; i < len; i++) {
		const scope = scopes[i];
		result[i] = {
			scopeName: scope,
			themeMatches: explainThemeScope(themeSelectors, scope, scopes.slice(0, i))
		};
	}
	return result;
}
function matchesOne(selector, scope) {
	return selector === scope || scope.substring(0, selector.length) === selector && scope[selector.length] === ".";
}
function matches(selectors, scope, parentScopes) {
	if (!matchesOne(selectors.at(-1), scope)) return false;
	let selectorParentIndex = selectors.length - 2;
	let parentIndex = parentScopes.length - 1;
	while (selectorParentIndex >= 0 && parentIndex >= 0) {
		if (matchesOne(selectors[selectorParentIndex], parentScopes[parentIndex])) selectorParentIndex -= 1;
		parentIndex -= 1;
	}
	if (selectorParentIndex === -1) return true;
	return false;
}
function explainThemeScope(themeSettingsSelectors, scope, parentScopes) {
	const result = [];
	for (const { selectors, settings } of themeSettingsSelectors) for (const selectorPieces of selectors) if (matches(selectorPieces, scope, parentScopes)) {
		result.push(settings);
		break;
	}
	return result;
}
//#endregion
//#region src/highlight/code-to-tokens-themes.ts
/**
* Get tokens with multiple themes
*/
function codeToTokensWithThemes(primitive, code, options, codeToTokensBaseFn = codeToTokensBase) {
	const themes = Object.entries(options.themes).filter((i) => i[1]).map((i) => ({
		color: i[0],
		theme: i[1]
	}));
	const themedTokens = themes.map((t) => {
		const tokens = codeToTokensBaseFn(primitive, code, {
			...options,
			theme: t.theme
		});
		return {
			tokens,
			state: getLastGrammarStateFromMap(tokens),
			theme: typeof t.theme === "string" ? t.theme : t.theme.name
		};
	});
	const tokens = alignThemesTokenization(...themedTokens.map((i) => i.tokens));
	const mergedTokens = tokens[0].map((line, lineIdx) => line.map((_token, tokenIdx) => {
		const mergedToken = {
			content: _token.content,
			variants: {},
			offset: _token.offset
		};
		if ("includeExplanation" in options && options.includeExplanation) mergedToken.explanation = _token.explanation;
		tokens.forEach((t, themeIdx) => {
			const { content: _, explanation: __, offset: ___, ...styles } = t[lineIdx][tokenIdx];
			mergedToken.variants[themes[themeIdx].color] = styles;
		});
		return mergedToken;
	}));
	const mergedGrammarState = themedTokens[0].state ? new GrammarState(Object.fromEntries(themedTokens.map((s) => [s.theme, s.state?.getInternalStack(s.theme)])), themedTokens[0].state.lang) : void 0;
	if (mergedGrammarState) setLastGrammarStateToMap(mergedTokens, mergedGrammarState);
	return mergedTokens;
}
/**
* Break tokens from multiple themes into same tokenization.
*
* For example, given two themes that tokenize `console.log("hello")` as:
*
* - `console . log (" hello ")` (6 tokens)
* - `console .log ( "hello" )` (5 tokens)
*
* This function will return:
*
* - `console . log ( " hello " )` (8 tokens)
* - `console . log ( " hello " )` (8 tokens)
*/
function alignThemesTokenization(...themes) {
	const outThemes = themes.map(() => []);
	const count = themes.length;
	for (let i = 0; i < themes[0].length; i++) {
		const lines = themes.map((t) => t[i]);
		const outLines = outThemes.map(() => []);
		outThemes.forEach((t, i) => t.push(outLines[i]));
		const indexes = lines.map(() => 0);
		const current = lines.map((l) => l[0]);
		while (current.every((t) => t)) {
			const minLength = Math.min(...current.map((t) => t.content.length));
			for (let n = 0; n < count; n++) {
				const token = current[n];
				if (token.content.length === minLength) {
					outLines[n].push(token);
					indexes[n] += 1;
					current[n] = lines[n][indexes[n]];
				} else {
					outLines[n].push({
						...token,
						content: token.content.slice(0, minLength)
					});
					current[n] = {
						...token,
						content: token.content.slice(minLength),
						offset: token.offset + minLength
					};
				}
			}
		}
	}
	return outThemes;
}
//#endregion
export { GrammarState, Registry, Resolver, alignThemesTokenization, applyColorReplacements, codeToTokensBase, codeToTokensWithThemes, createShikiInternal, createShikiInternalSync, createShikiPrimitive, createShikiPrimitiveAsync, getGrammarStack, getLastGrammarState, getLastGrammarStateFromMap, isNoneTheme, isPlainLang, isSpecialLang, isSpecialTheme, normalizeGetter, normalizeTheme, resolveColorReplacements, resolveLangAlias, resolveLangs, resolveThemes, setLastGrammarStateToMap, splitLines, toArray, tokenizeWithTheme };
