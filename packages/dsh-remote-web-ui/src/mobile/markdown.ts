/**
 * A compact GFM-subset markdown renderer for the mobile chat: headings,
 * paragraphs, fenced + inline code, bold/italic/strikethrough, links,
 * images, lists, blockquotes, hr, and tables. All HTML is escaped before
 * transformation — the output only ever contains the renderer's own tags.
 * Dependency-free on purpose (the mobile bundle stays at ~456 KB); the
 * escape-first + protocol allow-list design mirrors the desktop panel's
 * preview renderer (dsh-aionui-panel/src/client/preview/markdown.ts).
 * Pure and exported for tests.
 * @module dsh-remote-web-ui/mobile/markdown
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

/**
 * Guard a raw link/image target against dangerous protocols. Returns the
 * (trimmed) raw string when safe, else null. Only http:, https:, mailto:
 * and fragment anchors (#...) are allowed; anything with another scheme
 * — javascript:, data:, vbscript:, etc. — is rejected so the value never
 * reaches dangerouslySetInnerHTML.
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

/** Find the ')' closing a link/image target, skipping nested parens. */
function findCloseParen(text: string, from: number): number {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    const char = text[i]
    if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) return i
      depth -= 1
    }
  }
  return -1
}

/** Inline pass: code spans, bold, italic, strikethrough, images, links. */
export function renderInline(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const char = text[i]
    // Fenced inline code first.
    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        out += '<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>'
        i = end + 1
        continue
      }
    }
    // Image ![alt](src)
    if (char === '!' && text[i + 1] === '[') {
      const close = text.indexOf('](', i + 2)
      if (close !== -1) {
        const parenEnd = findCloseParen(text, close + 2)
        if (parenEnd !== -1) {
          const alt = text.slice(i + 2, close)
          const src = text.slice(close + 2, parenEnd)
          const safe = safeUrl(src)
          if (safe === null) {
            out += escapeHtml(alt)
          } else {
            const srcEsc = escapeHtml(safe).replace(/\s+/g, '%20')
            out += '<img alt="' + escapeHtml(alt) + '" src="' + srcEsc + '" />'
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
        const parenEnd = findCloseParen(text, close + 2)
        if (parenEnd !== -1) {
          const label = text.slice(i + 1, close)
          const href = text.slice(close + 2, parenEnd)
          const safe = safeUrl(href)
          if (safe === null) {
            out += renderInline(label)
          } else {
            out += '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + renderInline(label) + '</a>'
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
        out += '<strong>' + renderInline(text.slice(i + 2, end)) + '</strong>'
        i = end + 2
        continue
      }
    }
    // Italic *text*
    if (char === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1 && text[end + 1] !== '*') {
        out += '<em>' + renderInline(text.slice(i + 1, end)) + '</em>'
        i = end + 1
        continue
      }
    }
    // Strikethrough ~~text~~
    if (char === '~' && text[i + 1] === '~') {
      const end = text.indexOf('~~', i + 2)
      if (end !== -1) {
        out += '<del>' + renderInline(text.slice(i + 2, end)) + '</del>'
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
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  const n = lines.length

  const flushParagraph = (buffer: string[]): void => {
    if (buffer.length === 0) return
    out.push('<p>' + renderInline(buffer.join('\n')) + '</p>')
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
      const langAttr = lang === '' ? '' : ' class="language-' + escapeHtml(lang) + '"'
      out.push('<pre' + langAttr + '><code>' + escapeHtml(code.join('\n')) + '</code></pre>')
      continue
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph(paragraph)
      const level = heading[1].length
      out.push('<h' + level + '>' + renderInline(heading[2] ?? '') + '</h' + level + '>')
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
      out.push('<thead><tr>' + headerCells.map((cell) => '<th>' + renderInline(cell) + '</th>').join('') + '</tr></thead>')
      if (rows.length > 0) {
        out.push('<tbody>' + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + renderInline(cell) + '</td>').join('') + '</tr>').join('') + '</tbody>')
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
      out.push('<blockquote><p>' + body.map((bodyLine) => renderInline(bodyLine)).join('<br />') + '</p></blockquote>')
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
        items.push('<li>' + renderInline(item[2] ?? '') + '</li>')
        i += 1
      }
      out.push('<ul>' + items.join('') + '</ul>')
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
        items.push('<li>' + renderInline(item[1] ?? '') + '</li>')
        i += 1
      }
      out.push('<ol>' + items.join('') + '</ol>')
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
