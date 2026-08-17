/**
 * A compact markdown renderer for the preview panel: headings, paragraphs,
 * fenced + inline code, bold/italic, links/images, lists, blockquotes, hr,
 * tables and math ($...$ inline, $$...$$ display). All HTML is escaped
 * before transformation — the output only ever contains the renderer's own
 * tags. Pure and exported for tests.
 *
 * Math segments are emitted as unrendered placeholders carrying the raw TeX
 * source (data-aionui-math*); the katex enhancer (client/preview/katex.ts)
 * upgrades them in place after mount and leaves the raw text as the fallback
 * when the vendored KaTeX runtime is unavailable (issue #421).
 * @module dsh-aionui-panel/client/preview/markdown
 */

/** Escape HTML special characters. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** How one image src resolves against the markdown file's location. */
export type MarkdownImageResolution =
  /** Scheme URL or fragment: the browser resolves it as-is. */
  | { kind: 'absolute' }
  /** Workspace-relative target: resolved path plus any ?query#fragment suffix. */
  | { kind: 'relative'; path: string; suffix: string }
  /** `..` escaped the project root: the image must be dropped. */
  | { kind: 'escape' }

/** Directory of a workspace-relative file path ('' when at the root). */
function dirOf(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  return slash === -1 ? '' : filePath.slice(0, slash)
}

/** Collapse . and .. segments; null when .. escapes the base. */
function normalizeRelPath(rel: string): string | null {
  const out: string[] = []
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** Percent-decode a path portion (best effort; never throws). */
function decodePathPart(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Resolve one markdown image src against the markdown file's location:
 * - Absolute URLs (http/https/data:/...) and fragment-only srcs are left to
 *   the browser ('absolute').
 * - Root-relative srcs (/img.png) resolve from the project root; other
 *   relative srcs resolve against the file's directory. `..` escaping the
 *   project root is rejected ('escape').
 * - The path portion is percent-decoded (markdown authors encode spaces in
 *   filenames) and any ?query#fragment suffix is preserved verbatim, so
 *   cache-busting srcs like ./img.png?v=2 still fetch img.png.
 */
export function resolveMarkdownImage(filePath: string, src: string): MarkdownImageResolution {
  const trimmed = src.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return { kind: 'absolute' }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return { kind: 'absolute' }
  const q = trimmed.indexOf('?')
  const h = trimmed.indexOf('#')
  let cut = trimmed.length
  if (q !== -1) cut = Math.min(cut, q)
  if (h !== -1) cut = Math.min(cut, h)
  const pathPart = decodePathPart(trimmed.slice(0, cut))
  const suffix = trimmed.slice(cut)
  const base = pathPart.startsWith('/') ? '' : dirOf(filePath)
  const joined = base === '' ? pathPart : `${base}/${pathPart}`
  const normalized = normalizeRelPath(joined)
  if (normalized === null) return { kind: 'escape' }
  return { kind: 'relative', path: normalized, suffix }
}

/** Options controlling markdown rendering. */
export interface MarkdownRenderOptions {
  /**
   * Rewrite image srcs before they are emitted. Return the URL to use, or
   * null to drop the image (alt text only). Relative workspace paths are
   * typically resolved to absolute URLs here.
   */
  resolveImageSrc?: (src: string) => string | null
}

/**
 * Guard a raw link/image target against dangerous protocols. Returns the
 * (trimmed) raw string when safe, else null. Only these schemes are allowed:
 * http:, https:, mailto: and fragment anchors (#...). Scheme-less relative
 * paths (./ ../ / and plain filenames) pass through unchanged. Anything with
 * a scheme outside the allow-list — javascript:, data:, vbscript:, etc. —
 * is rejected so the value never reaches dangerouslySetInnerHTML.
 */
export function safeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('#')) return trimmed
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (scheme === null) return trimmed
  const name = scheme[1].toLowerCase()
  return name === 'http' || name === 'https' || name === 'mailto' ? trimmed : null
}

/** Attribute the renderer stamps on math placeholders (`inline`/`block`). */
export const DATA_MATH = 'data-aionui-math'

/** Attribute carrying the raw TeX source of a math placeholder. */
export const DATA_MATH_SOURCE = 'data-aionui-math-source'

/**
 * One math placeholder element. The raw TeX is both the data source for the
 * katex enhancer and the visible fallback text (escaped twice: once for the
 * attribute, once for the element body).
 */
