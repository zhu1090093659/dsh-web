/**
 * The composition reader: just enough YAML to turn a cordis entry list (or the
 * flat display map of `preset.yml`) into the values the preset registry takes.
 *
 * The harness parses composition files with its own YAML loader and preserves
 * `!!js` expressions as data (`{ __jsExpr }`); this reader reproduces that
 * contract for the one file shape a preset ships. No YAML package is
 * resolvable from this package (the market build reads `preset.yml` with a
 * line reader for the same reason), so the subset is owned here and fenced by
 * tests over the whole shipped catalog.
 *
 * Fail-closed: a construct outside the subset (anchors, aliases, flow
 * collections, extra tags, multiple documents, tabs) raises
 * {@link CompositionError} instead of being guessed at, so an unreadable
 * composition is refused rather than half-declared.
 * @module @linxin666/dsh-client-ui-preset-center/core/yaml
 */

/** A construct outside the supported subset, or malformed YAML. */
export class CompositionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompositionError'
  }
}

/** A Loader `!!js` expression preserved as data instead of executed. */
export interface JsExpression {
  __jsExpr: string
}

interface Cursor {
  /** Mutable line copy: sequence items rewrites their own line in place. */
  readonly lines: string[]
  index: number
}

const BLANK_OR_COMMENT_RE = /^[ \t]*(?:#.*)?$/
const INTEGER_RE = /^[+-]?\d+$/
const FLOAT_RE = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/

/** The indentation width of one line (its leading spaces). */
function indentOf(line: string): number {
  const match = /^ */.exec(line)
  return match === null ? 0 : match[0].length
}

/**
 * The indentation of one structurally significant line.
 * A tab in that indentation is forbidden by YAML; block-scalar content is
 * verbatim and is never measured here.
 */
function significantIndent(line: string, lineNumber: number): number {
  const leading = /^[ \t]*/.exec(line)?.[0] ?? ''
  if (leading.includes('\t')) {
    throw new CompositionError(`line ${String(lineNumber)}: tabs must not be used for indentation`)
  }
  return leading.length
}

/** Advance past blank and comment-only lines. */
function skipInsignificant(cursor: Cursor): void {
  while (cursor.index < cursor.lines.length && BLANK_OR_COMMENT_RE.test(cursor.lines[cursor.index] ?? '')) {
    cursor.index += 1
  }
}

/** Whether a line at `indent` opens a block sequence entry. */
function isSequenceEntry(line: string, indent: number): boolean {
  if (line[indent] !== '-') return false
  return line.length === indent + 1 || line[indent + 1] === ' '
}

/**
 * Split one block-map line into its key and the raw text after the colon.
 * @param text - the line content from its first non-space character.
 * @returns the key and remainder, or undefined when the line is not a map entry.
 */
function matchKeyEntry(text: string): { key: string; rest: string } | undefined {
  if (text.startsWith("'") || text.startsWith('"')) {
    const end = closingQuote(text)
    if (end === -1) return undefined
    const after = text.slice(end + 1).trimStart()
    if (!after.startsWith(':')) return undefined
    return { key: unquote(text.slice(0, end + 1)), rest: after.slice(1).trim() }
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '#' && index > 0 && text[index - 1] === ' ') break
    if (char === ':' && (index + 1 === text.length || text[index + 1] === ' ')) {
      return { key: text.slice(0, index), rest: text.slice(index + 1).trim() }
    }
  }
  return undefined
}

/** The index of the quote that closes a quoted scalar starting at index 0. */
function closingQuote(text: string): number {
  const quote = text[0]
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index]
    if (quote === '"' && char === '\\') { index += 1; continue }
    if (quote === "'" && char === "'" && text[index + 1] === "'") { index += 1; continue }
    if (char === quote) return index
  }
  return -1
}

/** Resolve one quoted scalar, or return the text unchanged when unquoted. */
function unquote(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('"')) {
    const end = closingQuote(trimmed)
    if (end !== trimmed.length - 1) throw new CompositionError(`unterminated double-quoted scalar: ${trimmed}`)
    const body = trimmed.slice(1, end)
    return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape: string) => {
      switch (escape[0]) {
        case 'n': return '\n'
        case 't': return '\t'
        case 'r': return '\r'
        case '0': return '\0'
        case 'u': return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        case 'x': return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        default: return escape
      }
    })
  }
  if (trimmed.startsWith("'")) {
    const end = closingQuote(trimmed)
    if (end !== trimmed.length - 1) throw new CompositionError(`unterminated single-quoted scalar: ${trimmed}`)
    return trimmed.slice(1, end).replaceAll("''", "'")
  }
  return trimmed
}

