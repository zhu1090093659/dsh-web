#!/usr/bin/env node
/**
 * i18n audit gate for the dsh-web monorepo.
 *
 * The zh dictionaries under the packages' src/client dirs are the key-source
 * of truth; every consumer copy (en, and the ru dictionaries carried centrally
 * by packages/dsh-i18n) must track them. This gate verifies mechanically:
 *
 *   - zh/en key parity per plugin namespace (missing keys list both sides);
 *   - {placeholder} set parity across zh / en / ru per key;
 *   - no CJK outside comments in client files (string literals, template
 *     literals, regex literals and JSX text all count; comments never do) —
 *     per-line opt-out via an `i18n-allow: <reason>` trailing comment, whole
 *     file via an `i18n-allow:` comment in the leading comment block;
 *   - every namespace's ru dictionary (packages/dsh-i18n/src/client/ru)
 *     covers at least the ns's zh key set (extras are reported, not fatal).
 *
 * Host-half files (src/index.ts, src/core/) are scanned too but only warn:
 * they are agent-facing copy and comments, not user-facing UI.
 *
 * Usage:
 *   node scripts/i18n-audit.mjs --check     # gate mode (default): exit 1 on any failure
 *   node scripts/i18n-audit.mjs --template  # emit { ns: { key: { zh, en } } } JSON for translation
 *   node scripts/i18n-audit.mjs --report    # per-ns key counts, ru coverage, exemptions
 *
 * Dictionary modules are real TS files loaded through type stripping; when
 * the running node cannot strip types (node < 22.6 without the flag) the
 * script re-execs itself with --experimental-strip-types once.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SCRIPT_PATH), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
/** Marker comment that opts a line (trailing) or a file (leading block) out of the CJK scan. */
const ALLOW_MARKER = 'i18n-allow:'

/**
 * The audited locale sources, one entry per plugin package. `files` pairs a
 * client-side dictionary module with its export shape:
 *   - 'zh-en': `export const zh` + `export const en` in one module;
 *   - 'dictionaries': `export const dictionaries = { zh, en }` (locale-keyed).
 * A package's namespaces are merged across its files (a package may ship
 * several dictionary modules registering into one namespace). Namespace ids
 * are NOT listed here: they are derived from each package's client entry so
 * the gate follows the code instead of a hand-maintained copy.
 */