function mathPlaceholder(kind: 'inline' | 'block', source: string): string {
  const escaped = escapeHtml(source)
  const tag = kind === 'block' ? 'div' : 'span'
  return `<${tag} ${DATA_MATH}="${kind}" ${DATA_MATH_SOURCE}="${escaped}">${escaped}</${tag}>`
}

/**
 * Find the end of an inline math segment starting at the `$` at `start`.
 * Conservative currency-safe rules (markdown-it-math convention): the
 * opening $ must not be followed by whitespace, the closing $ must not be
 * preceded by whitespace nor followed by a digit, the segment is never
 * empty, and it never spans a newline. Returns the closing index, or -1
 * when there is none.
 */
export function findInlineMathClose(text: string, start: number): number {
  let i = start + 1
  const n = text.length
  if (i >= n) return -1
  const first = text[i]
  if (first === ' ' || first === '\t' || first === '\n') return -1
  while (i < n) {
    const char = text[i]
    if (char === '\n') return -1
    if (char === '$') {
      // An empty segment ($$ handled elsewhere or a bare pair) is not math.
      if (i === start + 1) return -1
      const before = text[i - 1]
      if (before === ' ' || before === '\t') return -1
      const after = text[i + 1]
      if (after !== undefined && after >= '0' && after <= '9') return -1
      return i
    }
    i += 1
  }
  return -1
}

/** Inline pass: code spans, math, bold, italic, images, links. */
export function renderInline(text: string, options?: MarkdownRenderOptions): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const char = text[i]
    // Fenced inline code first.
    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        out += `<code>${escapeHtml(text.slice(i + 1, end))}</code>`
        i = end + 1
        continue
      }
    }
    // Escaped dollar: a literal $, never a math delimiter.
    if (char === '\\' && text[i + 1] === '$') {
      out += escapeHtml('$')
      i += 2
      continue
    }
    // Display math $$...$$ inside a line.
    if (char === '$' && text[i + 1] === '$') {
      const end = text.indexOf('$$', i + 2)
      if (end !== -1) {
        const source = text.slice(i + 2, end).trim()
        if (source !== '') {
          out += mathPlaceholder('block', source)
          i = end + 2
          continue
        }
      }
    }
    // Inline math $...$ (currency-safe, see findInlineMathClose).
    if (char === '$') {
      const end = findInlineMathClose(text, i)
      if (end !== -1) {
        const source = text.slice(i + 1, end)
        if (source.trim() !== '') {
          out += mathPlaceholder('inline', source)
          i = end + 1
          continue
        }
      }
    }
    // Image ![alt](src)
    if (char === '!' && text[i + 1] === '[') {
      const close = text.indexOf('](', i + 2)
      if (close !== -1) {
        const parenEnd = text.indexOf(')', close + 2)
        if (parenEnd !== -1) {
          const alt = text.slice(i + 2, close)
          const src = text.slice(close + 2, parenEnd)
          const safe = safeUrl(src)
          if (safe === null) {
            // Unsafe image target: drop the img, keep the alt text.
            out += escapeHtml(alt)
          } else {
            let target: string | null = safe
            if (options?.resolveImageSrc !== undefined) {
              target = options.resolveImageSrc(safe)
            }
            if (target === null) {
              // The resolver dropped the image (unresolvable path): alt only.
              out += escapeHtml(alt)
            } else {
              const srcEsc = escapeHtml(target).replace(/\s+/g, '%20')
              out += `<img alt="${escapeHtml(alt)}" src="${srcEsc}" />`
            }
          }
          i = parenEnd + 1
          continue
        }
      }
    }
    // Link [text](href)
    if (char === '[') {
      const close = text.indexOf('](', i + 1)
      if (close !== -1) {
        const parenEnd = text.indexOf(')', close + 2)
        if (parenEnd !== -1) {
          const label = text.slice(i + 1, close)
          const href = text.slice(close + 2, parenEnd)
          const safe = safeUrl(href)
          if (safe === null) {
            // Unsafe link target: render the label as plain text, no <a>.
            out += renderInline(label, options)
          } else {
            out += `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${renderInline(label, options)}</a>`
          }
          i = parenEnd + 1
          continue
        }
      }
    }
    // Bold **text**
    if (char === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        out += `<strong>${renderInline(text.slice(i + 2, end), options)}</strong>`
        i = end + 2
        continue
      }
    }
    // Italic *text*
    if (char === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1 && text[end + 1] !== '*') {
        out += `<em>${renderInline(text.slice(i + 1, end), options)}</em>`
        i = end + 1
        continue
      }
    }
    // Strikethrough ~~text~~
    if (char === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end !== -1) {
        out += `<del>${renderInline(text.slice(i + 2, end), options)}</del>`
        i = end + 2
        continue
      }
    }
    out += escapeHtml(char)
    i += 1
  }
  return out
}

