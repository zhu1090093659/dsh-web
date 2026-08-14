import { n as bundledThemes, r as bundledThemesInfo, t as BundledTheme } from "./themes-BKdFAJ1v.mjs";
import "./core-CaxrMD1A.mjs";
import { BundledLanguageInfo, DynamicImportLanguageRegistration, HighlighterGeneric } from "@shikijs/types";
export * from "@shikijs/core";
//#region src/langs-bundle-web.d.ts
declare const bundledLanguagesInfo: BundledLanguageInfo[];
declare const bundledLanguagesBase: {
  [k: string]: DynamicImportLanguageRegistration;
};
declare const bundledLanguagesAlias: {
  [k: string]: DynamicImportLanguageRegistration;
};
type BundledLanguage = 'angular-html' | 'angular-ts' | 'astro' | 'bash' | 'blade' | 'c' | 'c++' | 'cjs' | 'coffee' | 'coffeescript' | 'cpp' | 'css' | 'csv' | 'cts' | 'glsl' | 'gql' | 'graphql' | 'haml' | 'handlebars' | 'hbs' | 'html' | 'html-derivative' | 'http' | 'hurl' | 'imba' | 'jade' | 'java' | 'javascript' | 'jinja' | 'jison' | 'jl' | 'js' | 'json' | 'json5' | 'jsonc' | 'jsonl' | 'jsx' | 'julia' | 'less' | 'lit' | 'markdown' | 'marko' | 'md' | 'mdc' | 'mdx' | 'mjs' | 'mts' | 'php' | 'postcss' | 'pug' | 'py' | 'python' | 'r' | 'regex' | 'regexp' | 'sass' | 'scss' | 'sh' | 'shell' | 'shellscript' | 'smithy' | 'sql' | 'styl' | 'stylus' | 'svelte' | 'ts' | 'ts-tags' | 'tsx' | 'typescript' | 'vue' | 'vue-html' | 'vue-vine' | 'wasm' | 'wgsl' | 'wit' | 'xml' | 'yaml' | 'yml' | 'zsh';
declare const bundledLanguages: Record<BundledLanguage, DynamicImportLanguageRegistration>;
//#endregion
//#region src/bundle-web.d.ts
type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;
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
declare const createHighlighter: import("@shikijs/types").CreateHighlighterFactory<BundledLanguage, BundledTheme>;
declare const codeToHtml: (code: string, options: import("@shikijs/types").CodeToHastOptions<BundledLanguage, BundledTheme>) => Promise<string>, codeToHast: (code: string, options: import("@shikijs/types").CodeToHastOptions<BundledLanguage, BundledTheme>) => Promise<import("hast").Root>, codeToTokensBase: (code: string, options: import("@shikijs/types").RequireKeys<import("@shikijs/types").CodeToTokensBaseOptions<BundledLanguage, BundledTheme>, "theme" | "lang">) => Promise<import("@shikijs/types").ThemedToken[][]>, codeToTokens: (code: string, options: import("@shikijs/types").CodeToTokensOptions<BundledLanguage, BundledTheme>) => Promise<import("@shikijs/types").TokensResult>, codeToTokensWithThemes: (code: string, options: import("@shikijs/types").RequireKeys<import("@shikijs/types").CodeToTokensWithThemesOptions<BundledLanguage, BundledTheme>, "lang" | "themes">) => Promise<import("@shikijs/types").ThemedTokenWithVariants[][]>, getSingletonHighlighter: (options?: Partial<import("@shikijs/types").BundledHighlighterOptions<BundledLanguage, BundledTheme>> | undefined) => Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>, getLastGrammarState: ((element: import("@shikijs/types").ThemedToken[][] | import("hast").Root) => import("@shikijs/types").GrammarState) | ((code: string, options: import("@shikijs/types").CodeToTokensBaseOptions<BundledLanguage, BundledTheme>) => Promise<import("@shikijs/types").GrammarState>);
//#endregion
export { BundledLanguage, BundledTheme, Highlighter, bundledLanguages, bundledLanguagesAlias, bundledLanguagesBase, bundledLanguagesInfo, bundledThemes, bundledThemesInfo, codeToHast, codeToHtml, codeToTokens, codeToTokensBase, codeToTokensWithThemes, createHighlighter, getLastGrammarState, getSingletonHighlighter };