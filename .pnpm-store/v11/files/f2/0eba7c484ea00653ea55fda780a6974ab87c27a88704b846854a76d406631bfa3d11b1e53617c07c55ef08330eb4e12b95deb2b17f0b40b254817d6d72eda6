/**
 * Untrusted assistant-Markdown renderer over the direct mdast pipeline:
 * `parse.ts` grammars, the incremental streaming parser, and `render.tsx`.
 * While a message streams, all but the trailing two blocks freeze as cached
 * React elements and only the source tail behind them re-parses per chunk,
 * so per-chunk work tracks the tail size instead of the whole reply. Frozen
 * blocks keep their source-offset keys when they cross the freeze boundary,
 * so React reconciles instead of remounting. Known deviation while
 * streaming: a reference-style link or footnote whose definition sits on the
 * other side of the freeze boundary renders literally until the settled
 * full parse self-heals it.
 */
import type { MarkdownCodeLabels, MarkdownFileMentions } from './render.tsx';
import 'katex/dist/katex.min.css';
export type { MarkdownCodeLabels, MarkdownFileMentions } from './render.tsx';
/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` renders fences and TeX plain (highlighting and KaTeX land on
 * the finalize swap) and parses incrementally across chunks; `codeLabels`
 * forwards localized copy-button labels to fence CodeBlocks — pass a
 * reference-stable object (memoized per locale revision), because a new
 * identity discards the streaming render cache mid-message. `fileMentions`
 * links inline-code tokens its resolver recognizes as real files; this is
 * the single streaming gate — it applies to settled renders only, because a
 * streaming message's vocabulary is not final and frozen cached elements
 * must not bake in handlers that could go stale.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML,
 * relative links, and unsafe protocols are disabled, while absolute HTTP(S)
 * images render directly.
 */
export declare const MarkdownText: import("react").MemoExoticComponent<({ text, streaming, codeLabels, fileMentions }: {
    text: string;
    streaming?: boolean;
    codeLabels?: MarkdownCodeLabels | undefined;
    fileMentions?: MarkdownFileMentions | undefined;
}) => import("react").JSX.Element>;
//# sourceMappingURL=MarkdownText.d.ts.map