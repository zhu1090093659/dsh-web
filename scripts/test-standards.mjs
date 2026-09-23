#!/usr/bin/env node
/**
 * Test-standards gate for the dsh-web monorepo.
 *
 * Business test discipline is a repository contract, not a personal style. A
 * test names the role it certifies, states its precondition, action and
 * observable outcome, drives time deterministically instead of sleeping, does
 * not patch the module graph or service methods ad hoc, and asserts domain
 * state rather than collaborator call counts. This gate makes those rules
 * mechanical so they survive review pressure.
 *
 * The corpus predates the gate, so existing violations are grandfathered in
 * scripts/test-standards-baseline.json, keyed by file -> rule -> count:
 *
 *   - a NEW test file starts from a zero baseline, so every rule binds it;
 *   - an existing file may not gain violations (a count may not grow), which
 *     is what makes the rule hold for tests added to old files;
 *   - a file whose count shrinks is reported, so the baseline ratchets down
 *     instead of freezing the debt forever.
 *
 * Counting per file, per rule avoids line-content fingerprints (stable across
 * reordering, formatting and unrelated edits) and avoids diff parsing, so the
 * identical check runs locally and in CI over the full tree.
 *
 * Rules:
 *   no-arbitrary-sleep         setTimeout/setInterval/sleep/delay waits flake
 *                              under load; use vi.useFakeTimers() with
 *                              advanceTimersByTime(), or a bounded waitFor.
 *   no-ad-hoc-mock             vi.mock, vi.spyOn, jest.* and sinon.* patch the
 *                              module graph or a service method; inject a fake
 *                              or use a real backing store.
 *   bdd-title                  an it/test title starts with the role under test
 *                              (user/customer/admin/guest/operator), readable
 *                              without opening the implementation.
 *   given-when-then            the test body names its precondition, action and
 *                              observable outcome.
 *   call-count-only-assertion  the body asserts only that a collaborator was
 *                              called, with no domain state or return value.
 *   tautological-assertion     toBeDefined()/toBeTruthy()/not.toBeNull() only
 *                              restates that a value exists.
 *
 * A rule can be waived per physical line (trailing marker) or for a whole file
 * (marker in the leading comment block) with the marker printed below,
 * mirroring the i18n-allow convention in scripts/i18n-audit.mjs. The reason is
 * mandatory in review; the marker keeps a documented exception from having to
 * weaken the global rule.
 *
 * Usage:
 *   node scripts/test-standards.mjs                  # gate: fail on new debt
 *   node scripts/test-standards.mjs --report         # per-rule counts, exit 0
 *   node scripts/test-standards.mjs --write-baseline # re-record the baseline
 *   node scripts/test-standards.mjs [paths...]       # scope the scan
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SCRIPT_PATH), '..')
const BASELINE_PATH = join(dirname(SCRIPT_PATH), 'test-standards-baseline.json')

/** Trailing (per line) or leading-block (per file) waiver marker. */
export const ALLOW_MARKER = 'test-standards-allow:'

/** Test-file names the gate audits, matching every runner in this repository. */
const TEST_FILE_RE = /\.(?:spec|test)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/** Directories that never hold first-party tests. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'lib', 'dist', 'coverage', 'playwright-report',
  'test-results', '.codegraph', '.zcode', '.pnpm-store', '.dsh', '.wrangler',
  'gui-test-screenshots', 'marketing',
])

/** Vendored subtrees whose tests are not ours to standardize. */
const SKIP_PREFIXES = ['market/shell/']

/** Rule ids in report order. */
export const RULES = [
  'no-arbitrary-sleep',
  'no-ad-hoc-mock',
  'bdd-title',
  'given-when-then',
  'call-count-only-assertion',
  'tautological-assertion',
]

/**
 * Business-behavior lanes carry the full contract, including the BDD title and
 * Given/When/Then structure rules. scripts/ holds repository tooling, whose
 * tests are ordinary unit tests of pure functions: naming them after a user
 * role would be fiction, so only the mechanical rules apply there.
 */
const BUSINESS_LANE_RE = /^(?:packages|tests|desktop)\//
const SCRIPT_LANE_RULES = ['no-arbitrary-sleep', 'no-ad-hoc-mock', 'call-count-only-assertion', 'tautological-assertion']

/** Every rule applies to a business-behavior test file. */
export function isBusinessLane(relPath) {
  return BUSINESS_LANE_RE.test(relPath)
}

