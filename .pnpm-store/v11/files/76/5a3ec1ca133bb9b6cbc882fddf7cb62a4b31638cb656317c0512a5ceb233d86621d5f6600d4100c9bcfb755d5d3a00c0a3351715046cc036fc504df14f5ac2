import { ShikiError as ShikiError$1 } from "@shikijs/types";
import { ShikiError, applyColorReplacements, codeToTokensBase as codeToTokensBase$1, codeToTokensWithThemes, codeToTokensWithThemes as codeToTokensWithThemes$1, createShikiInternal, createShikiInternalSync, createShikiPrimitive, createShikiPrimitive as createShikiPrimitive$1, createShikiPrimitiveAsync, createShikiPrimitiveAsync as createShikiPrimitiveAsync$1, getLastGrammarState, getLastGrammarStateFromMap, isNoneTheme, isPlainLang, isSpecialLang, isSpecialTheme, normalizeGetter, normalizeTheme, resolveColorReplacements, setLastGrammarStateToMap, splitLines, splitLines as splitLines$1, toArray, tokenizeWithTheme } from "@shikijs/primitive";
import { FontStyle } from "@shikijs/vscode-textmate";
import { toHtml } from "hast-util-to-html";
export * from "@shikijs/types";
//#region src/utils/hast.ts
const RE_WHITESPACE = /\s+/g;
/**
* Utility to append class to a hast node
*
* If the `property.class` is a string, it will be splitted by space and converted to an array.
*/
function addClassToHast(node, className) {
	if (!className) return node;
	node.properties ||= {};
	node.properties.class ||= [];
	if (typeof node.properties.class === "string") node.properties.class = node.properties.class.split(RE_WHITESPACE);
	if (!Array.isArray(node.properties.class)) node.properties.class = [];
	const targets = Array.isArray(className) ? className : className.split(RE_WHITESPACE);
	for (const c of targets) if (c && !node.properties.class.includes(c)) node.properties.class.push(c);
	return node;
}
//#endregion
//#region src/utils/strings.ts
const RE_LANG_ATTR = /:?lang=["']([^"']+)["']/g;
const RE_CODE_FENCE = /(?:```|~~~)([\w-]+)/g;
const RE_LATEX_BEGIN = /\\begin\{([\w-]+)\}/g;
const RE_SCRIPT_LANG = /<script\s+(?:type|lang)=["']([^"']+)["']/gi;
const RE_FRONTMATTER = /^\s*---\r?\n[\s\S]*?\r?\n---(?:\r?\n|\s*$)/;
/**
* Creates a converter between index and position in a code block.
*
* Overflow/underflow are unchecked.
*/
function createPositionConverter(code) {
	const lines = splitLines$1(code, true).map(([line]) => line);
	function indexToPos(index) {
		if (index === code.length) return {
			line: lines.length - 1,
			character: lines.at(-1).length
		};
		let character = index;
		let line = 0;
		for (const lineText of lines) {
			if (character < lineText.length) break;
			character -= lineText.length;
			line++;
		}
		return {
			line,
			character
		};
	}
	function posToIndex(line, character) {
		let index = 0;
		for (let i = 0; i < line; i++) index += lines[i].length;
		index += character;
		return index;
	}
	return {
		lines,
		indexToPos,
		posToIndex
	};
}
/**
* Guess embedded languages from given code and highlighter.
*
* When highlighter is provided, only bundled languages will be included.
*
* @param code - The code string to analyze
* @param _lang - The primary language of the code (currently unused)
* @param highlighter - Optional highlighter instance to validate languages
* @returns Array of detected language identifiers
*
* @example
* ```ts
* // Detects 'javascript' from Vue SFC
* guessEmbeddedLanguages('<script lang="javascript">')
*
* // Detects 'python' from markdown code block
* guessEmbeddedLanguages('```python\nprint("hi")\n```')
* ```
*/
function guessEmbeddedLanguages(code, _lang, highlighter) {
	const langs = /* @__PURE__ */ new Set();
	for (const match of code.matchAll(RE_LANG_ATTR)) {
		const lang = match[1].toLowerCase().trim();
		if (lang) langs.add(lang);
	}
	for (const match of code.matchAll(RE_CODE_FENCE)) {
		const lang = match[1].toLowerCase().trim();
		if (lang) langs.add(lang);
	}
	for (const match of code.matchAll(RE_LATEX_BEGIN)) {
		const lang = match[1].toLowerCase().trim();
		if (lang) langs.add(lang);
	}
	for (const match of code.matchAll(RE_SCRIPT_LANG)) {
		const fullType = match[1].toLowerCase().trim();
		const lang = fullType.includes("/") ? fullType.split("/").pop() : fullType;
		if (lang) langs.add(lang);
	}
	if (RE_FRONTMATTER.test(code)) langs.add("yaml");
	if (!highlighter) return [...langs];
	const bundle = highlighter.getBundledLanguages();
	return [...langs].filter((l) => l && bundle[l]);
}
const COLOR_KEYS = ["color", "background-color"];
//#endregion
//#region src/utils/tokens.ts
/**
* Split a token into multiple tokens by given offsets.
*
* The offsets are relative to the token, and should be sorted.
*/
function splitToken(token, offsets) {
	let lastOffset = 0;
	const tokens = [];
	for (const offset of offsets) {
		if (offset > lastOffset) tokens.push({
			...token,
			content: token.content.slice(lastOffset, offset),
			offset: token.offset + lastOffset
		});
		lastOffset = offset;
	}
	if (lastOffset < token.content.length) tokens.push({
		...token,
		content: token.content.slice(lastOffset),
		offset: token.offset + lastOffset
	});
	return tokens;
}
function findFirstBreakpointAfter(breakpoints, offset) {
	let start = 0;
	let end = breakpoints.length;
	while (start < end) {
		const middle = start + (end - start >> 1);
		if (breakpoints[middle] <= offset) start = middle + 1;
		else end = middle;
	}
	return start;
}
/**
* Split 2D tokens array by given breakpoints.
*/
function splitTokens(tokens, breakpoints) {
	const sorted = [...breakpoints instanceof Set ? breakpoints : new Set(breakpoints)].sort((a, b) => a - b);
	if (!sorted.length) return tokens;
	return tokens.map((line) => {
		return line.flatMap((token) => {
			const tokenEnd = token.offset + token.content.length;
			const start = findFirstBreakpointAfter(sorted, token.offset);
			let end = start;
			while (end < sorted.length && sorted[end] < tokenEnd) end++;
			if (start === end) return token;
			const breakpointsInToken = sorted.slice(start, end);
			for (let index = 0; index < breakpointsInToken.length; index++) breakpointsInToken[index] -= token.offset;
			return splitToken(token, breakpointsInToken);
		});
	});
}
function flatTokenVariants(merged, variantsOrder, cssVariablePrefix, defaultColor, colorsRendering = "css-vars") {
	const token = {
		content: merged.content,
		explanation: merged.explanation,
		offset: merged.offset
	};
	const styles = variantsOrder.map((t) => getTokenStyleObject(merged.variants[t]));
	const styleKeys = new Set(styles.flatMap((t) => Object.keys(t)));
	const mergedStyles = {};
	const varKey = (idx, key) => {
		const keyName = key === "color" ? "" : key === "background-color" ? "-bg" : `-${key}`;
		return cssVariablePrefix + variantsOrder[idx] + (key === "color" ? "" : keyName);
	};
	styles.forEach((cur, idx) => {
		for (const key of styleKeys) {
			const value = cur[key] || "inherit";
			if (idx === 0 && defaultColor && COLOR_KEYS.includes(key)) if (defaultColor === "light-dark()" && styles.length > 1) {
				const lightIndex = variantsOrder.findIndex((t) => t === "light");
				const darkIndex = variantsOrder.findIndex((t) => t === "dark");
				if (lightIndex === -1 || darkIndex === -1) throw new ShikiError$1("When using `defaultColor: \"light-dark()\"`, you must provide both `light` and `dark` themes");
				const lightValue = styles[lightIndex][key] || "inherit";
				const darkValue = styles[darkIndex][key] || "inherit";
				mergedStyles[key] = `light-dark(${lightValue}, ${darkValue})`;
				if (colorsRendering === "css-vars") mergedStyles[varKey(idx, key)] = value;
			} else mergedStyles[key] = value;
			else if (colorsRendering === "css-vars") mergedStyles[varKey(idx, key)] = value;
		}
	});
	token.htmlStyle = mergedStyles;
	return token;
}
function getTokenStyleObject(token) {
	const styles = {};
	if (token.color) styles.color = token.color;
	if (token.bgColor) styles["background-color"] = token.bgColor;
	if (token.fontStyle) {
		if (token.fontStyle & FontStyle.Italic) styles["font-style"] = "italic";
		if (token.fontStyle & FontStyle.Bold) styles["font-weight"] = "bold";
		const decorations = [];
		if (token.fontStyle & FontStyle.Underline) decorations.push("underline");
		if (token.fontStyle & FontStyle.Strikethrough) decorations.push("line-through");
		if (decorations.length) styles["text-decoration"] = decorations.join(" ");
	}
	return styles;
}
function stringifyTokenStyle(token) {
	if (typeof token === "string") return token;
	return Object.entries(token).map(([key, value]) => `${key}:${value}`).join(";");
}
//#endregion
//#region src/transformer-decorations.ts
/**
* A built-in transformer to add decorations to the highlighted code.
*/
function transformerDecorations() {
	const map = /* @__PURE__ */ new WeakMap();
	function getContext(shiki) {
		if (!map.has(shiki.meta)) {
			const converter = createPositionConverter(shiki.source);
			function normalizePosition(p) {
				if (typeof p === "number") {
					if (p < 0 || p > shiki.source.length) throw new ShikiError$1(`Invalid decoration offset: ${p}. Code length: ${shiki.source.length}`);
					return {
						...converter.indexToPos(p),
						offset: p
					};
				} else {
					const line = converter.lines[p.line];
					if (line === void 0) throw new ShikiError$1(`Invalid decoration position ${JSON.stringify(p)}. Lines length: ${converter.lines.length}`);
					let character = p.character;
					if (character < 0) character = line.length + character;
					if (character < 0 || character > line.length) throw new ShikiError$1(`Invalid decoration position ${JSON.stringify(p)}. Line ${p.line} length: ${line.length}`);
					return {
						...p,
						character,
						offset: converter.posToIndex(p.line, character)
					};
				}
			}
			const decorations = (shiki.options.decorations || []).map((d) => ({
				...d,
				start: normalizePosition(d.start),
				end: normalizePosition(d.end)
			}));
			verifyIntersections(decorations);
			map.set(shiki.meta, {
				decorations,
				converter,
				source: shiki.source
			});
		}
		return map.get(shiki.meta);
	}
	return {
		name: "shiki:decorations",
		tokens(tokens) {
			if (!this.options.decorations?.length) return;
			return splitTokens(tokens, getContext(this).decorations.flatMap((d) => [d.start.offset, d.end.offset]));
		},
		code(codeEl) {
			if (!this.options.decorations?.length) return;
			const ctx = getContext(this);
			const lines = [...codeEl.children].filter((i) => i.type === "element" && i.tagName === "span");
			if (lines.length !== ctx.converter.lines.length) throw new ShikiError$1(`Number of lines in code element (${lines.length}) does not match the number of lines in the source (${ctx.converter.lines.length}). Failed to apply decorations.`);
			function applyLineSection(line, start, end, decoration) {
				const lineEl = lines[line];
				let text = "";
				let startIndex = -1;
				let endIndex = -1;
				if (start === 0) startIndex = 0;
				if (end === 0) endIndex = 0;
				if (end === Number.POSITIVE_INFINITY) endIndex = lineEl.children.length;
				if (startIndex === -1 || endIndex === -1) for (let i = 0; i < lineEl.children.length; i++) {
					text += stringify(lineEl.children[i]);
					if (startIndex === -1 && text.length === start) startIndex = i + 1;
					if (endIndex === -1 && text.length === end) endIndex = i + 1;
				}
				if (startIndex === -1) throw new ShikiError$1(`Failed to find start index for decoration ${JSON.stringify(decoration.start)}`);
				if (endIndex === -1) throw new ShikiError$1(`Failed to find end index for decoration ${JSON.stringify(decoration.end)}`);
				const children = lineEl.children.slice(startIndex, endIndex);
				if (!decoration.alwaysWrap && children.length === lineEl.children.length) applyDecoration(lineEl, decoration, "line");
				else if (!decoration.alwaysWrap && children.length === 1 && children[0].type === "element") applyDecoration(children[0], decoration, "token");
				else {
					const wrapper = {
						type: "element",
						tagName: "span",
						properties: {},
						children
					};
					applyDecoration(wrapper, decoration, "wrapper");
					lineEl.children.splice(startIndex, children.length, wrapper);
				}
			}
			function applyLine(line, decoration) {
				lines[line] = applyDecoration(lines[line], decoration, "line");
			}
			function applyDecoration(el, decoration, type) {
				const properties = decoration.properties || {};
				const transform = decoration.transform || ((i) => i);
				el.tagName = decoration.tagName || "span";
				el.properties = {
					...el.properties,
					...properties,
					class: el.properties.class
				};
				if (decoration.properties?.class) addClassToHast(el, decoration.properties.class);
				el = transform(el, type) || el;
				return el;
			}
			const lineApplies = [];
			const sorted = ctx.decorations.sort((a, b) => b.start.offset - a.start.offset || a.end.offset - b.end.offset);
			for (const decoration of sorted) {
				const { start, end } = decoration;
				if (start.line === end.line) applyLineSection(start.line, start.character, end.character, decoration);
				else if (start.line < end.line) {
					applyLineSection(start.line, start.character, Number.POSITIVE_INFINITY, decoration);
					for (let i = start.line + 1; i < end.line; i++) lineApplies.unshift(() => applyLine(i, decoration));
					applyLineSection(end.line, 0, end.character, decoration);
				}
			}
			lineApplies.forEach((i) => i());
		}
	};
}
function verifyIntersections(items) {
	for (let i = 0; i < items.length; i++) {
		const foo = items[i];
		if (foo.start.offset > foo.end.offset) throw new ShikiError$1(`Invalid decoration range: ${JSON.stringify(foo.start)} - ${JSON.stringify(foo.end)}`);
		for (let j = i + 1; j < items.length; j++) {
			const bar = items[j];
			const isFooHasBarStart = foo.start.offset <= bar.start.offset && bar.start.offset < foo.end.offset;
			const isFooHasBarEnd = foo.start.offset < bar.end.offset && bar.end.offset <= foo.end.offset;
			const isBarHasFooStart = bar.start.offset <= foo.start.offset && foo.start.offset < bar.end.offset;
			const isBarHasFooEnd = bar.start.offset < foo.end.offset && foo.end.offset <= bar.end.offset;
			if (isFooHasBarStart || isFooHasBarEnd || isBarHasFooStart || isBarHasFooEnd) {
				if (isFooHasBarStart && isFooHasBarEnd) continue;
				if (isBarHasFooStart && isBarHasFooEnd) continue;
				if (isBarHasFooStart && foo.start.offset === foo.end.offset) continue;
				if (isFooHasBarEnd && bar.start.offset === bar.end.offset) continue;
				throw new ShikiError$1(`Decorations ${JSON.stringify(foo.start)} and ${JSON.stringify(bar.start)} intersect.`);
			}
		}
	}
}
function stringify(el) {
	if (el.type === "text") return el.value;
	if (el.type === "element") return el.children.map(stringify).join("");
	return "";
}
//#endregion
//#region src/highlight/_get-transformers.ts
const builtInTransformers = [/* @__PURE__ */ transformerDecorations()];
function getTransformers(options) {
	const transformers = sortTransformersByEnforcement(options.transformers || []);
	return [
		...transformers.pre,
		...transformers.normal,
		...transformers.post,
		...builtInTransformers
	];
}
function sortTransformersByEnforcement(transformers) {
	const pre = [];
	const post = [];
	const normal = [];
	for (const transformer of transformers) switch (transformer.enforce) {
		case "pre":
			pre.push(transformer);
			break;
		case "post":
			post.push(transformer);
			break;
		default: normal.push(transformer);
	}
	return {
		pre,
		post,
		normal
	};
}
//#endregion
//#region ../../node_modules/.pnpm/ansi-sequence-parser@1.1.3/node_modules/ansi-sequence-parser/dist/index.js
var namedColors = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite"
];
var decorations = {
	1: "bold",
	2: "dim",
	3: "italic",
	4: "underline",
	7: "reverse",
	8: "hidden",
	9: "strikethrough"
};
function findSequence(value, position) {
	const nextEscape = value.indexOf("\x1B", position);
	if (nextEscape !== -1) {
		if (value[nextEscape + 1] === "[") {
			const nextClose = value.indexOf("m", nextEscape);
			if (nextClose !== -1) return {
				sequence: value.substring(nextEscape + 2, nextClose).split(";"),
				startPosition: nextEscape,
				position: nextClose + 1
			};
		}
	}
	return { position: value.length };
}
function parseColor(sequence) {
	const colorMode = sequence.shift();
	if (colorMode === "2") {
		const rgb = sequence.splice(0, 3).map((x) => Number.parseInt(x));
		if (rgb.length !== 3 || rgb.some((x) => Number.isNaN(x))) return;
		return {
			type: "rgb",
			rgb
		};
	} else if (colorMode === "5") {
		const index = sequence.shift();
		if (index) return {
			type: "table",
			index: Number(index)
		};
	}
}
function parseSequence(sequence) {
	const commands = [];
	while (sequence.length > 0) {
		const code = sequence.shift();
		if (!code) continue;
		const codeInt = Number.parseInt(code);
		if (Number.isNaN(codeInt)) continue;
		if (codeInt === 0) commands.push({ type: "resetAll" });
		else if (codeInt <= 9) {
			if (decorations[codeInt]) commands.push({
				type: "setDecoration",
				value: decorations[codeInt]
			});
		} else if (codeInt <= 29) {
			const decoration = decorations[codeInt - 20];
			if (decoration) {
				commands.push({
					type: "resetDecoration",
					value: decoration
				});
				if (decoration === "dim") commands.push({
					type: "resetDecoration",
					value: "bold"
				});
			}
		} else if (codeInt <= 37) commands.push({
			type: "setForegroundColor",
			value: {
				type: "named",
				name: namedColors[codeInt - 30]
			}
		});
		else if (codeInt === 38) {
			const color = parseColor(sequence);
			if (color) commands.push({
				type: "setForegroundColor",
				value: color
			});
		} else if (codeInt === 39) commands.push({ type: "resetForegroundColor" });
		else if (codeInt <= 47) commands.push({
			type: "setBackgroundColor",
			value: {
				type: "named",
				name: namedColors[codeInt - 40]
			}
		});
		else if (codeInt === 48) {
			const color = parseColor(sequence);
			if (color) commands.push({
				type: "setBackgroundColor",
				value: color
			});
		} else if (codeInt === 49) commands.push({ type: "resetBackgroundColor" });
		else if (codeInt === 53) commands.push({
			type: "setDecoration",
			value: "overline"
		});
		else if (codeInt === 55) commands.push({
			type: "resetDecoration",
			value: "overline"
		});
		else if (codeInt >= 90 && codeInt <= 97) commands.push({
			type: "setForegroundColor",
			value: {
				type: "named",
				name: namedColors[codeInt - 90 + 8]
			}
		});
		else if (codeInt >= 100 && codeInt <= 107) commands.push({
			type: "setBackgroundColor",
			value: {
				type: "named",
				name: namedColors[codeInt - 100 + 8]
			}
		});
	}
	return commands;
}
function createAnsiSequenceParser() {
	let foreground = null;
	let background = null;
	let decorations2 = /* @__PURE__ */ new Set();
	return { parse(value) {
		const tokens = [];
		let position = 0;
		do {
			const findResult = findSequence(value, position);
			const text = findResult.sequence ? value.substring(position, findResult.startPosition) : value.substring(position);
			if (text.length > 0) tokens.push({
				value: text,
				foreground,
				background,
				decorations: new Set(decorations2)
			});
			if (findResult.sequence) {
				const commands = parseSequence(findResult.sequence);
				for (const styleToken of commands) if (styleToken.type === "resetAll") {
					foreground = null;
					background = null;
					decorations2.clear();
				} else if (styleToken.type === "resetForegroundColor") foreground = null;
				else if (styleToken.type === "resetBackgroundColor") background = null;
				else if (styleToken.type === "resetDecoration") decorations2.delete(styleToken.value);
				for (const styleToken of commands) if (styleToken.type === "setForegroundColor") foreground = styleToken.value;
				else if (styleToken.type === "setBackgroundColor") background = styleToken.value;
				else if (styleToken.type === "setDecoration") decorations2.add(styleToken.value);
			}
			position = findResult.position;
		} while (position < value.length);
		return tokens;
	} };
}
var defaultNamedColorsMap = {
	black: "#000000",
	red: "#bb0000",
	green: "#00bb00",
	yellow: "#bbbb00",
	blue: "#0000bb",
	magenta: "#ff00ff",
	cyan: "#00bbbb",
	white: "#eeeeee",
	brightBlack: "#555555",
	brightRed: "#ff5555",
	brightGreen: "#00ff00",
	brightYellow: "#ffff55",
	brightBlue: "#5555ff",
	brightMagenta: "#ff55ff",
	brightCyan: "#55ffff",
	brightWhite: "#ffffff"
};
function createColorPalette(namedColorsMap = defaultNamedColorsMap) {
	function namedColor(name) {
		return namedColorsMap[name];
	}
	function rgbColor(rgb) {
		return `#${rgb.map((x) => Math.max(0, Math.min(x, 255)).toString(16).padStart(2, "0")).join("")}`;
	}
	let colorTable;
	function getColorTable() {
		if (colorTable) return colorTable;
		colorTable = [];
		for (let i = 0; i < namedColors.length; i++) colorTable.push(namedColor(namedColors[i]));
		let levels = [
			0,
			95,
			135,
			175,
			215,
			255
		];
		for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) colorTable.push(rgbColor([
			levels[r],
			levels[g],
			levels[b]
		]));
		let level = 8;
		for (let i = 0; i < 24; i++, level += 10) colorTable.push(rgbColor([
			level,
			level,
			level
		]));
		return colorTable;
	}
	function tableColor(index) {
		return getColorTable()[index];
	}
	function value(color) {
		switch (color.type) {
			case "named": return namedColor(color.name);
			case "rgb": return rgbColor(color.rgb);
			case "table": return tableColor(color.index);
		}
	}
	return { value };
}
//#endregion
//#region src/highlight/code-to-tokens-ansi.ts
const RE_HEX_COLOR = /#([0-9a-f]{3,8})/i;
const RE_CSS_VAR_ANSI = /var\((--[\w-]+-ansi-[\w-]+)\)/;
/**
* Default ANSI palette (VSCode compatible fallbacks)
* Used when the theme does not define terminal.ansi* colors.
*/
const defaultAnsiColors = {
	black: "#000000",
	red: "#cd3131",
	green: "#0DBC79",
	yellow: "#E5E510",
	blue: "#2472C8",
	magenta: "#BC3FBC",
	cyan: "#11A8CD",
	white: "#E5E5E5",
	brightBlack: "#666666",
	brightRed: "#F14C4C",
	brightGreen: "#23D18B",
	brightYellow: "#F5F543",
	brightBlue: "#3B8EEA",
	brightMagenta: "#D670D6",
	brightCyan: "#29B8DB",
	brightWhite: "#FFFFFF"
};
function tokenizeAnsiWithTheme(theme, fileContents, options) {
	const colorReplacements = resolveColorReplacements(theme, options);
	const lines = splitLines(fileContents);
	const colorPalette = createColorPalette(Object.fromEntries(namedColors.map((name) => {
		const key = `terminal.ansi${name[0].toUpperCase()}${name.substring(1)}`;
		return [name, theme.colors?.[key] || defaultAnsiColors[name]];
	})));
	const parser = createAnsiSequenceParser();
	return lines.map((line) => parser.parse(line[0]).map((token) => {
		let color;
		let bgColor;
		if (token.decorations.has("reverse")) {
			color = token.background ? colorPalette.value(token.background) : theme.bg;
			bgColor = token.foreground ? colorPalette.value(token.foreground) : theme.fg;
		} else {
			color = token.foreground ? colorPalette.value(token.foreground) : theme.fg;
			bgColor = token.background ? colorPalette.value(token.background) : void 0;
		}
		color = applyColorReplacements(color, colorReplacements);
		bgColor = applyColorReplacements(bgColor, colorReplacements);
		if (token.decorations.has("dim")) color = dimColor(color);
		let fontStyle = FontStyle.None;
		if (token.decorations.has("bold")) fontStyle |= FontStyle.Bold;
		if (token.decorations.has("italic")) fontStyle |= FontStyle.Italic;
		if (token.decorations.has("underline")) fontStyle |= FontStyle.Underline;
		if (token.decorations.has("strikethrough")) fontStyle |= FontStyle.Strikethrough;
		return {
			content: token.value,
			offset: line[1],
			color,
			bgColor,
			fontStyle
		};
	}));
}
/**
* Adds 50% alpha to a hex color string or the "-dim" postfix to a CSS variable
*/
function dimColor(color) {
	const hexMatch = color.match(RE_HEX_COLOR);
	if (hexMatch) {
		const hex = hexMatch[1];
		if (hex.length === 8) {
			const alpha = Math.round(Number.parseInt(hex.slice(6, 8), 16) / 2).toString(16).padStart(2, "0");
			return `#${hex.slice(0, 6)}${alpha}`;
		} else if (hex.length === 6) return `#${hex}80`;
		else if (hex.length === 4) {
			const r = hex[0];
			const g = hex[1];
			const b = hex[2];
			const a = hex[3];
			return `#${r}${r}${g}${g}${b}${b}${Math.round(Number.parseInt(`${a}${a}`, 16) / 2).toString(16).padStart(2, "0")}`;
		} else if (hex.length === 3) {
			const r = hex[0];
			const g = hex[1];
			const b = hex[2];
			return `#${r}${r}${g}${g}${b}${b}80`;
		}
	}
	const cssVarMatch = color.match(RE_CSS_VAR_ANSI);
	if (cssVarMatch) return `var(${cssVarMatch[1]}-dim)`;
	return color;
}
//#endregion
//#region src/highlight/code-to-tokens-base.ts
/**
* Code to tokens, with a simple theme.
* This wraps the tokenizer's implementation to add ANSI support.
*/
function codeToTokensBase(primitive, code, options = {}) {
	const lang = primitive.resolveLangAlias(options.lang || "text");
	const { theme: themeName = primitive.getLoadedThemes()[0] } = options;
	if (!isPlainLang(lang) && !isNoneTheme(themeName) && lang === "ansi") {
		const { theme } = primitive.setTheme(themeName);
		return tokenizeAnsiWithTheme(theme, code, options);
	}
	return codeToTokensBase$1(primitive, code, options);
}
//#endregion
//#region src/highlight/code-to-tokens.ts
/**
* High-level code-to-tokens API.
*
* It will use `codeToTokensWithThemes` or `codeToTokensBase` based on the options.
*/
function codeToTokens(primitive, code, options) {
	let bg;
	let fg;
	let tokens;
	let themeName;
	let rootStyle;
	let grammarState;
	if ("themes" in options) {
		const { defaultColor = "light", cssVariablePrefix = "--shiki-", colorsRendering = "css-vars" } = options;
		const themes = Object.entries(options.themes).filter((i) => i[1]).map((i) => ({
			color: i[0],
			theme: i[1]
		})).sort((a, b) => a.color === defaultColor ? -1 : b.color === defaultColor ? 1 : 0);
		if (themes.length === 0) throw new ShikiError$1("`themes` option must not be empty");
		const themeTokens = codeToTokensWithThemes$1(primitive, code, options, codeToTokensBase);
		grammarState = getLastGrammarStateFromMap(themeTokens);
		if (defaultColor && "light-dark()" !== defaultColor && !themes.some((t) => t.color === defaultColor)) throw new ShikiError$1(`\`themes\` option must contain the defaultColor key \`${defaultColor}\``);
		const themeRegs = themes.map((t) => primitive.getTheme(t.theme));
		const themesOrder = themes.map((t) => t.color);
		tokens = themeTokens.map((line) => line.map((token) => flatTokenVariants(token, themesOrder, cssVariablePrefix, defaultColor, colorsRendering)));
		if (grammarState) setLastGrammarStateToMap(tokens, grammarState);
		const themeColorReplacements = themes.map((t) => resolveColorReplacements(t.theme, options));
		fg = mapThemeColors(themes, themeRegs, themeColorReplacements, cssVariablePrefix, defaultColor, "fg", colorsRendering);
		bg = mapThemeColors(themes, themeRegs, themeColorReplacements, cssVariablePrefix, defaultColor, "bg", colorsRendering);
		themeName = `shiki-themes ${themeRegs.map((t) => t.name).join(" ")}`;
		rootStyle = defaultColor ? void 0 : [fg, bg].join(";");
	} else if ("theme" in options) {
		const colorReplacements = resolveColorReplacements(options.theme, options);
		tokens = codeToTokensBase(primitive, code, options);
		const _theme = primitive.getTheme(options.theme);
		bg = applyColorReplacements(_theme.bg, colorReplacements);
		fg = applyColorReplacements(_theme.fg, colorReplacements);
		themeName = _theme.name;
		grammarState = getLastGrammarStateFromMap(tokens);
	} else throw new ShikiError$1("Invalid options, either `theme` or `themes` must be provided");
	return {
		tokens,
		fg,
		bg,
		themeName,
		rootStyle,
		grammarState
	};
}
function mapThemeColors(themes, themeRegs, themeColorReplacements, cssVariablePrefix, defaultColor, property, colorsRendering) {
	return themes.map((t, idx) => {
		const value = applyColorReplacements(themeRegs[idx][property], themeColorReplacements[idx]) || "inherit";
		const cssVar = `${cssVariablePrefix + t.color}${property === "bg" ? "-bg" : ""}:${value}`;
		if (idx === 0 && defaultColor) {
			if (defaultColor === "light-dark()" && themes.length > 1) {
				const lightIndex = themes.findIndex((t) => t.color === "light");
				const darkIndex = themes.findIndex((t) => t.color === "dark");
				if (lightIndex === -1 || darkIndex === -1) throw new ShikiError$1("When using `defaultColor: \"light-dark()\"`, you must provide both `light` and `dark` themes");
				return `light-dark(${applyColorReplacements(themeRegs[lightIndex][property], themeColorReplacements[lightIndex]) || "inherit"}, ${applyColorReplacements(themeRegs[darkIndex][property], themeColorReplacements[darkIndex]) || "inherit"});${cssVar}`;
			}
			return value;
		}
		if (colorsRendering === "css-vars") return cssVar;
		return null;
	}).filter((i) => !!i).join(";");
}
//#endregion
//#region src/highlight/code-to-hast.ts
const RE_WHITESPACE_ONLY = /^\s+$/;
const RE_LEADING_TRAILING_WHITESPACE = /^(\s*)(.*?)(\s*)$/;
function codeToHast(primitive, code, options, transformerContext = {
	meta: {},
	options,
	codeToHast: (_code, _options) => codeToHast(primitive, _code, _options),
	codeToTokens: (_code, _options) => codeToTokens(primitive, _code, _options)
}) {
	let input = code;
	for (const transformer of getTransformers(options)) input = transformer.preprocess?.call(transformerContext, input, options) || input;
	let { tokens, fg, bg, themeName, rootStyle, grammarState } = codeToTokens(primitive, input, options);
	const { mergeWhitespaces = true, mergeSameStyleTokens = false } = options;
	if (mergeWhitespaces === true) tokens = mergeWhitespaceTokens(tokens);
	else if (mergeWhitespaces === "never") tokens = splitWhitespaceTokens(tokens);
	if (mergeSameStyleTokens) tokens = mergeAdjacentStyledTokens(tokens);
	const contextSource = {
		...transformerContext,
		get source() {
			return input;
		}
	};
	for (const transformer of getTransformers(options)) tokens = transformer.tokens?.call(contextSource, tokens) || tokens;
	return tokensToHast(tokens, {
		...options,
		fg,
		bg,
		themeName,
		rootStyle: options.rootStyle === false ? false : options.rootStyle ?? rootStyle
	}, contextSource, grammarState);
}
function tokensToHast(tokens, options, transformerContext, grammarState = getLastGrammarStateFromMap(tokens)) {
	const transformers = getTransformers(options);
	const lines = [];
	const root = {
		type: "root",
		children: []
	};
	const { structure = "classic", tabindex = "0" } = options;
	const properties = { class: `shiki ${options.themeName || ""}` };
	if (options.rootStyle !== false) if (options.rootStyle != null) properties.style = options.rootStyle;
	else properties.style = `background-color:${options.bg};color:${options.fg}`;
	if (tabindex !== false && tabindex != null) properties.tabindex = tabindex.toString();
	for (const [key, value] of Object.entries(options.meta || {})) if (!key.startsWith("_")) properties[key] = value;
	let preNode = {
		type: "element",
		tagName: "pre",
		properties,
		children: [],
		data: options.data
	};
	let codeNode = {
		type: "element",
		tagName: "code",
		properties: {},
		children: lines
	};
	const lineNodes = [];
	const context = {
		...transformerContext,
		structure,
		addClassToHast,
		get source() {
			return transformerContext.source;
		},
		get tokens() {
			return tokens;
		},
		get options() {
			return options;
		},
		get root() {
			return root;
		},
		get pre() {
			return preNode;
		},
		get code() {
			return codeNode;
		},
		get lines() {
			return lineNodes;
		}
	};
	tokens.forEach((line, idx) => {
		if (idx) {
			if (structure === "inline") root.children.push({
				type: "element",
				tagName: "br",
				properties: {},
				children: []
			});
			else if (structure === "classic") lines.push({
				type: "text",
				value: "\n"
			});
		}
		let lineNode = {
			type: "element",
			tagName: "span",
			properties: { class: "line" },
			children: []
		};
		let col = 0;
		for (const token of line) {
			let tokenNode = {
				type: "element",
				tagName: "span",
				properties: { ...token.htmlAttrs },
				children: [{
					type: "text",
					value: token.content
				}]
			};
			const style = stringifyTokenStyle(token.htmlStyle || getTokenStyleObject(token));
			if (style) tokenNode.properties.style = style;
			for (const transformer of transformers) tokenNode = transformer?.span?.call(context, tokenNode, idx + 1, col, lineNode, token) || tokenNode;
			if (structure === "inline") root.children.push(tokenNode);
			else if (structure === "classic") lineNode.children.push(tokenNode);
			col += token.content.length;
		}
		if (structure === "classic") {
			for (const transformer of transformers) lineNode = transformer?.line?.call(context, lineNode, idx + 1) || lineNode;
			lineNodes.push(lineNode);
			lines.push(lineNode);
		} else if (structure === "inline") lineNodes.push(lineNode);
	});
	if (structure === "classic") {
		for (const transformer of transformers) codeNode = transformer?.code?.call(context, codeNode) || codeNode;
		preNode.children.push(codeNode);
		for (const transformer of transformers) preNode = transformer?.pre?.call(context, preNode) || preNode;
		root.children.push(preNode);
	} else if (structure === "inline") {
		const syntheticLines = [];
		let currentLine = {
			type: "element",
			tagName: "span",
			properties: { class: "line" },
			children: []
		};
		for (const child of root.children) if (child.type === "element" && child.tagName === "br") {
			syntheticLines.push(currentLine);
			currentLine = {
				type: "element",
				tagName: "span",
				properties: { class: "line" },
				children: []
			};
		} else if (child.type === "element" || child.type === "text") currentLine.children.push(child);
		syntheticLines.push(currentLine);
		let transformedCode = {
			type: "element",
			tagName: "code",
			properties: {},
			children: syntheticLines
		};
		for (const transformer of transformers) transformedCode = transformer?.code?.call(context, transformedCode) || transformedCode;
		root.children = [];
		for (let i = 0; i < transformedCode.children.length; i++) {
			if (i > 0) root.children.push({
				type: "element",
				tagName: "br",
				properties: {},
				children: []
			});
			const line = transformedCode.children[i];
			if (line.type === "element") root.children.push(...line.children);
		}
	}
	let result = root;
	for (const transformer of transformers) result = transformer?.root?.call(context, result) || result;
	if (grammarState) setLastGrammarStateToMap(result, grammarState);
	return result;
}
function mergeWhitespaceTokens(tokens) {
	return tokens.map((line) => {
		const newLine = [];
		let carryOnContent = "";
		let firstOffset;
		line.forEach((token, idx) => {
			const couldMerge = !(token.fontStyle && (token.fontStyle & FontStyle.Underline || token.fontStyle & FontStyle.Strikethrough));
			if (couldMerge && RE_WHITESPACE_ONLY.test(token.content) && line[idx + 1]) {
				if (firstOffset === void 0) firstOffset = token.offset;
				carryOnContent += token.content;
			} else if (carryOnContent) {
				if (couldMerge) newLine.push({
					...token,
					offset: firstOffset,
					content: carryOnContent + token.content
				});
				else newLine.push({
					content: carryOnContent,
					offset: firstOffset
				}, token);
				firstOffset = void 0;
				carryOnContent = "";
			} else newLine.push(token);
		});
		return newLine;
	});
}
function splitWhitespaceTokens(tokens) {
	return tokens.map((line) => {
		return line.flatMap((token) => {
			if (RE_WHITESPACE_ONLY.test(token.content)) return token;
			const match = token.content.match(RE_LEADING_TRAILING_WHITESPACE);
			if (!match) return token;
			const [, leading, content, trailing] = match;
			if (!leading && !trailing) return token;
			const expanded = [{
				...token,
				offset: token.offset + leading.length,
				content
			}];
			if (leading) expanded.unshift({
				content: leading,
				offset: token.offset
			});
			if (trailing) expanded.push({
				content: trailing,
				offset: token.offset + leading.length + content.length
			});
			return expanded;
		});
	});
}
function mergeAdjacentStyledTokens(tokens) {
	return tokens.map((line) => {
		const newLine = [];
		for (const token of line) {
			if (newLine.length === 0) {
				newLine.push({ ...token });
				continue;
			}
			const prevToken = newLine.at(-1);
			const prevStyle = stringifyTokenStyle(prevToken.htmlStyle || getTokenStyleObject(prevToken));
			const currentStyle = stringifyTokenStyle(token.htmlStyle || getTokenStyleObject(token));
			const isPrevDecorated = prevToken.fontStyle && (prevToken.fontStyle & FontStyle.Underline || prevToken.fontStyle & FontStyle.Strikethrough);
			const isDecorated = token.fontStyle && (token.fontStyle & FontStyle.Underline || token.fontStyle & FontStyle.Strikethrough);
			if (!isPrevDecorated && !isDecorated && prevStyle === currentStyle) prevToken.content += token.content;
			else newLine.push({ ...token });
		}
		return newLine;
	});
}
//#endregion
//#region src/highlight/code-to-html.ts
const hastToHtml = toHtml;
/**
* Get highlighted code in HTML.
*/
function codeToHtml(primitive, code, options) {
	const context = {
		meta: {},
		options,
		codeToHast: (_code, _options) => codeToHast(primitive, _code, _options),
		codeToTokens: (_code, _options) => codeToTokens(primitive, _code, _options)
	};
	let result = hastToHtml(codeToHast(primitive, code, options, context));
	for (const transformer of getTransformers(options)) result = transformer.postprocess?.call(context, result, options) || result;
	return result;
}
//#endregion
//#region src/constructors/highlighter.ts
/**
* Create a Shiki core highlighter instance, with no languages or themes bundled.
* Wasm and each language and theme must be loaded manually.
*
* @see http://shiki.style/guide/bundles#fine-grained-bundle
*/
async function createHighlighterCore(options) {
	const primitive = await createShikiPrimitiveAsync$1(options);
	return {
		getLastGrammarState: (...args) => getLastGrammarState(primitive, ...args),
		codeToTokensBase: (code, options) => codeToTokensBase(primitive, code, options),
		codeToTokensWithThemes: (code, options) => codeToTokensWithThemes$1(primitive, code, options),
		codeToTokens: (code, options) => codeToTokens(primitive, code, options),
		codeToHast: (code, options) => codeToHast(primitive, code, options),
		codeToHtml: (code, options) => codeToHtml(primitive, code, options),
		getBundledLanguages: () => ({}),
		getBundledThemes: () => ({}),
		...primitive,
		getInternalContext: () => primitive
	};
}
/**
* Create a Shiki core highlighter instance, with no languages or themes bundled.
* Wasm and each language and theme must be loaded manually.
*
* Synchronous version of `createHighlighterCore`, which requires to provide the engine and all themes and languages upfront.
*
* @see http://shiki.style/guide/bundles#fine-grained-bundle
*/
function createHighlighterCoreSync(options) {
	const internal = createShikiPrimitive$1(options);
	return {
		getLastGrammarState: (...args) => getLastGrammarState(internal, ...args),
		codeToTokensBase: (code, options) => codeToTokensBase(internal, code, options),
		codeToTokensWithThemes: (code, options) => codeToTokensWithThemes$1(internal, code, options),
		codeToTokens: (code, options) => codeToTokens(internal, code, options),
		codeToHast: (code, options) => codeToHast(internal, code, options),
		codeToHtml: (code, options) => codeToHtml(internal, code, options),
		getBundledLanguages: () => ({}),
		getBundledThemes: () => ({}),
		...internal,
		getInternalContext: () => internal
	};
}
function makeSingletonHighlighterCore(createHighlighter) {
	let _shiki;
	async function getSingletonHighlighterCore(options) {
		if (!_shiki) {
			_shiki = createHighlighter({
				...options,
				themes: options.themes || [],
				langs: options.langs || []
			});
			return _shiki;
		} else {
			const s = await _shiki;
			await Promise.all([s.loadTheme(...options.themes || []), s.loadLanguage(...options.langs || [])]);
			return s;
		}
	}
	return getSingletonHighlighterCore;
}
const getSingletonHighlighterCore = /* @__PURE__ */ makeSingletonHighlighterCore(createHighlighterCore);
//#endregion
//#region src/constructors/bundle-factory.ts
function createBundledHighlighter(options) {
	const bundledLanguages = options.langs;
	const bundledThemes = options.themes;
	const engine = options.engine;
	async function createHighlighter(options) {
		function resolveLang(lang) {
			if (typeof lang === "string") {
				lang = options.langAlias?.[lang] || lang;
				if (isSpecialLang(lang)) return [];
				const bundle = bundledLanguages[lang];
				if (!bundle) throw new ShikiError$1(`Language \`${lang}\` is not included in this bundle. You may want to load it from external source.`);
				return bundle;
			}
			return lang;
		}
		function resolveTheme(theme) {
			if (isSpecialTheme(theme)) return "none";
			if (typeof theme === "string") {
				const bundle = bundledThemes[theme];
				if (!bundle) throw new ShikiError$1(`Theme \`${theme}\` is not included in this bundle. You may want to load it from external source.`);
				return bundle;
			}
			return theme;
		}
		const _themes = (options.themes ?? []).map((i) => resolveTheme(i));
		const langs = (options.langs ?? []).map((i) => resolveLang(i));
		const core = await createHighlighterCore({
			engine: options.engine ?? engine(),
			...options,
			themes: _themes,
			langs
		});
		return {
			...core,
			loadLanguage(...langs) {
				return core.loadLanguage(...langs.map(resolveLang));
			},
			loadTheme(...themes) {
				return core.loadTheme(...themes.map(resolveTheme));
			},
			getBundledLanguages() {
				return bundledLanguages;
			},
			getBundledThemes() {
				return bundledThemes;
			}
		};
	}
	return createHighlighter;
}
function makeSingletonHighlighter(createHighlighter) {
	let _shiki;
	async function getSingletonHighlighter(options = {}) {
		if (!_shiki) {
			_shiki = createHighlighter({
				...options,
				themes: [],
				langs: []
			});
			const s = await _shiki;
			await Promise.all([s.loadTheme(...options.themes || []), s.loadLanguage(...options.langs || [])]);
			return s;
		} else {
			const s = await _shiki;
			await Promise.all([s.loadTheme(...options.themes || []), s.loadLanguage(...options.langs || [])]);
			return s;
		}
	}
	return getSingletonHighlighter;
}
function createSingletonShorthands(createHighlighter, config) {
	const getSingletonHighlighter = makeSingletonHighlighter(createHighlighter);
	async function get(code, options) {
		const shiki = await getSingletonHighlighter({
			langs: [options.lang],
			themes: "theme" in options ? [options.theme] : Object.values(options.themes)
		});
		const langs = await config?.guessEmbeddedLanguages?.(code, options.lang, shiki);
		if (langs) await shiki.loadLanguage(...langs);
		return shiki;
	}
	return {
		getSingletonHighlighter(options) {
			return getSingletonHighlighter(options);
		},
		async codeToHtml(code, options) {
			return (await get(code, options)).codeToHtml(code, options);
		},
		async codeToHast(code, options) {
			return (await get(code, options)).codeToHast(code, options);
		},
		async codeToTokens(code, options) {
			return (await get(code, options)).codeToTokens(code, options);
		},
		async codeToTokensBase(code, options) {
			return (await get(code, options)).codeToTokensBase(code, options);
		},
		async codeToTokensWithThemes(code, options) {
			return (await get(code, options)).codeToTokensWithThemes(code, options);
		},
		async getLastGrammarState(code, options) {
			return (await getSingletonHighlighter({
				langs: [options.lang],
				themes: [options.theme]
			})).getLastGrammarState(code, options);
		}
	};
}
//#endregion
//#region src/theme-css-variables.ts
/**
* A factory function to create a css-variable-based theme
*
* @see https://shiki.style/guide/theme-colors#css-variables-theme
*/
function createCssVariablesTheme(options = {}) {
	const { name = "css-variables", variablePrefix = "--shiki-", fontStyle = true } = options;
	const variable = (name) => {
		if (options.variableDefaults?.[name]) return `var(${variablePrefix}${name}, ${options.variableDefaults[name]})`;
		return `var(${variablePrefix}${name})`;
	};
	const theme = {
		name,
		type: "dark",
		colors: {
			"editor.foreground": variable("foreground"),
			"editor.background": variable("background"),
			"terminal.ansiBlack": variable("ansi-black"),
			"terminal.ansiRed": variable("ansi-red"),
			"terminal.ansiGreen": variable("ansi-green"),
			"terminal.ansiYellow": variable("ansi-yellow"),
			"terminal.ansiBlue": variable("ansi-blue"),
			"terminal.ansiMagenta": variable("ansi-magenta"),
			"terminal.ansiCyan": variable("ansi-cyan"),
			"terminal.ansiWhite": variable("ansi-white"),
			"terminal.ansiBrightBlack": variable("ansi-bright-black"),
			"terminal.ansiBrightRed": variable("ansi-bright-red"),
			"terminal.ansiBrightGreen": variable("ansi-bright-green"),
			"terminal.ansiBrightYellow": variable("ansi-bright-yellow"),
			"terminal.ansiBrightBlue": variable("ansi-bright-blue"),
			"terminal.ansiBrightMagenta": variable("ansi-bright-magenta"),
			"terminal.ansiBrightCyan": variable("ansi-bright-cyan"),
			"terminal.ansiBrightWhite": variable("ansi-bright-white")
		},
		tokenColors: [
			{
				scope: [
					"keyword.operator.accessor",
					"meta.group.braces.round.function.arguments",
					"meta.template.expression",
					"markup.fenced_code meta.embedded.block"
				],
				settings: { foreground: variable("foreground") }
			},
			{
				scope: "emphasis",
				settings: { fontStyle: "italic" }
			},
			{
				scope: [
					"strong",
					"markup.heading.markdown",
					"markup.bold.markdown"
				],
				settings: { fontStyle: "bold" }
			},
			{
				scope: ["markup.italic.markdown"],
				settings: { fontStyle: "italic" }
			},
			{
				scope: "meta.link.inline.markdown",
				settings: {
					fontStyle: "underline",
					foreground: variable("token-link")
				}
			},
			{
				scope: [
					"string",
					"markup.fenced_code",
					"markup.inline"
				],
				settings: { foreground: variable("token-string") }
			},
			{
				scope: ["comment", "string.quoted.docstring.multi"],
				settings: { foreground: variable("token-comment") }
			},
			{
				scope: [
					"constant.numeric",
					"constant.language",
					"constant.other.placeholder",
					"constant.character.format.placeholder",
					"variable.language.this",
					"variable.other.object",
					"variable.other.class",
					"variable.other.constant",
					"meta.property-name",
					"meta.property-value",
					"support"
				],
				settings: { foreground: variable("token-constant") }
			},
			{
				scope: [
					"keyword",
					"storage.modifier",
					"storage.type",
					"storage.control.clojure",
					"entity.name.function.clojure",
					"entity.name.tag.yaml",
					"support.function.node",
					"support.type.property-name.json",
					"punctuation.separator.key-value",
					"punctuation.definition.template-expression"
				],
				settings: { foreground: variable("token-keyword") }
			},
			{
				scope: "variable.parameter.function",
				settings: { foreground: variable("token-parameter") }
			},
			{
				scope: [
					"support.function",
					"entity.name.type",
					"entity.other.inherited-class",
					"meta.function-call",
					"meta.instance.constructor",
					"entity.other.attribute-name",
					"entity.name.function",
					"constant.keyword.clojure"
				],
				settings: { foreground: variable("token-function") }
			},
			{
				scope: [
					"entity.name.tag",
					"string.quoted",
					"string.regexp",
					"string.interpolated",
					"string.template",
					"string.unquoted.plain.out.yaml",
					"keyword.other.template"
				],
				settings: { foreground: variable("token-string-expression") }
			},
			{
				scope: [
					"punctuation.definition.arguments",
					"punctuation.definition.dict",
					"punctuation.separator",
					"meta.function-call.arguments"
				],
				settings: { foreground: variable("token-punctuation") }
			},
			{
				scope: ["markup.underline.link", "punctuation.definition.metadata.markdown"],
				settings: { foreground: variable("token-link") }
			},
			{
				scope: ["beginning.punctuation.definition.list.markdown"],
				settings: { foreground: variable("token-string") }
			},
			{
				scope: [
					"punctuation.definition.string.begin.markdown",
					"punctuation.definition.string.end.markdown",
					"string.other.link.title.markdown",
					"string.other.link.description.markdown"
				],
				settings: { foreground: variable("token-keyword") }
			},
			{
				scope: [
					"markup.inserted",
					"meta.diff.header.to-file",
					"punctuation.definition.inserted"
				],
				settings: { foreground: variable("token-inserted") }
			},
			{
				scope: [
					"markup.deleted",
					"meta.diff.header.from-file",
					"punctuation.definition.deleted"
				],
				settings: { foreground: variable("token-deleted") }
			},
			{
				scope: ["markup.changed", "punctuation.definition.changed"],
				settings: { foreground: variable("token-changed") }
			}
		]
	};
	if (!fontStyle) theme.tokenColors = theme.tokenColors?.map((tokenColor) => {
		if (tokenColor.settings?.fontStyle) delete tokenColor.settings.fontStyle;
		return tokenColor;
	});
	return theme;
}
//#endregion
export { ShikiError, addClassToHast, applyColorReplacements, codeToHast, codeToHtml, codeToTokens, codeToTokensBase, codeToTokensWithThemes, createBundledHighlighter, createCssVariablesTheme, createHighlighterCore, createHighlighterCoreSync, createPositionConverter, createShikiInternal, createShikiInternalSync, createShikiPrimitive, createShikiPrimitiveAsync, createSingletonShorthands, flatTokenVariants, getLastGrammarState, getSingletonHighlighterCore, getTokenStyleObject, guessEmbeddedLanguages, hastToHtml, isNoneTheme, isPlainLang, isSpecialLang, isSpecialTheme, makeSingletonHighlighter, makeSingletonHighlighterCore, normalizeGetter, normalizeTheme, resolveColorReplacements, splitLines, splitToken, splitTokens, stringifyTokenStyle, toArray, tokenizeAnsiWithTheme, tokenizeWithTheme, tokensToHast, transformerDecorations };
