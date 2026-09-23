/**
 * Unit tests for the test-standards gate core: the three-view scanner, test
 * extraction, every rule detector, the waiver markers, lane scoping and the
 * baseline ratchet. The end-to-end gate itself is pnpm test:standards.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RULES,
  diffAgainstBaseline,
  extractTests,
  fileWaived,
  isBusinessLane,
  lineOf,
  lineStarts,
  matchPair,
  matchersIn,
  scanFile,
  scanSource,
} from './test-standards.mjs'

/** The mechanical rules, which is what the scripts/ lane is held to. */
const SCRIPT_RULES = RULES.filter((rule) => rule !== 'bdd-title' && rule !== 'given-when-then')

/** Rule -> violation count for one source. */
function violations(source, options) {
  const found = scanFile(source, options).violations
  const counts = {}
  for (const [rule, list] of Object.entries(found)) counts[rule] = list.length
  return counts
}

describe('scanSource', () => {
  it('blanks comments without moving offsets or line numbers', () => {
    const source = ['const a = 1 // trailing', '/* block', '   still block */', 'const b = 2'].join('\n')
    const views = scanSource(source)
    assert.equal(views.code.length, source.length)
    assert.equal(views.code.split('\n').length, source.split('\n').length)
    assert.ok(!views.code.includes('trailing'))
    assert.ok(!views.code.includes('still block'))
    assert.ok(views.code.includes('const b = 2'))
  })

  it('keeps string contents in code and blanks them in masked', () => {
    const views = scanSource("const s = 'setTimeout(boom)'")
    assert.ok(views.code.includes('setTimeout(boom)'))
    assert.ok(!views.masked.includes('setTimeout'))
  })

  it('does not read a slash inside a regex literal as a comment', () => {
    const views = scanSource('const re = /a\\/\\/b/g\nconst after = 1')
    assert.ok(views.code.includes('const after = 1'))
    assert.ok(views.masked.includes('const after = 1'))
  })

  it('does not read division as a regex literal', () => {
    const views = scanSource('const half = total / 2\nconst next = 1')
    assert.ok(views.code.includes('const next = 1'))
    assert.ok(views.masked.includes('const next = 1'))
  })

  it('keeps a template interpolation as code', () => {
    const views = scanSource('const m = `v=${value`')
    assert.ok(views.masked.includes('value'))
    assert.ok(!views.masked.includes('v='))
  })
})

describe('extractTests', () => {
  it('reads the title, the first line and the argument span', () => {
    const tests = extractTests(scanSource("it('rejects a bad token', () => {\n  expect(1).toBe(1)\n})"))
    assert.equal(tests.length, 1)
    assert.equal(tests[0].title, 'rejects a bad token')
    assert.equal(tests[0].line, 1)
    assert.equal(tests[0].endLine, 3)
    assert.ok(tests[0].bodyMasked.includes('toBe'))
  })

  it('is not desynced by parentheses inside a title', () => {
    const tests = extractTests(scanSource("it('user (admin) sees it', () => { expect(1).toBe(1) })"))
    assert.equal(tests.length, 1)
    assert.equal(tests[0].title, 'user (admin) sees it')
    assert.ok(tests[0].bodyMasked.includes('toBe'))
  })

  it('skips suite and hook heads', () => {
    const tests = extractTests(scanSource("test.describe('suite', () => { test.beforeEach(() => {}) })\nit('x', () => {})"))
    assert.equal(tests.length, 1)
    assert.equal(tests[0].title, 'x')
  })

  it('reads the title of an each table head', () => {
    const tests = extractTests(scanSource('it.each([[1]])("user sees %i", () => {})'))
    assert.equal(tests.length, 1)
    assert.equal(tests[0].title, 'user sees %i')
  })

  it('leaves a computed title unset', () => {
    const tests = extractTests(scanSource('it(someName, () => {})'))
    assert.equal(tests[0].title, null)
  })
})

