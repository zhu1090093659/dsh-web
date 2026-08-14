/**
 * TeX-to-React via KaTeX, replicating the rehype-katex pipeline this renderer
 * replaced: the same three-arm error chain (strict render, `strict: 'ignore'`
 * retry, error span) and a DOM-identical element tree, so settled math keeps
 * its exact markup. KaTeX emits an HTML string; the browser's own HTML parser
 * (`DOMParser`, applying the spec's SVG/MathML foreign-content attribute
 * adjustments KaTeX output relies on) turns it into a tree this module maps
 * onto React elements — KaTeX output is a static span/MathML/SVG vocabulary
 * with no raw user HTML, the same trust shiki's tree gets in CodeBlock.
 *
 * React 18 has no MathML support, so the `.katex-mathml` subtree's elements
 * land in the HTML namespace — exactly as they did under the replaced
 * hast-util-to-jsx-runtime pipeline. The visual arm is the `.katex-html`
 * span tree; the MathML arm serves assistive technology, which reads it by
 * tag name regardless of namespace.
 */
import type { ReactNode } from 'react';
/**
 * Render TeX source to React elements through KaTeX.
 * @param value - The TeX source (math node value; fenced `math` blocks append
 * their trailing newline to match the replaced pipeline's text extraction).
 * @param displayMode - Display (block) versus inline rendering.
 * @returns KaTeX's element tree, or the error span when the source does not
 * parse (colored with KaTeX's stock `errorColor`, matching rehype-katex).
 */
export declare function renderTexToReact(value: string, displayMode: boolean): ReactNode;
//# sourceMappingURL=katex.d.ts.map