import { Awaitable, BundledHighlighterOptions, CodeOptionsMultipleThemes, CodeToHastOptions, CodeToHastRenderOptions, CodeToTokensBaseOptions, CodeToTokensOptions, CodeToTokensWithThemesOptions, CreateBundledHighlighterOptions, CreateHighlighterFactory, GrammarState, HighlighterCore, HighlighterCoreOptions, HighlighterGeneric, Position, RequireKeys, ShikiPrimitive, ShikiTransformer, ShikiTransformerContextCommon, ShikiTransformerContextSource, ThemeRegistration, ThemeRegistrationResolved, ThemedToken, ThemedTokenWithVariants, TokenStyles, TokenizeWithThemeOptions, TokensResult } from "@shikijs/types";
import { ShikiError, applyColorReplacements, codeToTokensWithThemes, createShikiInternal, createShikiInternalSync, createShikiPrimitive, createShikiPrimitiveAsync, getLastGrammarState, isNoneTheme, isPlainLang, isSpecialLang, isSpecialTheme, normalizeGetter, normalizeTheme, resolveColorReplacements, splitLines, toArray, tokenizeWithTheme } from "@shikijs/primitive";
import { toHtml } from "hast-util-to-html";
import { Element, Root } from "hast";
export * from "@shikijs/types";
//#region src/constructors/bundle-factory.d.ts
/**
 * Create a `createHighlighter` function with bundled themes, languages, and engine.
 *
 * @example
 * ```ts
 * const createHighlighter = createBundledHighlighter({
 *   langs: {
 *     typescript: () => import('@shikijs/langs/typescript'),
 *     // ...
 *   },
 *   themes: {
 *     nord: () => import('@shikijs/themes/nord'),
 *     // ...
 *   },
 *   engine: () => createOnigurumaEngine(), // or createJavaScriptRegexEngine()
 * })
 * ```
 *
 * @param options
 */
declare function createBundledHighlighter<BundledLangs extends string, BundledThemes extends string>(options: CreateBundledHighlighterOptions<BundledLangs, BundledThemes>): CreateHighlighterFactory<BundledLangs, BundledThemes>;
interface ShorthandsBundle<L extends string, T extends string> {
  /**
   * Shorthand for `codeToHtml` with auto-loaded theme and language.
   * A singleton highlighter it maintained internally.
   *
   * Differences from `highlighter.codeToHtml()`, this function is async.
   */
  codeToHtml: (code: string, options: CodeToHastOptions<L, T>) => Promise<string>;
  /**
   * Shorthand for `codeToHtml` with auto-loaded theme and language.
   * A singleton highlighter it maintained internally.
   *
   * Differences from `highlighter.codeToHtml()`, this function is async.
   */
  codeToHast: (code: string, options: CodeToHastOptions<L, T>) => Promise<Root>;
  /**
   * Shorthand for `codeToTokens` with auto-loaded theme and language.
   * A singleton highlighter it maintained internally.
   *
   * Differences from `highlighter.codeToTokens()`, this function is async.
   */
  codeToTokens: (code: string, options: CodeToTokensOptions<L, T>) => Promise<TokensResult>;
  /**
   * Shorthand for `codeToTokensBase` with auto-loaded theme and language.
   * A singleton highlighter it maintained internally.
   *
   * Differences from `highlighter.codeToTokensBase()`, this function is async.
   */
  codeToTokensBase: (code: string, options: RequireKeys<CodeToTokensBaseOptions<L, T>, 'theme' | 'lang'>) => Promise<ThemedToken[][]>;
  /**
   * Shorthand for `codeToTokensWithThemes` with auto-loaded theme and language.
   * A singleton highlighter it maintained internally.
   *
   * Differences from `highlighter.codeToTokensWithThemes()`, this function is async.
   */
  codeToTokensWithThemes: (code: string, options: RequireKeys<CodeToTokensWithThemesOptions<L, T>, 'themes' | 'lang'>) => Promise<ThemedTokenWithVariants[][]>;
  /**
   * Get the singleton highlighter.
   */
  getSingletonHighlighter: (options?: Partial<BundledHighlighterOptions<L, T>>) => Promise<HighlighterGeneric<L, T>>;
  /**
   * Shorthand for `getLastGrammarState` with auto-loaded theme and language.
   * A singleton highlighter it maintained internally.
   */
  getLastGrammarState: ((element: ThemedToken[][] | Root) => GrammarState) | ((code: string, options: CodeToTokensBaseOptions<L, T>) => Promise<GrammarState>);
}
declare function makeSingletonHighlighter<L extends string, T extends string>(createHighlighter: CreateHighlighterFactory<L, T>): (options?: Partial<BundledHighlighterOptions<L, T>>) => Promise<HighlighterGeneric<L, T>>;
interface CreateSingletonShorthandsOptions<L extends string, T extends string> {
  /**
   * A custom function to guess embedded languages to be loaded.
   */
  guessEmbeddedLanguages?: (code: string, lang: string | undefined, highlighter: HighlighterGeneric<L, T>) => Awaitable<string[] | undefined>;
}
declare function createSingletonShorthands<L extends string, T extends string>(createHighlighter: CreateHighlighterFactory<L, T>, config?: CreateSingletonShorthandsOptions<L, T>): ShorthandsBundle<L, T>;
//#endregion
//#region src/constructors/highlighter.d.ts
/**
 * Create a Shiki core highlighter instance, with no languages or themes bundled.
 * Wasm and each language and theme must be loaded manually.
 *
 * @see http://shiki.style/guide/bundles#fine-grained-bundle
 */