const LINE_RULES = [
  { id: 'no-arbitrary-sleep', re: /\b(?:setTimeout|setInterval|sleep|delay)\s*\(/ },
  { id: 'no-ad-hoc-mock', re: /\b(?:vi|jest)\.(?:mock|doMock|unmock|spyOn)\s*\(|\bsinon\.(?:stub|mock|spy|fake)\s*\(/ },
  { id: 'tautological-assertion', re: /\.(?:toBeDefined|toBeTruthy|toBeFalsy)\s*\(\s*\)|\.not\.(?:toBeNull|toBeUndefined|toBeDefined)\s*\(\s*\)/ },
]

/** Matchers that assert a collaborator interaction rather than a domain value. */
const CALL_COUNT_MATCHERS = new Set(['toHaveBeenCalled', 'toHaveBeenCalledTimes'])

/** Matchers that assert a domain value, a payload or an observable outcome. */
const VALUE_MATCHERS = new Set([
  'toBe', 'toEqual', 'toStrictEqual', 'toMatchObject', 'toMatch', 'toContain',
  'toContainEqual', 'toHaveLength', 'toBeCloseTo', 'toBeGreaterThan',
  'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual',
  'toBeInstanceOf', 'toBeNull', 'toBeUndefined', 'toBeNaN', 'toBeTruthy',
  'toBeFalsy', 'toThrow', 'toThrowError', 'toResolve', 'toReject', 'toSatisfy',
  'toHaveProperty', 'toHaveBeenCalledWith', 'toHaveBeenLastCalledWith',
  'toHaveBeenNthCalledWith', 'toMatchSnapshot', 'toMatchInlineSnapshot',
])

const MATCHER_RE = /\.([A-Za-z][A-Za-z0-9]*)\s*\(/g
const EXPECT_RE = /\bexpect\s*\(/

/** A title certifies a role when it starts with one. */
const BDD_ROLE_RE = /^\s*(?:user|customer|admin|guest|operator|visitor|tenant|member)\b/i
const GWT_MARKERS = [/\bGiven\b/i, /\bWhen\b/i, /\bThen\b/i]

/** Test-call heads: it/test with optional modifiers (it.each(cases)(...)). */
const TEST_CALL_RE = /\b(it|test)\b((?:\.[A-Za-z]+)*)\s*\(/g

/** Modifiers that announce a suite or a hook, not a test. */
const SUITE_MODIFIERS_RE = /\.(?:describe|use|before|after|step|extend|configure|slow|fixme)/

// ------------------------------------------------------------------ scanner

/**
 * Split a source into three parallel, same-length views:
 *   raw    - the file as committed;
 *   code   - comments blanked, string/template contents kept;
 *   masked - comments blanked, string/template contents blanked too.
 *
 * Titles are read from code; brackets, matchers and call syntax are read from
 * masked, so a fixture string containing setTimeout( or () can neither hide a
 * violation nor desync block matching. Equal lengths keep offsets and line
 * numbers aligned across the three views.
 */
export function scanSource(source) {
  const n = source.length
  const code = new Array(n)
  const masked = new Array(n)
  const blank = (i) => {
    code[i] = source[i] === '\n' ? '\n' : ' '
    masked[i] = source[i] === '\n' ? '\n' : ' '
  }
  const keep = (i, hide) => {
    code[i] = source[i]
    masked[i] = hide && source[i] !== '\n' ? ' ' : source[i]
  }

  let i = 0
  while (i < n) {
    const ch = source[i]

    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') blank(i++)
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      blank(i++)
      blank(i++)
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) blank(i++)
      if (i < n) {
        blank(i++)
        blank(i++)
      }
      continue
    }
    if (ch === '/' && isRegexStart(source, i)) {
      keep(i++, false)
      let inClass = false
      while (i < n) {
        const c = source[i]
        if (c === '\\') {
          keep(i++, false)
          keep(i++, false)
          continue
        }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) {
          keep(i++, false)
          break
        } else if (c === '\n') break
        keep(i++, false)
      }
      while (i < n && /[a-z]/.test(source[i])) keep(i++, false)
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      keep(i++, false)
      while (i < n && source[i] !== quote) {
        if (source[i] === '\n') break
        if (source[i] === '\\') {
          keep(i++, true)
          keep(i++, true)
          continue
        }
        keep(i++, true)
      }
      if (i < n && source[i] === quote) keep(i++, false)
      continue
    }
    if (ch === '`') {
      keep(i++, false)
      while (i < n) {
        const c = source[i]
        if (c === '\\') {
          keep(i++, true)
          keep(i++, true)
          continue
        }
        if (c === '`') {
          keep(i++, false)
          break
        }
        if (c === '$' && source[i + 1] === '{') {
          keep(i++, false)
          keep(i++, false)
          i = scanTemplateExpression(source, i, code, masked)
          continue
        }
        keep(i++, true)
      }
      continue
    }
    keep(i++, false)
  }
  return { raw: source, code: code.join(''), masked: masked.join('') }
}

/** A slash starts a regex unless the previous token can end an expression. */
export function isRegexStart(source, i) {
  let j = i - 1
  while (j >= 0 && /\s/.test(source[j])) j--
  if (j < 0) return true
  const prev = source[j]
  if (/[A-Za-z0-9_$)\]}"'`]/.test(prev)) {
    const head = source.slice(Math.max(0, j - 8), j + 1).match(/([A-Za-z_$]+)$/)
    if (!head) return false
    return /^(?:return|typeof|instanceof|in|of|case|do|else|void|delete|new|yield|await)$/.test(head[1])
  }
  return true
}

/** Copy a template expression (after its opening brace) as code. */
function scanTemplateExpression(source, start, code, masked) {
  let i = start
  let depth = 1
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (ch === '{') {
      depth++
      code[i] = ch
      masked[i] = ch
      i++
      continue
    }
    if (ch === '}') {
      depth--
      code[i] = ch
      masked[i] = ch
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      code[i] = ch
      masked[i] = ch
      i++
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          code[i] = source[i]
          masked[i] = ' '
          i++
          code[i] = source[i]
          masked[i] = ' '
          i++
          continue
        }
        code[i] = source[i]
        masked[i] = ' '
        i++
      }
      if (i < source.length) {
        code[i] = quote
        masked[i] = quote
        i++
      }
      continue
    }
    code[i] = ch
    masked[i] = ch
    i++
  }
  return i
}

