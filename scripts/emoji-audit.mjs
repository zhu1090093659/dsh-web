#!/usr/bin/env node
/**
 * Emoji gate: this repository bans emoji and decorative pictograms in code,
 * comments, documentation, UI copy, scripts and commit messages. This scans
 * hand-written UTF-8 sources for pictographic code points and reports each hit
 * as file:line:column with its U+ code point.
 *
 * Generated and vendored trees are out of scope, matching the rule wording
 * that it governs hand-written sources: dependency and build-output
 * directories, the vendored market try-on shell, the lockfile, binary asset
 * suffixes, and local-only test artifacts. Anything that is not valid UTF-8 is
 * not text and is skipped, so an untracked media render or package tarball in a
 * working tree cannot fail the gate; it therefore behaves the same locally and
 * in a clean CI checkout.
 *
 * Usage:
 *   node scripts/emoji-audit.mjs         # gate: exit 1 on any pictograph
 *   node scripts/emoji-audit.mjs --list  # print the scanned total as well
 */
import { readFileSync, readdirSync } from 'node:fs'
import { TextDecoder } from 'node:util'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SCRIPT_PATH), '..')

/** Pictographic ranges: extended-B faces and objects, symbols and dingbats, arrows, flags. */
export const EMOJI_RANGES = [
  [0x1f000, 0x1faff],
  [0x2600, 0x27bf],
  [0x2b00, 0x2bff],
  [0x1f1e6, 0x1f1ff],
]

/** Standalone code points that only appear inside emoji sequences. */
export const EMOJI_SINGLES = new Set([0xfe0f, 0x200d])

/** Directories whose contents are never hand-written repository sources. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'lib', 'dist', 'coverage', 'playwright-report',
  'test-results', '.codegraph', '.zcode', '.pnpm-store', '.wrangler',
  'gui-test-screenshots',
])

/** Vendored subtrees. */
const SKIP_PREFIXES = ['market/shell/']

/** Generated or third-party file names. */
const SKIP_NAMES = new Set(['pnpm-lock.yaml'])

/** Binary asset suffixes that cannot be read as UTF-8 text anyway. */
const SKIP_SUFFIXES = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz',
  '.tgz', '.tar', '.7z', '.rar', '.mp3', '.mp4', '.mov', '.webm', '.wav',
  '.wasm', '.node', '.dmg', '.exe',
])

/**
 * Decode a file as strict UTF-8, or null when it is not text. Binary content
 * decodes to replacement characters silently, which would report pictographs
 * that no author wrote, so invalid bytes take the file out of scope.
 */
export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

/** True when a code point is banned by the rule. */
export function isEmojiCodePoint(codePoint) {
  if (EMOJI_SINGLES.has(codePoint)) return true
  return EMOJI_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi)
}

/** True when a repository-relative path is out of scope. */
export function isSkippedPath(relPath) {
  const segments = relPath.split('/')
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return true
  if (SKIP_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return true
  const name = segments[segments.length - 1]
  if (SKIP_NAMES.has(name)) return true
  const dot = name.lastIndexOf('.')
  return dot > 0 && SKIP_SUFFIXES.has(name.slice(dot).toLowerCase())
}

/** Every banned code point in one text, with its 1-based line and column. */
export function scanText(text) {
  const found = []
  let line = 1
  let column = 1
  for (const char of text) {
    if (char === '\n') {
      line++
      column = 1
      continue
    }
    const codePoint = char.codePointAt(0)
    if (isEmojiCodePoint(codePoint)) found.push({ line, column, codePoint, char })
    column++
  }
  return found
}

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = relative(ROOT, full).split(sep).join('/')
    if (isSkippedPath(rel)) continue
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/** Every scanned file, repository-relative and sorted. */
export function collectFiles() {
  return walk(ROOT, []).sort()
}

/** All violations across the tree. */
export function auditTree(files, readSource) {
  const violations = []
  let scanned = 0
  for (const file of files) {
    const source = readSource(file)
    if (source === null) continue
    scanned++
    for (const hit of scanText(source)) violations.push({ file, ...hit })
  }
  return { violations, scanned }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/emoji-audit.mjs [--list]\n\nScans hand-written sources for banned pictographic code points.\nExit 1 when any is found.')
    return 0
  }
  const { violations, scanned } = auditTree(collectFiles(), (file) => {
    try {
      return decodeText(readFileSync(join(ROOT, file)))
    } catch {
      return null
    }
  })
  if (violations.length > 0) {
    console.log('[emoji-audit] FAIL: ' + violations.length + ' banned code point(s):')
    for (const hit of violations) {
      console.log('  ' + hit.file + ':' + hit.line + ':' + hit.column + ' U+' + hit.codePoint.toString(16).toUpperCase().padStart(4, '0'))
    }
    return 1
  }
  console.log('[emoji-audit] OK: ' + scanned + ' hand-written file(s) scanned, no pictographs')
  if (args.includes('--list')) console.log('[emoji-audit] skipped directories: ' + [...SKIP_DIRS].sort().join(', '))
  return 0
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === SCRIPT_PATH : false
if (invokedDirectly) process.exit(main())