describe('rule detection', () => {
  it('flags a wait but not the same text inside a fixture string', () => {
    assert.deepEqual(violations("it('x', () => { setTimeout(f, 10) })", { rules: SCRIPT_RULES }), { 'no-arbitrary-sleep': 1 })
    assert.deepEqual(violations('it("x", () => { const s = "setTimeout(f, 10)" })', { rules: SCRIPT_RULES }), {})
  })

  it('flags module and method mocking', () => {
    const counts = violations("vi.mock('./db')\nvi.spyOn(service, 'save')", { rules: SCRIPT_RULES })
    assert.deepEqual(counts, { 'no-ad-hoc-mock': 2 })
  })

  it('flags tautological assertions', () => {
    const counts = violations("it('user loads', () => { expect(result).toBeDefined() })")
    assert.equal(counts['tautological-assertion'], 1)
  })

  it('requires a role-prefixed title in the business lane', () => {
    assert.equal(violations("it('rejects a bad token', () => {})")['bdd-title'], 1)
    assert.equal(violations("it('user with a bad token is rejected', () => {})")['bdd-title'], undefined)
  })

  it('requires Given, When and Then in the body', () => {
    const structured = "it('user retrying pays once', () => {\n  // Given a stored order\n  // When the user retries\n  // Then one order exists\n})"
    assert.equal(violations(structured)['given-when-then'], undefined)
    assert.equal(violations("it('user retrying pays once', () => {})")['given-when-then'], 1)
  })

  it('flags a call-count-only test but not one asserting state or payload', () => {
    assert.equal(violations("it('user saves', () => { expect(db.save).toHaveBeenCalledTimes(1) })")['call-count-only-assertion'], 1)
    const state = "it('user saves', () => { expect(db.save).toHaveBeenCalledTimes(1); expect(row.count).toBe(1) })"
    assert.equal(violations(state)['call-count-only-assertion'], undefined)
    const payload = "it('user saves', () => { expect(db.save).toHaveBeenCalledWith({ id: 1 }) })"
    assert.equal(violations(payload)['call-count-only-assertion'], undefined)
  })
})

describe('waivers', () => {
  it('honors a trailing marker on the physical line', () => {
    const source = "it('x', () => { setTimeout(f, 10) }) // test-standards-allow: legacy poll interval"
    assert.deepEqual(violations(source, { rules: SCRIPT_RULES }), {})
  })

  it('honors a leading block marker for the whole file', () => {
    const source = "// test-standards-allow: vendored compatibility fixture\nit('x', () => { setTimeout(f, 10) })"
    assert.deepEqual(violations(source, { rules: SCRIPT_RULES }), {})
  })

  it('does not waive a file when the marker is not in the leading block', () => {
    const source = "import x from 'y'\n// test-standards-allow: too late\nit('x', () => { setTimeout(f, 10) })"
    assert.deepEqual(violations(source, { rules: SCRIPT_RULES }), { 'no-arbitrary-sleep': 1 })
    assert.equal(fileWaived(source.split('\n')), false)
  })
})

describe('lane scoping', () => {
  it('splits business lanes from repository tooling', () => {
    assert.equal(isBusinessLane('packages/dsh-pet/tests/routes.spec.ts'), true)
    assert.equal(isBusinessLane('tests/e2e/mount.e2e.ts'), true)
    assert.equal(isBusinessLane('desktop/tests/runtime.test.mjs'), true)
    assert.equal(isBusinessLane('scripts/market-worker.test.mjs'), false)
  })
})

describe('diffAgainstBaseline', () => {
  const baseline = { version: 1, rules: RULES, files: { 'a.spec.ts': { 'no-arbitrary-sleep': 2 } } }

  it('reports a grown count as a regression', () => {
    const { regressions, improvements } = diffAgainstBaseline({ 'a.spec.ts': { 'no-arbitrary-sleep': 3 } }, baseline)
    assert.deepEqual(regressions, [{ file: 'a.spec.ts', rule: 'no-arbitrary-sleep', before: 2, after: 3 }])
    assert.deepEqual(improvements, [])
  })

  it('reports an unrecorded file as new debt', () => {
    const { regressions } = diffAgainstBaseline({ 'new.spec.ts': { 'bdd-title': 1 } }, baseline)
    assert.deepEqual(regressions, [{ file: 'new.spec.ts', rule: 'bdd-title', before: 0, after: 1 }])
  })

  it('reports a shrunken count as ratchet-down', () => {
    const { improvements } = diffAgainstBaseline({ 'a.spec.ts': { 'no-arbitrary-sleep': 1 } }, baseline)
    assert.deepEqual(improvements, [{ file: 'a.spec.ts', rule: 'no-arbitrary-sleep', before: 2, after: 1 }])
  })

  it('accepts an unchanged baseline', () => {
    const { regressions, improvements } = diffAgainstBaseline({ 'a.spec.ts': { 'no-arbitrary-sleep': 2 } }, baseline)
    assert.deepEqual([regressions, improvements], [[], []])
  })
})

describe('helpers', () => {
  it('matches nested bracket pairs', () => {
    assert.equal(matchPair('(a(b)c)', 0), 6)
    assert.equal(matchPair('(a(b)c)', 2), 4)
    assert.equal(matchPair('(unclosed', 0), -1)
  })

  it('maps offsets to 1-based line numbers', () => {
    const starts = lineStarts('a\nbb\nccc')
    assert.equal(lineOf(starts, 0), 1)
    assert.equal(lineOf(starts, 2), 2)
    assert.equal(lineOf(starts, 5), 3)
  })

  it('collects only assertion matchers from a body', () => {
    const found = matchersIn('expect(x).toHaveBeenCalledTimes(2); rows.map((y) => y)')
    assert.deepEqual([...found], ['toHaveBeenCalledTimes'])
  })
})