declare function createHighlighterCore(options: HighlighterCoreOptions<false>): Promise<HighlighterCore>;
/**
 * Create a Shiki core highlighter instance, with no languages or themes bundled.
 * Wasm and each language and theme must be loaded manually.
 *
 * Synchronous version of `createHighlighterCore`, which requires to provide the engine and all themes and languages upfront.
 *
 * @see http://shiki.style/guide/bundles#fine-grained-bundle
 */
declare function createHighlighterCoreSync(options: HighlighterCoreOptions<true>): HighlighterCore;
declare function makeSingletonHighlighterCore(createHighlighter: typeof createHighlighterCore): (options: HighlighterCoreOptions) => Promise<HighlighterCore>;
declare const getSingletonHighlighterCore: (options: HighlighterCoreOptions) => Promise<HighlighterCore>;
//#endregion
//#region src/highlight/code-to-hast.d.ts
declare function codeToHast(primitive: ShikiPrimitive, code: string, options: CodeToHastOptions, transformerContext?: ShikiTransformerContextCommon): Root;
declare function tokensToHast(tokens: ThemedToken[][], options: CodeToHastRenderOptions, transformerContext: ShikiTransformerContextSource, grammarState?: GrammarState | undefined): Root;
//#endregion
//#region src/highlight/code-to-html.d.ts
declare const hastToHtml: typeof toHtml;
/**
 * Get highlighted code in HTML.
 */
declare function codeToHtml(primitive: ShikiPrimitive, code: string, options: CodeToHastOptions): string;
//#endregion
//#region src/highlight/code-to-tokens.d.ts
/**
 * High-level code-to-tokens API.
 *
 * It will use `codeToTokensWithThemes` or `codeToTokensBase` based on the options.
 */
declare function codeToTokens(primitive: ShikiPrimitive, code: string, options: CodeToTokensOptions): TokensResult;
//#endregion
//#region src/highlight/code-to-tokens-ansi.d.ts
declare function tokenizeAnsiWithTheme(theme: ThemeRegistrationResolved, fileContents: string, options?: TokenizeWithThemeOptions): ThemedToken[][];
//#endregion
//#region src/highlight/code-to-tokens-base.d.ts
/**
 * Code to tokens, with a simple theme.
 * This wraps the tokenizer's implementation to add ANSI support.
 */
