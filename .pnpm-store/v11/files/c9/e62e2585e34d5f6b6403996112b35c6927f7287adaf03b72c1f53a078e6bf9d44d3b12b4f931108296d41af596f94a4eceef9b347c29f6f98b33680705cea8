import { a as bundledLanguagesInfo, i as bundledLanguagesBase, n as bundledLanguages, r as bundledLanguagesAlias, t as BundledLanguage } from "./langs-bundle-full-B4n9xYHw.mjs";
import { n as bundledThemes, r as bundledThemesInfo, t as BundledTheme } from "./themes-BKdFAJ1v.mjs";
import "./core-CaxrMD1A.mjs";
import { HighlighterGeneric } from "@shikijs/types";
export * from "@shikijs/core";
//#region src/bundle-full.d.ts
type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;
/**
 * Initiate a highlighter instance and load the specified languages and themes.
 * Later it can be used synchronously to highlight code.
 *
 * Importing this function will bundle all languages and themes.
 * @see https://shiki.style/guide/bundles#shiki-bundle-full
 *
 * For granular control over the bundle, check:
 * @see https://shiki.style/guide/bundles#fine-grained-bundle
 */
declare const createHighlighter: import("@shikijs/types").CreateHighlighterFactory<BundledLanguage, BundledTheme>;
declare const codeToHtml: (code: string, options: import("@shikijs/types").CodeToHastOptions<BundledLanguage, BundledTheme>) => Promise<string>, codeToHast: (code: string, options: import("@shikijs/types").CodeToHastOptions<BundledLanguage, BundledTheme>) => Promise<import("hast").Root>, codeToTokens: (code: string, options: import("@shikijs/types").CodeToTokensOptions<BundledLanguage, BundledTheme>) => Promise<import("@shikijs/types").TokensResult>, codeToTokensBase: (code: string, options: import("@shikijs/types").RequireKeys<import("@shikijs/types").CodeToTokensBaseOptions<BundledLanguage, BundledTheme>, "theme" | "lang">) => Promise<import("@shikijs/types").ThemedToken[][]>, codeToTokensWithThemes: (code: string, options: import("@shikijs/types").RequireKeys<import("@shikijs/types").CodeToTokensWithThemesOptions<BundledLanguage, BundledTheme>, "lang" | "themes">) => Promise<import("@shikijs/types").ThemedTokenWithVariants[][]>, getSingletonHighlighter: (options?: Partial<import("@shikijs/types").BundledHighlighterOptions<BundledLanguage, BundledTheme>> | undefined) => Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>, getLastGrammarState: ((element: import("@shikijs/types").ThemedToken[][] | import("hast").Root) => import("@shikijs/types").GrammarState) | ((code: string, options: import("@shikijs/types").CodeToTokensBaseOptions<BundledLanguage, BundledTheme>) => Promise<import("@shikijs/types").GrammarState>);
//#endregion
export { BundledLanguage, BundledTheme, Highlighter, bundledLanguages, bundledLanguagesAlias, bundledLanguagesBase, bundledLanguagesInfo, bundledThemes, bundledThemesInfo, codeToHast, codeToHtml, codeToTokens, codeToTokensBase, codeToTokensWithThemes, createHighlighter, getLastGrammarState, getSingletonHighlighter };