const PACKAGES = [
  { pkg: 'dsh-desktop-launcher', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-doctor', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-git-graph', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-market', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-perf', files: [{ file: 'src/client/perf-locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-pet', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-plugin-manager', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-remote-web-ui', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-session-id', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-session-archive', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-skill-explorer', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-ssh', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-task-board', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-tool-describe-image', files: [{ file: 'src/client/locales.ts', shape: 'dictionaries' }] },
  { pkg: 'dsh-usage', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
  { pkg: 'dsh-web-settings', files: [{ file: 'src/client/locales.ts', shape: 'zh-en' }] },
]

/** Package that carries the third-language (ru) dictionaries centrally. */
const I18N_PACKAGE = 'dsh-i18n'
const RU_INDEX = 'src/client/ru/index.ts'

/** Han, CJK punctuation and fullwidth forms — the glyph sets user copy leaks, comments aside. */
const CJK_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/
/** SDK locale dictionaries interpolate {name} placeholders. */
const PLACEHOLDER_RE = /\{([A-Za-z0-9_.-]+)\}/g

/**
 * Strip line/block comments while tracking string, template and (shallow)
 * template-interpolation state, so a quote or slash inside a string never
 * opens a fake comment and comment text never counts as copy.
 * @param {string} source - file text.
 * @returns {{ code: string, comments: { start: number, end: number }[] }} comment-free text
 *   (same length as the source, comments blanked) and comment spans.
 */
export function stripComments(source) {
  const out = source.split('')
  const comments = []
  // Stack of states: 'code' base plus open strings/templates. Template
  // interpolation pushes a code frame so `}` returns to template state.
  const stack = []
  let i = 0
  const push = (state) => stack.push(state)
  const top = () => stack[stack.length - 1]
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    const state = top()
    if (state === 'line-comment') {
      if (ch === '\n') {
        stack.pop()
        const span = comments[comments.length - 1]
        if (span !== undefined && span.end === -1) span.end = i
      } else out[i] = ' '
      i += 1
      continue
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        out[i] = ' '
        out[i + 1] = ' '
        const span = comments[comments.length - 1]
        if (span !== undefined && span.end === -1) span.end = i + 2
        stack.pop()
        i += 2
      } else {
        if (ch !== '\n') out[i] = ' '
        i += 1
      }
      continue
    }
    if (state === "'" || state === '"') {
      if (ch === '\\') { i += 2; continue }
      if (ch === state) stack.pop()
      if (ch === '\n') stack.pop() // unterminated: recover at line end
      i += 1
      continue
    }
    if (state === 'template') {
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') { stack.pop(); i += 1; continue }
      if (ch === '$' && next === '{') { stack.pop(); push('code'); push('interp'); i += 2; continue }
      i += 1
      continue
    }
    if (state === 'interp') {
      // Inside ${...}: nested braces counted so the closing one returns to template.
      if (ch === '{') { push('brace'); i += 1; continue }
      if (ch === '}') {
        stack.pop()
        if (top() === 'code') stack.pop()
        push('template')
        i += 1
        continue
      }
      if (ch === "'" || ch === '"') { push(ch); i += 1; continue }
      if (ch === '`') { push('template'); i += 1; continue }
      if (ch === '/' && next === '/') { push('line-comment'); i += 2; continue }
      if (ch === '/' && next === '*') { push('block-comment'); i += 2; continue }
      i += 1
      continue
    }
    if (state === 'brace') {
      if (ch === '{') { push('brace'); i += 1; continue }
      if (ch === '}') { stack.pop(); i += 1; continue }
      i += 1
      continue
    }
    // code state
    if (ch === '/' && next === '/') { push('line-comment'); comments.push({ start: i, end: -1 }); out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
    if (ch === '/' && next === '*') { push('block-comment'); comments.push({ start: i, end: -1 }); out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
    if (ch === "'" || ch === '"') { push(ch); i += 1; continue }
    if (ch === '`') { push('template'); i += 1; continue }
    i += 1
  }
  return { code: out.join(''), comments }
}

/**
 * CJK scan over one file: strips comments, then flags every remaining line
 * that carries a CJK glyph (string literal, template, regex or JSX text).
 * Honors the `i18n-allow:` opt-out: a trailing comment spares its own line;
 * a marker in the leading comment block spares the whole file.
 * @param {string} source - raw file text.
 * @returns {{ hits: { line: number, text: string }[], fileExempt: boolean, allowedLines: number[] }}
 */
export function scanCjk(source) {
  const { code, comments } = stripComments(source)
  const lines = code.split('\n')
  const rawLines = source.split('\n')
  const leadingEnd = firstCodeOffset(code)
  const fileExempt = comments.some((c) => c.start < leadingEnd && source.slice(c.start, c.end).includes(ALLOW_MARKER))
  if (fileExempt) return { hits: [], fileExempt: true, allowedLines: [] }
  const hits = []
  const allowedLines = []
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (!CJK_RE.test(lines[idx])) continue
    if (rawLines[idx] !== undefined && rawLines[idx].includes(ALLOW_MARKER)) {
      allowedLines.push(idx + 1)
      continue
    }
    hits.push({ line: idx + 1, text: lines[idx].trim().slice(0, 160) })
  }
  return { hits, fileExempt: false, allowedLines }
}

/** Offset of the first non-whitespace, non-comment-stripped character. */
function firstCodeOffset(stripped) {
  const m = /\S/.exec(stripped)
  return m === null ? stripped.length : m.index
}

/**
 * Placeholder names inside one dictionary value.
 * @param {string} text - dictionary value.
 * @returns {string[]} sorted placeholder names.
 */
export function placeholdersOf(text) {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))].sort()
}

