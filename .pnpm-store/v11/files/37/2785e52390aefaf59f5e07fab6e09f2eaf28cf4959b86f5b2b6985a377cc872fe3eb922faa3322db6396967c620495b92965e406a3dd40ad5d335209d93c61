/**
 * The client's ONE syntax highlighter: a synchronous fine-grained shiki core
 * (JavaScript regex engine — no oniguruma WASM, bundle-friendly) with an
 * explicit grammar allowlist and a CSS-variables theme. Colors live in the
 * theme package's token sheets as `--shiki-*` custom properties (light and
 * dark blocks), never here — the repo's tokens-only styling rule.
 *
 * Only the three markdown-fence and `run_code` grammars (TypeScript, shell,
 * JSON) load into the singleton at boot — the set every session renders. The
 * read card's wider extension set (the file-extension language hints the read
 * tool's `langFromPath` emits — `packages/fs/tool-fs`: python, rust, yaml,
 * markup, …) is imported lazily and registered the first time such a language
 * is requested, so a session that never opens a read card in one of those
 * languages pays neither the ~1.6 MB of grammar modules nor their synchronous
 * init. The first render of a lazy language falls back to plain text while its
 * grammar loads, then {@link onGrammarLoaded} notifies subscribers to re-render
 * with highlighting. An unknown or absent language falls back to plain text (no
 * highlighting, still monospace) — never an error.
 */
import type { CSSProperties } from 'react';
/**
 * Subscribe to lazy-grammar load completions; `listener` fires after a
 * {@link LAZY_GRAMMARS} grammar finishes registering on the singleton, so a
 * caller that rendered its plain fallback while the grammar loaded can
 * re-highlight. Uses the `useSyncExternalStore` subscribe signature; pair it with
 * {@link grammarLoadCount} as the snapshot. Returns an unsubscribe function.
 * @param listener - invoked (no args) on each grammar-load completion.
 * @returns a disposer that removes the listener.
 */
export declare function subscribeGrammarLoaded(listener: () => void): () => void;
/**
 * The lazy-grammar load counter — a value that changes on every load, so a
 * `useSyncExternalStore` snapshot re-renders the subscriber when a grammar
 * registers. Opaque: only its identity across renders matters.
 * @returns the current load count.
 */
export declare function grammarLoadCount(): number;
/**
 * Highlight `code` into shiki's HTML (a single `<pre class="shiki">` tree)
 * when `lang` maps to a registered grammar; `undefined` means the caller
 * renders its plain fallback. A lazy grammar not yet loaded returns `undefined`
 * for this call and loads in the background; subscribe with
 * {@link onGrammarLoaded} to re-highlight once it registers.
 * @param code - the source text.
 * @param lang - the language hint (a markdown fence info string or a fixed caller id).
 * @returns the highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
export declare function highlightToHtml(code: string, lang: string | undefined): string | undefined;
/**
 * One highlighted run of a line: the text and the inline style shiki assigned
 * it. The css-variables theme colors every run through a `--shiki-*` custom
 * property, so `style.color` is always present; it is held as a style object
 * rather than a bare color so a run spreads onto a `<span style>` uniformly.
 */
export interface HighlightSpan {
    text: string;
    style: CSSProperties;
}
/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a
 * registered grammar; `undefined` means the caller renders its plain fallback.
 * A line-numbered view needs the token runs split per line (one gutter number
 * per line), which the single-`<pre>` {@link highlightToHtml} does not expose,
 * so this returns shiki's own 2D line/token structure narrowed to what a run
 * renders. Each run's color is a `--shiki-*` custom property, keeping token
 * colors on the theme package's sheets exactly as the HTML path does; the
 * css-variables theme carries no font-style bits, matching that path's
 * color-only output. The trailing newline shiki appends as a final empty line
 * is dropped so the run count matches the caller's own line array.
 * @param code - the source text.
 * @param lang - the language hint (a file-extension-derived language id).
 * @returns one entry per source line (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
 */
export declare function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined;
//# sourceMappingURL=highlight.d.ts.map