/** Resolve a plain scalar to the value YAML's JSON schema would produce. */
function plainScalar(text: string): unknown {
  // A '#' opens a comment only after whitespace, so the first ' #' ends the
  // scalar; anything else (including a lone '#') stays content.
  const comment = text.indexOf(' #')
  const value = (comment === -1 ? text : text.slice(0, comment)).trim()
  if (value === '' || value === '~' || value === 'null' || value === 'Null' || value === 'NULL') return null
  if (value === 'true' || value === 'True' || value === 'TRUE') return true
  if (value === 'false' || value === 'False' || value === 'FALSE') return false
  if (INTEGER_RE.test(value)) return Number(value)
  if (FLOAT_RE.test(value)) return Number(value)
  return value
}

/** Resolve the text that follows a colon or a dash on one line. */
function inlineScalar(text: string): unknown {
  const value = text.trim()
  if (value.startsWith('!!js')) {
    const expression = value.slice('!!js'.length).trim()
    if (expression === '') throw new CompositionError('!!js requires an expression')
    return { __jsExpr: unquote(expression) } satisfies JsExpression
  }
  if (value.startsWith("'") || value.startsWith('"')) {
    const end = closingQuote(value)
    if (end === -1) throw new CompositionError(`unterminated quoted scalar: ${value}`)
    const tail = value.slice(end + 1).trim()
    if (tail !== '' && !tail.startsWith('#')) {
      throw new CompositionError(`unexpected content after a quoted scalar: ${tail}`)
    }
    return unquote(value.slice(0, end + 1))
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    throw new CompositionError(`flow collections are not supported: ${value}`)
  }
  if (value.startsWith('|') || value.startsWith('>')) {
    throw new CompositionError(`block scalars need their own line: ${value}`)
  }
  if (value.startsWith('!') || value.startsWith('&') || value.startsWith('*')) {
    throw new CompositionError(`unsupported YAML node: ${value}`)
  }
  return plainScalar(value)
}

/**
 * Read one literal (`|`) or folded (`>`) block scalar, consuming its lines.
 * @param cursor - line cursor positioned on the line that follows the header.
 * @param parentIndent - indentation of the node that owns the scalar.
 * @param header - the header text (`|-`, `>+2`, ...) possibly with a comment.
 * @returns the scalar text after indentation stripping and chomping.
 */
function blockScalar(cursor: Cursor, parentIndent: number, header: string): string {
  const style = header[0]
  const indicators = header.slice(1).split('#')[0]?.trim() ?? ''
  let explicitIndent: number | undefined
  let chomp: 'clip' | 'strip' | 'keep' = 'clip'
  for (const char of indicators) {
    if (char === '-') chomp = 'strip'
    else if (char === '+') chomp = 'keep'
    else if (char >= '1' && char <= '9') explicitIndent = Number(char)
    else throw new CompositionError(`unsupported block scalar header: ${header}`)
  }
  const body: string[] = []
  let blockIndent: number | undefined
  let trailing = 0
  while (cursor.index < cursor.lines.length) {
    const line = cursor.lines[cursor.index] ?? ''
    if (line.trim() === '') {
      body.push('')
      trailing += 1
      cursor.index += 1
      continue
    }
    const indent = indentOf(line)
    if (indent <= parentIndent) break
    if (blockIndent === undefined) blockIndent = explicitIndent === undefined ? indent : parentIndent + explicitIndent
    if (indent < blockIndent) break
    body.push(line.slice(blockIndent))
    trailing = 0
    cursor.index += 1
  }
  const lines = body.slice(0, body.length - trailing)
  const tail = trailing
  if (style === '>') {
    // Folding: a single line break between two content lines reads as a
    // space, and each blank line reads as one newline.
    let folded = ''
    let blank = 0
    let started = false
    for (const line of lines) {
      if (line === '') { blank += 1; continue }
      if (!started) { folded = line; started = true; blank = 0; continue }
      folded += blank === 0 ? ' ' + line : '\n'.repeat(blank) + line
      blank = 0
    }
    if (chomp === 'strip') return folded
    if (chomp === 'keep') return folded + '\n'.repeat(tail + 1)
    return folded === '' ? '' : folded + '\n'
  }
  const text = lines.join('\n')
  if (chomp === 'strip') return text
  if (chomp === 'keep') return text + '\n'.repeat(tail + 1)
  return text === '' ? '' : text + '\n'
}

