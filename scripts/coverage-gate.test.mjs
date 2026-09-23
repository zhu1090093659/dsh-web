/**
 * Unit tests for the coverage ratchet core: metric extraction, the regression
 * comparison and its epsilon, the weighted repository total, the baseline
 * serialization, and package discovery over the real workspace.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  METRICS,
  aggregate,
  compare,
  discoverPackages,
  listPackageDirs,
  metricsFromSummary,
  serializeBaseline,
} from './coverage-gate.mjs'

const summary = (lines, statements, functions, branches) => ({
  total: {
    lines: { pct: lines },
    statements: { pct: statements },
    functions: { pct: functions },
    branches: { pct: branches },
  },
})

const manifest = (path) => {
  if (path.endsWith('has-vitest/package.json')) return { scripts: { test: 'vitest run' } }
  if (path.endsWith('no-tests/package.json')) return { scripts: { build: 'tsdown' } }
  if (path.endsWith('broken/package.json')) throw new Error('bad json')
  return { scripts: {} }
}

describe('metricsFromSummary', () => {
  it('reads and rounds the four percentages', () => {
    assert.deepEqual(metricsFromSummary(summary(78.523, 80.116, 86.2, 74.55)), {
      lines: 78.52, statements: 80.12, functions: 86.2, branches: 74.55,
    })
  })

  it('falls back to zero for an incomplete summary', () => {
    assert.deepEqual(metricsFromSummary({}), { lines: 0, statements: 0, functions: 0, branches: 0 })
  })
})

describe('compare', () => {
  const baseline = { packages: { pkg: { lines: 80, statements: 80, functions: 80, branches: 80 } } }

  it('flags a metric below the baseline', () => {
    const { regressions } = compare(baseline, { pkg: { lines: 79, statements: 80, functions: 80, branches: 80 } })
    assert.deepEqual(regressions, [{ name: 'pkg', metric: 'lines', before: 80, after: 79 }])
  })

  it('tolerates instrumentation noise but not a real drop', () => {
    const noise = compare(baseline, { pkg: { lines: 79.6, statements: 80, functions: 80, branches: 80 } })
    assert.deepEqual(noise.regressions, [])
    const drop = compare(baseline, { pkg: { lines: 79.4, statements: 80, functions: 80, branches: 80 } })
    assert.equal(drop.regressions.length, 1)
    assert.equal(drop.regressions[0].after, 79.4)
  })

  it('reports an improved metric as a ratchet-up', () => {
    const { improvements } = compare(baseline, { pkg: { lines: 82, statements: 80, functions: 80, branches: 80 } })
    assert.deepEqual(improvements, [{ name: 'pkg', metric: 'lines', before: 80, after: 82 }])
  })

  it('reports a package that has no baseline entry', () => {
    const { missing } = compare(baseline, { fresh: { lines: 1, statements: 1, functions: 1, branches: 1 } })
    assert.deepEqual(missing, ['fresh'])
  })
})

describe('aggregate', () => {
  it('weights each metric by its covered and total counts', () => {
    const totals = {
      big: summary(0, 0, 0, 0),
      small: summary(0, 0, 0, 0),
    }
    totals.big.branches = { covered: 90, total: 100 }
    totals.small.branches = { covered: 0, total: 100 }
    const measured = { big: { branches: 90 }, small: { branches: 0 } }
    assert.equal(aggregate(measured, totals).branches, 45)
  })

  it('reports zero when nothing was counted', () => {
    assert.deepEqual(aggregate({ pkg: { lines: 0 } }, { pkg: undefined }), {
      lines: 0, statements: 0, functions: 0, branches: 0,
    })
  })
})

describe('serializeBaseline', () => {
  it('writes one sorted package per line with every metric', () => {
    const text = serializeBaseline({
      zeta: { lines: 1, statements: 2, functions: 3, branches: 4 },
      alpha: { lines: 5, statements: 6, functions: 7, branches: 8 },
    })
    const lines = text.trimEnd().split('\n')
    assert.equal(lines[0], '{')
    assert.ok(lines[2].includes('"metrics": ["lines","statements","functions","branches"]'))
    assert.ok(lines[4].startsWith('    "alpha": {'))
    assert.ok(lines[4].endsWith(','))
    assert.ok(lines[5].startsWith('    "zeta": {'))
    assert.ok(!lines[5].endsWith(','))
    assert.deepEqual(JSON.parse(text).metrics, METRICS)
    assert.deepEqual(JSON.parse(text).packages.alpha, { lines: 5, statements: 6, functions: 7, branches: 8 })
  })
})

describe('discoverPackages', () => {
  const dirs = (base) => {
    if (base.endsWith('/skins')) return ['has-vitest']
    if (base.endsWith('/packages')) return ['has-vitest', 'no-tests', 'broken', 'missing']
    return []
  }

  it('keeps only package directories whose test script runs vitest', () => {
    const vitest = () => ({ scripts: { test: 'vitest run' } })
    // Only paths that exist on disk survive the manifest existence check.
    const found = discoverPackages(vitest, () => ['dsh-pet'])
    assert.deepEqual(found.map((pkg) => pkg.name), ['dsh-pet'])
    assert.ok(found[0].rel.startsWith('packages/dsh-pet'))
  })

  it('drops a package whose test script does not run vitest', () => {
    const other = () => ({ scripts: { test: 'node --test' } })
    assert.deepEqual(discoverPackages(other, () => ['dsh-pet']), [])
  })

  it('survives an unreadable manifest', () => {
    const broken = () => {
      throw new Error('bad json')
    }
    assert.deepEqual(discoverPackages(broken, () => ['dsh-pet']), [])
  })

  it('returns nothing for an empty workspace list', () => {
    assert.deepEqual(discoverPackages(manifest, () => []), [])
  })

  it('finds the real plugin fleet', () => {
    const names = discoverPackages(
      (path) => JSON.parse(readFileSync(path, 'utf8')),
      listPackageDirs,
    ).map((pkg) => pkg.name)
    assert.ok(names.length >= 15)
    assert.ok(names.includes('dsh-pet'))
    assert.ok(names.includes('skin-center'))
  })
})