/** Render a markdown document to HTML (block pass). */
export function renderMarkdown(source: string, options?: MarkdownRenderOptions): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  const n = lines.length

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return
    out.push(`<p>${renderInline(buffer.join("\n"), options)}</p>`)
    buffer.length = 0
  }

  let paragraph: string[] = []
  while (i < n) {
    const line = lines[i]

    // Fenced code block.
    const fence = /^```([\w+-]*)\s*$/.exec(line)
    if (fence !== null) {
      flushParagraph(paragraph)
      const lang = fence[1] ?? ''
      i += 1
      const code: string[] = []
      while (i < n && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // closing fence
      const langAttr = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`
      out.push(`<pre${langAttr}><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    // Display math block: an opener line starting with $$, closed by a
    // trailing $$ on the same line (single-line form) or on a later line.
    // The raw TeX is collected verbatim — no inline markdown inside.
    const mathOpen = /^\s*\$\$(.*)$/.exec(line)
    if (mathOpen !== null) {
      const rest = mathOpen[1] ?? ''
      const single = /^(.*)\$\$\s*$/.exec(rest)
      if (single !== null && (single[1] ?? '').trim() !== '') {
        flushParagraph(paragraph)
        out.push(mathPlaceholder('block', (single[1] ?? '').trim()))
        i += 1
        continue
      }
      // Multi-line form: gather until a line ending with $$.
      const source: string[] = []
      if (rest.trim() !== '') source.push(rest)
      let j = i + 1
      let closed = false
      while (j < n) {
        const closing = /^(.*)\$\$\s*$/.exec(lines[j])
        if (closing !== null) {
          if ((closing[1] ?? '').trim() !== '') source.push(closing[1] ?? '')
          closed = true
          j += 1
          break
        }
        source.push(lines[j])
        j += 1
      }
      if (closed) {
        flushParagraph(paragraph)
        const tex = source.join('\n').trim()
        if (tex !== '') out.push(mathPlaceholder('block', tex))
        i = j
        continue
      }
      // Unterminated: fall through and render the opener as plain text.
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph(paragraph)
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2] ?? '', options)}</h${level}>`)
      i += 1
      continue
    }

    // Horizontal rule.
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph(paragraph)
      out.push('<hr />')
      i += 1
      continue
    }

    // Table: header row then separator row.
    if (line.includes('|') && i + 1 < n && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph(paragraph)
      const headerCells = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < n && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      out.push('<table>')
      out.push(`<thead><tr>${headerCells.map((cell) => `<th>${renderInline(cell, options)}</th>`).join('')}</tr></thead>`)
      if (rows.length > 0) {
        out.push(`<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, options)}</td>`).join('')}</tr>`).join('')}</tbody>`)
      }
      out.push('</table>')
      continue
    }

    // Blockquote (one level).
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote !== null) {
      flushParagraph(paragraph)
      const body: string[] = []
      while (i < n) {
        const q = /^>\s?(.*)$/.exec(lines[i])
        if (q === null) break
        body.push(q[1] ?? '')
        i += 1
      }
      out.push(`<blockquote><p>${body.map((line) => renderInline(line, options)).join('<br />')}</p></blockquote>`)
      continue
    }

    // Unordered list.
    const ul = /^\s*([-*+])\s+(.*)$/.exec(line)
    if (ul !== null) {
      flushParagraph(paragraph)
      const items: string[] = []
      while (i < n) {
        const item = /^\s*([-*+])\s+(.*)$/.exec(lines[i])
        if (item === null) break
        items.push(`<li>${renderInline(item[2] ?? '', options)}</li>`)
        i += 1
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list.
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ol !== null) {
      flushParagraph(paragraph)
      const items: string[] = []
      while (i < n) {
        const item = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
        if (item === null) break
        items.push(`<li>${renderInline(item[1] ?? '', options)}</li>`)
        i += 1
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // Blank line: flush the paragraph.
    if (line.trim() === '') {
      flushParagraph(paragraph)
      i += 1
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flushParagraph(paragraph)
  return out.join('\n')
}

/** Split one table row into cells (respecting the leading/trailing pipes). */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutTrailing = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutTrailing.split('|').map((cell) => cell.trim())
}