/** Offsets of every line start, for index to line-number conversion. */
export function lineStarts(source) {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  return starts
}

/** 1-based line number of a byte offset. */
export function lineOf(starts, index) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= index) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** Index of the bracket closing the one at open, or -1. */
export function matchPair(text, open) {
  const opener = text[open]
  const closer = opener === '(' ? ')' : opener === '{' ? '}' : opener === '[' ? ']' : null
  if (!closer) return -1
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === opener) depth++
    else if (ch === closer) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Read the string literal at i, or null when the call takes a variable. */
function readStringAt(code, i) {
  const quote = code[i]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  let out = ''
  let j = i + 1
  while (j < code.length && code[j] !== quote) {
    if (code[j] === '\\') {
      out += code[j + 1] ?? ''
      j += 2
      continue
    }
    if (code[j] === '\n') break
    out += code[j]
    j++
  }
  return { value: out, end: code[j] === quote ? j + 1 : j }
}

/**
 * Every it/test call in the file, with its title and its argument span.
 * Titles come from code (string contents intact); spans are measured on masked
 * so parentheses inside a title or a fixture cannot desync the match.
 */
export function extractTests(views) {
  const { code, masked, raw } = views
  const starts = lineStarts(code)
  const tests = []
  TEST_CALL_RE.lastIndex = 0
  let m
  while ((m = TEST_CALL_RE.exec(code))) {
    const modifiers = m[2]
    if (SUITE_MODIFIERS_RE.test(modifiers)) continue
    let openIndex = m.index + m[0].length - 1
    if (/\.(?:each|for)\b/.test(modifiers)) {
      const close = matchPair(masked, openIndex)
      if (close < 0) continue
      const next = masked.indexOf('(', close)
      if (next < 0) continue
      openIndex = next
    }
    const closeIndex = matchPair(masked, openIndex)
    if (closeIndex < 0) continue
    let cursor = openIndex + 1
    while (cursor < closeIndex && /\s/.test(code[cursor])) cursor++
    const literal = readStringAt(code, cursor)
    const title = literal ? literal.value : null
    const bodyStart = literal ? literal.end : cursor
    tests.push({
      kind: m[1],
      title,
      line: lineOf(starts, openIndex),
      endLine: lineOf(starts, closeIndex),
      bodyText: raw.slice(bodyStart, closeIndex),
      bodyMasked: masked.slice(bodyStart, closeIndex),
    })
  }
  return tests
}

/** Leading comment-block marker waives the entire file. */
export function fileWaived(rawLines) {
  for (const line of rawLines) {
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) {
      if (line.includes(ALLOW_MARKER)) return true
    } else if (line.trim() !== '') {
      return false
    }
  }
  return false
}

/** Per-line waiver: the marker anywhere on the physical line. */
export function linesWithMarker(rawLines) {
  const waived = new Set()
  rawLines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) waived.add(index + 1)
  })
  return waived
}