/**
 * Symmetric key-set diff of two dictionaries.
 * @param {Record<string, string>} a - reference (zh).
 * @param {Record<string, string>} b - mirror (en/ru).
 * @returns {{ missingInB: string[], missingInA: string[] }}
 */
export function diffKeySets(a, b) {
  const ka = new Set(Object.keys(a))
  const kb = new Set(Object.keys(b))
  return {
    missingInB: [...ka].filter((k) => !kb.has(k)).sort(),
    missingInA: [...kb].filter((k) => !ka.has(k)).sort(),
  }
}

/** Placeholder mismatches between two dictionaries, keyed by missing placeholder per key. */
export function diffPlaceholders(a, b) {
  const issues = []
  for (const key of Object.keys(a)) {
    if (!(key in b)) continue
    const pa = placeholdersOf(a[key])
    const pb = placeholdersOf(b[key])
    const onlyA = pa.filter((p) => !pb.includes(p))
    const onlyB = pb.filter((p) => !pa.includes(p))
    if (onlyA.length > 0 || onlyB.length > 0) issues.push({ key, onlyA, onlyB })
  }
  return issues
}

/* ------------------------------------------------------------------ *
 * Loading dictionary modules (real TS, through type stripping)
 * ------------------------------------------------------------------ */

/** One-shot self re-exec when the running node cannot import TS directly. */
function needsTypeStripReexec(error) {
  const codes = [error?.code, error?.cause?.code].filter(Boolean).map(String)
  return codes.some((c) => c === 'ERR_UNKNOWN_FILE_EXTENSION' || c === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')
}

function reexecWithTypeStripping() {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT_PATH, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  process.exit(result.status ?? 1)
}

async function importTs(absolutePath) {
  const url = pathToFileURL(absolutePath).href
  try {
    return await import(url)
  } catch (error) {
    if (needsTypeStripReexec(error)) reexecWithTypeStripping()
    throw error
  }
}

/**
 * Extract a namespace id from a package's client entry: the first
 * `ctx.locale.register(arg` where arg is a quoted literal, or an identifier
 * resolved against const declarations in the entry and the dictionary module.
 * @param {string} entrySource - src/client/index.ts text.
 * @param {Record<string, string>} constTable - identifier -> value from dictionary modules.
 * @returns {string | undefined}
 */
export function deriveNamespace(entrySource, constTable) {
  const ident = /locale\.register\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(entrySource)
  if (ident !== null) {
    const name = ident[1]
    if (constTable[name] !== undefined) return constTable[name]
    const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*'([^']+)'`).exec(entrySource)
    return decl?.[1]
  }
  const literal = /locale\.register\(\s*'([^']+)'\s*,/.exec(entrySource)
  return literal?.[1]
}

/** Pull the const-string table (`export const NS = 'x'`) out of a dictionary module. */
function constStrings(mod) {
  const table = {}
  for (const [key, value] of Object.entries(mod)) {
    if (typeof value === 'string') table[key] = value
  }
  return table
}

function dictionaryOf(mod, shape) {
  if (shape === 'zh-en') {
    if (mod.zh === undefined || mod.en === undefined) throw new Error('module does not export zh/en')
    return { zh: mod.zh, en: mod.en }
  }
  if (mod.dictionaries === undefined || mod.dictionaries.zh === undefined || mod.dictionaries.en === undefined) {
    throw new Error('module does not export dictionaries.zh/dictionaries.en')
  }
  return { zh: mod.dictionaries.zh, en: mod.dictionaries.en }
}