declare function codeToTokensBase(primitive: ShikiPrimitive, code: string, options?: CodeToTokensBaseOptions): ThemedToken[][];
//#endregion
//#region src/theme-css-variables.d.ts
interface CssVariablesThemeOptions {
  /**
   * Theme name. Need to unique if multiple css variables themes are created
   *
   * @default 'css-variables'
   */
  name?: string;
  /**
   * Prefix for css variables
   *
   * @default '--shiki-'
   */
  variablePrefix?: string;
  /**
   * Default value for css variables, the key is without the prefix
   *
   * @example `{ 'token-comment': '#888' }` will generate `var(--shiki-token-comment, #888)` for comments
   */
  variableDefaults?: Record<string, string>;
  /**
   * Enable font style
   *
   * @default true
   */
  fontStyle?: boolean;
}
/**
 * A factory function to create a css-variable-based theme
 *
 * @see https://shiki.style/guide/theme-colors#css-variables-theme
 */
declare function createCssVariablesTheme(options?: CssVariablesThemeOptions): ThemeRegistration;
//#endregion
//#region src/transformer-decorations.d.ts
/**
 * A built-in transformer to add decorations to the highlighted code.
 */
declare function transformerDecorations(): ShikiTransformer;
//#endregion
//#region src/utils/hast.d.ts
/**
 * Utility to append class to a hast node
 *
 * If the `property.class` is a string, it will be splitted by space and converted to an array.
 */
declare function addClassToHast(node: Element, className: string | string[]): Element;
//#endregion
//#region src/utils/strings.d.ts
/**
 * Creates a converter between index and position in a code block.
 *
 * Overflow/underflow are unchecked.
 */
declare function createPositionConverter(code: string): {
  lines: string[];
  indexToPos: (index: number) => Position;
  posToIndex: (line: number, character: number) => number;
};
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
declare function guessEmbeddedLanguages(code: string, _lang: string | undefined, highlighter?: HighlighterGeneric<any, any>): string[];
//#endregion
//#region src/utils/tokens.d.ts
/**
 * Split a token into multiple tokens by given offsets.
 *
 * The offsets are relative to the token, and should be sorted.
 */
declare function splitToken<T extends Pick<ThemedToken, 'content' | 'offset'>>(token: T, offsets: number[]): T[];
/**
 * Split 2D tokens array by given breakpoints.
 */
declare function splitTokens<T extends Pick<ThemedToken, 'content' | 'offset'>>(tokens: T[][], breakpoints: number[] | Set<number>): T[][];
declare function flatTokenVariants(merged: ThemedTokenWithVariants, variantsOrder: string[], cssVariablePrefix: string, defaultColor: CodeOptionsMultipleThemes['defaultColor'], colorsRendering?: CodeOptionsMultipleThemes['colorsRendering']): ThemedToken;
declare function getTokenStyleObject(token: TokenStyles): Record<string, string>;
declare function stringifyTokenStyle(token: string | Record<string, string>): string;
//#endregion
export { CreateSingletonShorthandsOptions, CssVariablesThemeOptions, ShikiError, ShorthandsBundle, addClassToHast, applyColorReplacements, codeToHast, codeToHtml, codeToTokens, codeToTokensBase, codeToTokensWithThemes, createBundledHighlighter, createCssVariablesTheme, createHighlighterCore, createHighlighterCoreSync, createPositionConverter, createShikiInternal, createShikiInternalSync, createShikiPrimitive, createShikiPrimitiveAsync, createSingletonShorthands, flatTokenVariants, getLastGrammarState, getSingletonHighlighterCore, getTokenStyleObject, guessEmbeddedLanguages, hastToHtml, isNoneTheme, isPlainLang, isSpecialLang, isSpecialTheme, makeSingletonHighlighter, makeSingletonHighlighterCore, normalizeGetter, normalizeTheme, resolveColorReplacements, splitLines, splitToken, splitTokens, stringifyTokenStyle, toArray, tokenizeAnsiWithTheme, tokenizeWithTheme, tokensToHast, transformerDecorations };