/** Matcher names used inside a test body. */
export function matchersIn(bodyMasked) {
  const found = new Set()
  MATCHER_RE.lastIndex = 0
  let m
  while ((m = MATCHER_RE.exec(bodyMasked))) {
    if (CALL_COUNT_MATCHERS.has(m[1]) || VALUE_MATCHERS.has(m[1])) found.add(m[1])
  }
  return found
}

/** Audit one source file; returns rule -> violations plus the tests found. */
export function scanFile(source, options = {}) {
  const rules = options.rules ?? RULES
  const bdd = rules.includes('bdd-title') && rules.includes('given-when-then')
  const views = scanSource(source)
  const rawLines = source.split('\n')
  const waived = fileWaived(rawLines)
  const waivedLines = waived ? new Set() : linesWithMarker(rawLines)
  const violations = {}
  const add = (rule, line, detail) => {
    if (waived || waivedLines.has(line)) return
    if (!violations[rule]) violations[rule] = []
    violations[rule].push({ line, detail })
  }

  if (waived) return { violations, tests: [] }

  const maskedLines = views.masked.split('\n')
  maskedLines.forEach((text, index) => {
    for (const rule of LINE_RULES) {
      if (!rules.includes(rule.id)) continue
      if (rule.re.test(text)) add(rule.id, index + 1, (rawLines[index] ?? '').trim().slice(0, 120))
    }
  })

  const tests = extractTests(views)
  for (const test of tests) {
    if (bdd && test.title !== null) {
      if (!BDD_ROLE_RE.test(test.title)) add('bdd-title', test.line, test.title.slice(0, 120))
      if (!GWT_MARKERS.every((re) => re.test(test.bodyText))) {
        add('given-when-then', test.line, test.title.slice(0, 120))
      }
    }
    const matchers = matchersIn(test.bodyMasked)
    if (rules.includes('call-count-only-assertion') && EXPECT_RE.test(test.bodyMasked) && matchers.size > 0) {
      const callCount = [...matchers].some((name) => CALL_COUNT_MATCHERS.has(name))
      const value = [...matchers].some((name) => VALUE_MATCHERS.has(name))
      if (callCount && !value) {
        add('call-count-only-assertion', test.line, (test.title ?? '').slice(0, 120))
      }
    }
  }
  return { violations, tests }
}

// ------------------------------------------------------------- filesystem

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
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (SKIP_PREFIXES.some((prefix) => (rel + '/').startsWith(prefix))) continue
      walk(full, out)
    } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      out.push(rel)
    }
  }
  return out
}

/** All audited test files, optionally filtered by path substrings. */
export function collectTestFiles(filters = []) {
  const files = walk(ROOT, []).sort()
  if (filters.length === 0) return files
  return files.filter((file) => filters.some((filter) => file === filter || file.includes(filter)))
}

/** file -> rule -> count, plus up to three samples per file and rule. */
export function auditFiles(files, readSource) {
  const counts = {}
  const samples = {}
  let testCount = 0
  for (const file of files) {
    const source = readSource(file)
    if (source === null) continue
    const { violations, tests } = scanFile(source, { rules: isBusinessLane(file) ? RULES : SCRIPT_LANE_RULES })
    testCount += tests.length
    const perRule = {}
    for (const [rule, list] of Object.entries(violations)) {
      if (list.length === 0) continue
      perRule[rule] = list.length
      samples[rule + '\u0000' + file] = list.slice(0, 3)
    }
    if (Object.keys(perRule).length > 0) counts[file] = perRule
  }
  return { counts, samples, testCount }
}