/** Load every audited package: merged zh/en dictionaries plus derived ns. */
async function loadPackages() {
  const loaded = []
  for (const entry of PACKAGES) {
    const pkgDir = join(PACKAGES_DIR, entry.pkg)
    const zh = {}
    const en = {}
    const constTable = {}
    for (const { file, shape } of entry.files) {
      const mod = await importTs(join(pkgDir, file))
      Object.assign(constTable, constStrings(mod))
      const dict = dictionaryOf(mod, shape)
      Object.assign(zh, dict.zh)
      Object.assign(en, dict.en)
    }
    const entrySource = readFileSync(join(pkgDir, 'src/client/index.ts'), 'utf8')
    const ns = deriveNamespace(entrySource, constTable)
    if (ns === undefined) throw new Error(`${entry.pkg}: cannot derive locale namespace from src/client/index.ts`)
    loaded.push({ pkg: entry.pkg, ns, zh, en })
  }
  return loaded
}

/** Load the central ru dictionaries (ns -> dict). A missing index means "no ru yet": every ns reports uncovered. */
async function loadRuDictionaries() {
  const path = join(PACKAGES_DIR, I18N_PACKAGE, RU_INDEX)
  let mod
  try {
    mod = await importTs(path)
  } catch (error) {
    const codes = [error?.code, error?.cause?.code].map(String)
    if (codes.includes('ERR_MODULE_NOT_FOUND') || codes.includes('ENOENT') || codes.includes('ENOTDIR')) return {}
    throw error
  }
  const ru = mod.ruDictionaries
  if (ru === undefined || typeof ru !== 'object') {
    return {}
  }
  return ru
}

/* ------------------------------------------------------------------ *
 * File walking
 * ------------------------------------------------------------------ */

const CLIENT_EXTS = new Set(['.ts', '.tsx'])

function isDictionaryFile(relFile) {
  if (/locales\.tsx?$/.test(relFile) || /-locales\.tsx?$/.test(relFile)) return true
  // The dsh-i18n ru files are dictionaries too: their keys legitimately carry
  // zh text (some namespaces key entries by their zh label), and their values
  // are Russian. Value-level CJK is checked separately in checkMode.
  if (relFile.startsWith(join('packages', I18N_PACKAGE, 'src/client/ru/'))) return true
  return false
}

function walkClientFiles() {
  const files = []
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const clientDir = join(PACKAGES_DIR, entry.name, 'src/client')
    const stack = [clientDir]
    while (stack.length > 0) {
      const dir = stack.pop()
      let items
      try { items = readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const item of items) {
        const full = join(dir, item.name)
        const rel = relative(ROOT, full)
        if (item.isDirectory()) { stack.push(full); continue }
        if (!CLIENT_EXTS.has(extOf(item.name))) continue
        if (/\.test\./.test(item.name)) continue
        if (isDictionaryFile(rel)) continue
        files.push({ pkg: entry.name, rel, full })
      }
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel))
}

function walkHostFiles() {
  const files = []
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const rel of ['src/index.ts', 'src/core']) {
      const full = join(PACKAGES_DIR, entry.name, rel)
      const stack = [full]
      while (stack.length > 0) {
        const dir = stack.pop()
        let items
        try { items = readdirSync(dir, { withFileTypes: true }) } catch { continue }
        for (const item of items) {
          const f = join(dir, item.name)
          const r = relative(ROOT, f)
          if (item.isDirectory()) { stack.push(f); continue }
          if (!CLIENT_EXTS.has(extOf(item.name))) continue
          if (/\.test\./.test(item.name)) continue
          files.push({ pkg: entry.name, rel: r, full: f })
        }
      }
    }
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel))
}