/** Resolve the value of one entry whose line has already been consumed. */
function parseValue(cursor: Cursor, parentIndent: number, rest: string): unknown {
  if (rest !== '') {
    if (rest.startsWith('|') || rest.startsWith('>')) return blockScalar(cursor, parentIndent, rest)
    return inlineScalar(rest)
  }
  skipInsignificant(cursor)
  const line = cursor.lines[cursor.index]
  if (line === undefined || indentOf(line) <= parentIndent) return null
  return parseNode(cursor, parentIndent + 1)
}

/** Parse a block map whose keys sit at exactly `indent`. */
function parseMap(cursor: Cursor, indent: number): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  while (true) {
    skipInsignificant(cursor)
    const line = cursor.lines[cursor.index]
    if (line === undefined) break
    const lineIndent = significantIndent(line, cursor.index + 1)
    if (lineIndent < indent) break
    if (lineIndent > indent) {
      throw new CompositionError(`line ${String(cursor.index + 1)}: unexpected indentation`)
    }
    if (isSequenceEntry(line, indent)) break
    const entry = matchKeyEntry(line.slice(indent))
    if (entry === undefined) {
      throw new CompositionError(`line ${String(cursor.index + 1)}: expected "key: value", got "${line.trim()}"`)
    }
    if (Object.hasOwn(map, entry.key)) {
      throw new CompositionError(`line ${String(cursor.index + 1)}: duplicate key "${entry.key}"`)
    }
    cursor.index += 1
    map[entry.key] = parseValue(cursor, indent, entry.rest)
  }
  return map
}

/** Parse a block sequence whose dashes sit at exactly `indent`. */
function parseSequence(cursor: Cursor, indent: number): unknown[] {
  const items: unknown[] = []
  while (true) {
    skipInsignificant(cursor)
    const line = cursor.lines[cursor.index]
    if (line === undefined) break
    if (significantIndent(line, cursor.index + 1) !== indent || !isSequenceEntry(line, indent)) break
    const rest = line.slice(indent + 1)
    const content = rest.trimStart()
    if (content === '') {
      cursor.index += 1
      skipInsignificant(cursor)
      const nested = cursor.lines[cursor.index]
      const nestedIndent = nested === undefined ? -1 : significantIndent(nested, cursor.index + 1)
      items.push(nestedIndent <= indent ? null : parseNode(cursor, indent + 1))
      continue
    }
    const contentIndent = indent + 1 + (rest.length - content.length)
    if (matchKeyEntry(content) !== undefined) {
      cursor.lines[cursor.index] = ' '.repeat(contentIndent) + content
      items.push(parseMap(cursor, contentIndent))
      continue
    }
    cursor.index += 1
    items.push(parseValue(cursor, indent, content))
  }
  return items
}

/** Parse the block node that starts at the cursor. */
function parseNode(cursor: Cursor, minIndent: number): unknown {
  skipInsignificant(cursor)
  const line = cursor.lines[cursor.index]
  if (line === undefined) return null
  const indent = significantIndent(line, cursor.index + 1)
  if (indent < minIndent) return null
  return isSequenceEntry(line, indent) ? parseSequence(cursor, indent) : parseMap(cursor, indent)
}

/**
 * Read one cordis YAML document (or the flat map of `preset.yml`).
 * @param text - file content.
 * @returns the parsed value: a list of entries, a map, or null when empty.
 * @throws {CompositionError} on malformed YAML or an unsupported construct.
 */
export function readCordisYaml(text: string): unknown {
  const cursor: Cursor = { lines: (text.startsWith('\uFEFF') ? text.slice(1) : text).split('\n'), index: 0 }
  const value = parseNode(cursor, 0)
  skipInsignificant(cursor)
  const extra = cursor.lines[cursor.index]
  if (extra !== undefined) {
    throw new CompositionError(`line ${String(cursor.index + 1)}: unexpected content "${extra.trim()}"`)
  }
  return value
}
