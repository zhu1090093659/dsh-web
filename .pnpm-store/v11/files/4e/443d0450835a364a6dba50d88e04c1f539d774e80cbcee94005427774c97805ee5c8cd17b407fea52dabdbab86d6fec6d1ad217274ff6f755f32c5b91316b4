import "./rolldown-runtime-BBjsoOtd.mjs";
import { t as engine_oniguruma_exports } from "./engine-oniguruma.mjs";
import { bundledThemes, bundledThemesInfo } from "./themes.mjs";
import { createBundledHighlighter, createSingletonShorthands, guessEmbeddedLanguages } from "@shikijs/core";
export * from "@shikijs/core";
//#region src/langs-bundle-web.ts
const bundledLanguagesInfo = [
	{
		"id": "angular-html",
		"name": "Angular HTML",
		"import": (() => import("@shikijs/langs/angular-html"))
	},
	{
		"id": "angular-ts",
		"name": "Angular TypeScript",
		"import": (() => import("@shikijs/langs/angular-ts"))
	},
	{
		"id": "astro",
		"name": "Astro",
		"import": (() => import("@shikijs/langs/astro"))
	},
	{
		"id": "blade",
		"name": "Blade",
		"import": (() => import("@shikijs/langs/blade"))
	},
	{
		"id": "c",
		"name": "C",
		"import": (() => import("@shikijs/langs/c"))
	},
	{
		"id": "coffee",
		"name": "CoffeeScript",
		"aliases": ["coffeescript"],
		"import": (() => import("@shikijs/langs/coffee"))
	},
	{
		"id": "cpp",
		"name": "C++",
		"aliases": ["c++"],
		"import": (() => import("@shikijs/langs/cpp"))
	},
	{
		"id": "css",
		"name": "CSS",
		"import": (() => import("@shikijs/langs/css"))
	},
	{
		"id": "csv",
		"name": "CSV",
		"import": (() => import("@shikijs/langs/csv"))
	},
	{
		"id": "glsl",
		"name": "GLSL",
		"import": (() => import("@shikijs/langs/glsl"))
	},
	{
		"id": "graphql",
		"name": "GraphQL",
		"aliases": ["gql"],
		"import": (() => import("@shikijs/langs/graphql"))
	},
	{
		"id": "haml",
		"name": "Ruby Haml",
		"import": (() => import("@shikijs/langs/haml"))
	},
	{
		"id": "handlebars",
		"name": "Handlebars",
		"aliases": ["hbs"],
		"import": (() => import("@shikijs/langs/handlebars"))
	},
	{
		"id": "html",
		"name": "HTML",
		"import": (() => import("@shikijs/langs/html"))
	},
	{
		"id": "html-derivative",
		"name": "HTML (Derivative)",
		"import": (() => import("@shikijs/langs/html-derivative"))
	},
	{
		"id": "http",
		"name": "HTTP",
		"import": (() => import("@shikijs/langs/http"))
	},
	{
		"id": "hurl",
		"name": "Hurl",
		"import": (() => import("@shikijs/langs/hurl"))
	},
	{
		"id": "imba",
		"name": "Imba",
		"import": (() => import("@shikijs/langs/imba"))
	},
	{
		"id": "java",
		"name": "Java",
		"import": (() => import("@shikijs/langs/java"))
	},
	{
		"id": "javascript",
		"name": "JavaScript",
		"aliases": [
			"js",
			"cjs",
			"mjs"
		],
		"import": (() => import("@shikijs/langs/javascript"))
	},
	{
		"id": "jinja",
		"name": "Jinja",
		"import": (() => import("@shikijs/langs/jinja"))
	},
	{
		"id": "jison",
		"name": "Jison",
		"import": (() => import("@shikijs/langs/jison"))
	},
	{
		"id": "json",
		"name": "JSON",
		"import": (() => import("@shikijs/langs/json"))
	},
	{
		"id": "json5",
		"name": "JSON5",
		"import": (() => import("@shikijs/langs/json5"))
	},
	{
		"id": "jsonc",
		"name": "JSON with Comments",
		"import": (() => import("@shikijs/langs/jsonc"))
	},
	{
		"id": "jsonl",
		"name": "JSON Lines",
		"import": (() => import("@shikijs/langs/jsonl"))
	},
	{
		"id": "jsx",
		"name": "JSX",
		"import": (() => import("@shikijs/langs/jsx"))
	},
	{
		"id": "julia",
		"name": "Julia",
		"aliases": ["jl"],
		"import": (() => import("@shikijs/langs/julia"))
	},
	{
		"id": "less",
		"name": "Less",
		"import": (() => import("@shikijs/langs/less"))
	},
	{
		"id": "markdown",
		"name": "Markdown",
		"aliases": ["md"],
		"import": (() => import("@shikijs/langs/markdown"))
	},
	{
		"id": "marko",
		"name": "Marko",
		"import": (() => import("@shikijs/langs/marko"))
	},
	{
		"id": "mdc",
		"name": "MDC",
		"import": (() => import("@shikijs/langs/mdc"))
	},
	{
		"id": "mdx",
		"name": "MDX",
		"import": (() => import("@shikijs/langs/mdx"))
	},
	{
		"id": "php",
		"name": "PHP",
		"import": (() => import("@shikijs/langs/php"))
	},
	{
		"id": "postcss",
		"name": "PostCSS",
		"import": (() => import("@shikijs/langs/postcss"))
	},
	{
		"id": "pug",
		"name": "Pug",
		"aliases": ["jade"],
		"import": (() => import("@shikijs/langs/pug"))
	},
	{
		"id": "python",
		"name": "Python",
		"aliases": ["py"],
		"import": (() => import("@shikijs/langs/python"))
	},
	{
		"id": "r",
		"name": "R",
		"import": (() => import("@shikijs/langs/r"))
	},
	{
		"id": "regexp",
		"name": "RegExp",
		"aliases": ["regex"],
		"import": (() => import("@shikijs/langs/regexp"))
	},
	{
		"id": "sass",
		"name": "Sass",
		"import": (() => import("@shikijs/langs/sass"))
	},
	{
		"id": "scss",
		"name": "SCSS",
		"import": (() => import("@shikijs/langs/scss"))
	},
	{
		"id": "shellscript",
		"name": "Shell",
		"aliases": [
			"bash",
			"sh",
			"shell",
			"zsh"
		],
		"import": (() => import("@shikijs/langs/shellscript"))
	},
	{
		"id": "smithy",
		"name": "Smithy",
		"import": (() => import("@shikijs/langs/smithy"))
	},
	{
		"id": "sql",
		"name": "SQL",
		"import": (() => import("@shikijs/langs/sql"))
	},
	{
		"id": "stylus",
		"name": "Stylus",
		"aliases": ["styl"],
		"import": (() => import("@shikijs/langs/stylus"))
	},
	{
		"id": "svelte",
		"name": "Svelte",
		"import": (() => import("@shikijs/langs/svelte"))
	},
	{
		"id": "ts-tags",
		"name": "TypeScript with Tags",
		"aliases": ["lit"],
		"import": (() => import("@shikijs/langs/ts-tags"))
	},
	{
		"id": "tsx",
		"name": "TSX",
		"import": (() => import("@shikijs/langs/tsx"))
	},
	{
		"id": "typescript",
		"name": "TypeScript",
		"aliases": [
			"ts",
			"cts",
			"mts"
		],
		"import": (() => import("@shikijs/langs/typescript"))
	},
	{
		"id": "vue",
		"name": "Vue",
		"import": (() => import("@shikijs/langs/vue"))
	},
	{
		"id": "vue-html",
		"name": "Vue HTML",
		"import": (() => import("@shikijs/langs/vue-html"))
	},
	{
		"id": "vue-vine",
		"name": "Vue Vine",
		"import": (() => import("@shikijs/langs/vue-vine"))
	},
	{
		"id": "wasm",
		"name": "WebAssembly",
		"import": (() => import("@shikijs/langs/wasm"))
	},
	{
		"id": "wgsl",
		"name": "WGSL",
		"import": (() => import("@shikijs/langs/wgsl"))
	},
	{
		"id": "wit",
		"name": "WebAssembly Interface Types",
		"import": (() => import("@shikijs/langs/wit"))
	},
	{
		"id": "xml",
		"name": "XML",
		"import": (() => import("@shikijs/langs/xml"))
	},
	{
		"id": "yaml",
		"name": "YAML",
		"aliases": ["yml"],
		"import": (() => import("@shikijs/langs/yaml"))
	}
];
const bundledLanguagesBase = Object.fromEntries(bundledLanguagesInfo.map((i) => [i.id, i.import]));
const bundledLanguagesAlias = Object.fromEntries(bundledLanguagesInfo.flatMap((i) => i.aliases?.map((a) => [a, i.import]) || []));
const bundledLanguages = {
	...bundledLanguagesBase,
	...bundledLanguagesAlias
};
//#endregion
//#region src/bundle-web.ts
/**
* Initiate a highlighter instance and load the specified languages and themes.
* Later it can be used synchronously to highlight code.
*
* Importing this function will bundle all languages and themes.
* @see https://shiki.style/guide/bundles#shiki-bundle-web
*
* For granular control over the bundle, check:
* @see https://shiki.style/guide/bundles#fine-grained-bundle
*/
const createHighlighter = /* @__PURE__ */ createBundledHighlighter({
	langs: bundledLanguages,
	themes: bundledThemes,
	engine: () => (0, engine_oniguruma_exports.createOnigurumaEngine)(import("shiki/wasm"))
});
const { codeToHtml, codeToHast, codeToTokensBase, codeToTokens, codeToTokensWithThemes, getSingletonHighlighter, getLastGrammarState } = /* @__PURE__ */ createSingletonShorthands(createHighlighter, { guessEmbeddedLanguages });
//#endregion
export { bundledLanguages, bundledLanguagesAlias, bundledLanguagesBase, bundledLanguagesInfo, bundledThemes, bundledThemesInfo, codeToHast, codeToHtml, codeToTokens, codeToTokensBase, codeToTokensWithThemes, createHighlighter, getLastGrammarState, getSingletonHighlighter };