function extOf(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

/* ------------------------------------------------------------------ *
 * Modes
 * ------------------------------------------------------------------ */

function checkMode(packages, ruDictionaries) {
  const errors = []
  const warnings = []
  const exemptions = []

  for (const { pkg, ns, zh, en } of packages) {
    const diff = diffKeySets(zh, en)
    if (diff.missingInB.length > 0) errors.push(`[${pkg}] ns "${ns}": keys missing in en (${diff.missingInB.length}): ${diff.missingInB.join(', ')}`)
    if (diff.missingInA.length > 0) errors.push(`[${pkg}] ns "${ns}": keys missing in zh but present in en (${diff.missingInA.length}): ${diff.missingInA.join(', ')}`)
    for (const issue of diffPlaceholders(zh, en)) {
      errors.push(`[${pkg}] ns "${ns}" key "${key}": placeholder mismatch zh vs en (zh-only: ${issue.onlyA.join(', ') || 'none'}; en-only: ${issue.onlyB.join(', ') || 'none'})`)
    }
  }

  for (const file of walkClientFiles()) {
    const source = readFileSync(file.full, 'utf8')
    const { hits, fileExempt, allowedLines } = scanCjk(source)
    if (fileExempt) {
      exemptions.push(`${file.rel} (file-level ${ALLOW_MARKER})`)
      continue
    }
    for (const line of allowedLines) exemptions.push(`${file.rel}:${line} (line-level ${ALLOW_MARKER})`)
    for (const hit of hits) errors.push(`[${file.rel}:${hit.line}] CJK outside comments: ${hit.text}`)
  }
  for (const file of walkHostFiles()) {
    const source = readFileSync(file.full, 'utf8')
    const { hits, fileExempt, allowedLines } = scanCjk(source)
    if (fileExempt) {
      exemptions.push(`${file.rel} (file-level ${ALLOW_MARKER})`)
      continue
    }
    for (const line of allowedLines) exemptions.push(`${file.rel}:${line} (line-level ${ALLOW_MARKER})`)
    for (const hit of hits) warnings.push(`[${file.rel}:${hit.line}] CJK in host half (warning only): ${hit.text}`)
  }

  const ruByNs = new Map(Object.entries(ruDictionaries))
  for (const { pkg, ns, zh } of packages) {
    const ru = ruByNs.get(ns)
    if (ru === undefined) {
      errors.push(`[${I18N_PACKAGE}] ns "${ns}" (from ${pkg}): no ru dictionary`)
      continue
    }
    const diff = diffKeySets(zh, ru)
    if (diff.missingInB.length > 0) {
      errors.push(`[${I18N_PACKAGE}] ns "${ns}": ru missing ${diff.missingInB.length} zh keys: ${diff.missingInB.join(', ')}`)
    }
    if (diff.missingInA.length > 0) {
      warnings.push(`[${I18N_PACKAGE}] ns "${ns}": ru carries ${diff.missingInA.length} keys absent from zh (dead keys): ${diff.missingInA.join(', ')}`)
    }
    for (const [key, value] of Object.entries(ru)) {
      if (typeof value === 'string' && CJK_RE.test(value)) {
        errors.push(`[${I18N_PACKAGE}] ns "${ns}" key "${key}": CJK inside a ru value (untranslated copy or wrong dict?)`)
      }
    }
    for (const issue of diffPlaceholders(zh, ru)) {
      errors.push(`[${I18N_PACKAGE}] ns "${ns}" key "${issue.key}": placeholder mismatch zh vs ru (zh-only: ${issue.onlyA.join(', ') || 'none'}; ru-only: ${issue.onlyB.join(', ') || 'none'})`)
    }
  }
  const unknownNs = [...ruByNs.keys()].filter((ns) => !packages.some((p) => p.ns === ns))
  for (const ns of unknownNs) warnings.push(`[${I18N_PACKAGE}] ru dictionary for unknown ns "${ns}" (no audited package registers it)`)

  return { errors, warnings, exemptions }
}

function templateMode(packages) {
  const out = {}
  for (const { ns, zh, en } of packages) {
    const nsOut = {}
    for (const key of Object.keys(zh).sort()) {
      nsOut[key] = { zh: zh[key], en: en[key] ?? '' }
    }
    out[ns] = nsOut
  }
  return out
}

function reportMode(packages, ruDictionaries, audit) {
  const ruByNs = new Map(Object.entries(ruDictionaries))
  console.log('| ns | package | zh | en | ru | ru coverage |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const { pkg, ns, zh, en } of packages) {
    const ru = ruByNs.get(ns)
    const ruKeys = ru === undefined ? 0 : Object.keys(ru).length
    const covered = ru === undefined ? 0 : Object.keys(zh).filter((k) => k in ru).length
    const total = Object.keys(zh).length
    const pct = total === 0 ? 'n/a' : `${Math.round((covered / total) * 100)}%`
    console.log(`| ${ns} | ${pkg} | ${Object.keys(zh).length} | ${Object.keys(en).length} | ${ruKeys} | ${pct} |`)
  }
  const totalZh = packages.reduce((sum, p) => sum + Object.keys(p.zh).length, 0)
  const totalCovered = packages.reduce((sum, p) => {
    const ru = ruByNs.get(p.ns)
    return sum + (ru === undefined ? 0 : Object.keys(p.zh).filter((k) => k in ru).length)
  }, 0)
  console.log('')
  console.log(`Total zh keys: ${totalZh}; ru-covered: ${totalCovered} (${totalZh === 0 ? 'n/a' : Math.round((totalCovered / totalZh) * 100)}%)`)
  console.log('')
  if (audit.exemptions.length > 0) {
    console.log('Exemptions:')
    for (const e of audit.exemptions) console.log(`  - ${e}`)
  } else {
    console.log('Exemptions: none')
  }
}

const HELP = `
Usage: node scripts/i18n-audit.mjs [--check] [--template] [--report] [--help]

  --check     Gate mode (default): zh/en parity, placeholder parity, client CJK
              scan, ru coverage. Exit 1 on any failure.
  --template  Print { ns: { key: { zh, en } } } JSON for translation work.
  --report    Per-namespace key counts, ru coverage and the exemption list.
  --help      This text.
`.trim()

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  const template = args.includes('--template')
  const report = args.includes('--report')
  const check = !template && !report

  const packages = await loadPackages()
  const ruDictionaries = template ? {} : await loadRuDictionaries()
  const audit = checkMode(packages, ruDictionaries)

  if (template) {
    console.log(JSON.stringify(templateMode(packages), null, 2))
    return
  }
  if (report) {
    reportMode(packages, ruDictionaries, audit)
    return
  }

  for (const w of audit.warnings) console.warn(`[i18n-audit] WARN ${w}`)
  if (audit.exemptions.length > 0) {
    console.log(`[i18n-audit] exemptions (${audit.exemptions.length}):`)
    for (const e of audit.exemptions) console.log(`  - ${e}`)
  }
  if (audit.errors.length > 0) {
    for (const e of audit.errors) console.error(`[i18n-audit] ERROR ${e}`)
    console.error(`[i18n-audit] FAILED: ${audit.errors.length} error(s)`)
    process.exit(1)
  }
  const ruKeys = packages.reduce((sum, p) => sum + Object.keys(ruDictionaries[p.ns] ?? {}).length, 0)
  console.log(`[i18n-audit] OK: ${packages.length} namespaces, ${packages.reduce((s, p) => s + Object.keys(p.zh).length, 0)} zh keys, ${ruKeys} ru keys, ${audit.exemptions.length} exemption(s), ${audit.warnings.length} host-half warning(s)`)
}

// When run directly — including after the type-stripping re-exec, where the
// flag sits at argv[1] and this script at argv[2]. Both sides go through
// realpath: macOS /tmp-style symlinks make argv[1] and import.meta.url differ.
const real = (p) => realpathSync(p)
const invokedDirectly = process.argv.slice(1, 3).some((arg) => {
  try { return real(fileURLToPath(pathToFileURL(arg).href)) === real(SCRIPT_PATH) } catch { return false }
})
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[i18n-audit] crashed: ${error?.stack ?? error}`)
    process.exit(1)
  })
}