/** Compare current counts against the recorded baseline. */
export function diffAgainstBaseline(current, baseline) {
  const regressions = []
  const improvements = []
  for (const [file, rules] of Object.entries(current)) {
    const base = (baseline.files ?? {})[file] ?? {}
    for (const [rule, count] of Object.entries(rules)) {
      const before = base[rule] ?? 0
      if (count > before) regressions.push({ file, rule, before, after: count })
    }
  }
  for (const [file, rules] of Object.entries(baseline.files ?? {})) {
    const now = current[file] ?? {}
    for (const [rule, count] of Object.entries(rules)) {
      const after = now[rule] ?? 0
      if (after < count) improvements.push({ file, rule, before: count, after })
    }
  }
  const order = (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule)
  regressions.sort(order)
  improvements.sort(order)
  return { regressions, improvements }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { version: 1, rules: RULES, files: {} }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

/** Recorded counts, pruning rules that reach zero and files that become clean. */
export function normalizeCounts(counts) {
  const files = {}
  for (const file of Object.keys(counts).sort()) {
    const rules = {}
    for (const rule of RULES) if (counts[file][rule]) rules[rule] = counts[file][rule]
    if (Object.keys(rules).length > 0) files[file] = rules
  }
  return files
}

/**
 * One file per line: the ledger is reviewed in diffs, and a nested JSON dump
 * would turn a one-file ratchet into a five-line hunk.
 */
export function serializeBaseline(files) {
  const names = Object.keys(files).sort()
  const lines = ['{', '  "version": 1,', '  "rules": ' + JSON.stringify(RULES) + ',', '  "files": {']
  names.forEach((name, index) => {
    lines.push('    ' + JSON.stringify(name) + ': ' + JSON.stringify(files[name]) + (index === names.length - 1 ? '' : ','))
  })
  lines.push('  }', '}')
  return lines.join('\n') + '\n'
}

/** Rewrite the baseline from a fresh audit; stale entries are pruned. */
export function writeBaseline(counts) {
  const files = normalizeCounts(counts)
  writeFileSync(BASELINE_PATH, serializeBaseline(files))
  return { version: 1, rules: RULES, files }
}

const USAGE = [
  'Usage: node scripts/test-standards.mjs [--check] [--report] [--write-baseline] [paths...]',
  '',
  '  --check           gate mode (default): fail when a file gains violations',
  '  --report          per-rule totals and largest offenders, exit 0',
  '  --write-baseline  re-record scripts/test-standards-baseline.json',
  '  paths...          only audit test files whose path contains one of these',
  '  --help            this text',
  '',
  'Waive a rule with a "' + ALLOW_MARKER + ' <reason>" marker: trailing on the',
  'physical line, or in the file leading comment block to waive the whole file.',
].join('\n')

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  const filters = args.filter((arg) => !arg.startsWith('-'))
  const files = collectTestFiles(filters)
  const { counts, samples, testCount } = auditFiles(files, (file) => {
    try {
      return readFileSync(join(ROOT, file), 'utf8')
    } catch {
      return null
    }
  })

  if (args.includes('--write-baseline')) {
    const payload = writeBaseline(counts)
    const total = Object.values(payload.files).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0)
    console.log('[test-standards] baseline written: ' + Object.keys(payload.files).length + ' file(s), ' + total + ' violation(s)')
    return 0
  }

  if (args.includes('--report')) {
    const totals = {}
    for (const rules of Object.values(counts)) {
      for (const [rule, count] of Object.entries(rules)) totals[rule] = (totals[rule] ?? 0) + count
    }
    console.log('[test-standards] scanned ' + files.length + ' test file(s), ' + testCount + ' test(s)')
    for (const rule of RULES) console.log('  ' + String(totals[rule] ?? 0).padStart(6) + '  ' + rule)
    const offenders = Object.entries(counts)
      .map(([file, rules]) => ({ file, total: Object.values(rules).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file))
      .slice(0, 15)
    console.log('[test-standards] largest offenders:')
    for (const item of offenders) console.log('  ' + String(item.total).padStart(5) + '  ' + item.file)
    return 0
  }

  const { regressions, improvements } = diffAgainstBaseline(counts, readBaseline())
  console.log('[test-standards] scanned ' + files.length + ' test file(s), ' + testCount + ' test(s)')

  if (improvements.length > 0) {
    console.log('[test-standards] ratchet-down available (' + improvements.length + '); record it with --write-baseline:')
    for (const item of improvements.slice(0, 10)) {
      console.log('  ' + item.file + ' ' + item.rule + ' ' + item.before + ' -> ' + item.after)
    }
    if (improvements.length > 10) console.log('  ... ' + (improvements.length - 10) + ' more')
  }

  if (regressions.length === 0) {
    console.log('[test-standards] OK: no file gained violations')
    return 0
  }
  console.log('[test-standards] FAIL: ' + regressions.length + ' new violation group(s):')
  for (const item of regressions) {
    console.log('  ' + item.file + ' ' + item.rule + ' ' + item.before + ' -> ' + item.after)
    for (const sample of samples[item.rule + '\u0000' + item.file] ?? []) {
      console.log('      line ' + sample.line + ': ' + sample.detail)
    }
  }
  console.log('[test-standards] new tests must follow the rule above; a documented exception uses the')
  console.log('"' + ALLOW_MARKER + ' <reason>" marker. See the script header for each rule.')
  return 1
}

const invokedDirectly = process.argv[1] ? resolve(process.argv[1]) === SCRIPT_PATH : false
if (invokedDirectly) process.exit(main())
