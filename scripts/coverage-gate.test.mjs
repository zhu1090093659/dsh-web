/**
 * Unit tests for the coverage ratchet core: metric extraction, the regression
 * comparison and its epsilon, the weighted repository total, the baseline
 * serialization, package discovery over the real workspace, the per-package
 * exclusions that keep sync-shared copies out of a consumer's denominator, and
 * the bounded concurrency plan that replaced the serial fleet loop.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  MAX_CONCURRENCY,
  METRICS,
  aggregate,
  compare,
  coverageArgs,
  discoverPackages,
  listPackageDirs,
  metricsFromSummary,
  planConcurrency,
  runPackages,
  serializeBaseline,
  sharedCopyExcludes,
} from './coverage-gate.mjs'
import { copyEntries } from './sync-shared.mjs'

/** Paths in the manifest compare equal on every platform. */
const slashed = (path) => path.split('\\').join('/')

/** The workspace root, read off the manifest rather than assumed. */
const WORKSPACE = slashed(copyEntries()[0].target).slice(0, slashed(copyEntries()[0].target).lastIndexOf('/packages/'))

/** The package directory a manifest target belongs to, or undefined for a stray path. */
const ownerPackage = (target) => {
  const rest = slashed(target).split('/packages/')[1]
  return rest === undefined ? undefined : rest.split('/')[0]
}

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

describe('coverageArgs', () => {
  it('re-applies the exclusions after remapping so inlined dependencies stay out', () => {
    // Given a package whose bundle inlines a third-party dependency, When the
    // gate builds the vitest argv, Then it asks for the exclusions to be
    // reapplied to the remapped sources, which is what keeps that dependency's
    // unmapped files out of the package's own percentage.
    const args = coverageArgs('/tmp/report')
    assert.ok(args.includes('--coverage.excludeAfterRemap=true'))
    assert.ok(args.includes('--coverage'))
    assert.ok(args.includes('--coverage.reportsDirectory=/tmp/report'))
  })

  it('writes the summary to the directory it was given', () => {
    // Given a reports directory, When the gate builds the argv, Then the JSON
    // summary lands there rather than at a default path the caller cannot read.
    const args = coverageArgs('/tmp/one-package')
    assert.deepEqual(
      args.filter((arg) => arg.startsWith('--coverage.reporter')),
      ['--coverage.reporter=json-summary'],
    )
    assert.equal(args.at(-1), '--coverage.excludeAfterRemap=true')
  })

  it('carries every argument it carried before exclusions were added', () => {
    // Given a package the manifest copies nothing into, When the gate builds
    // the argv, Then it is exactly the argv the fleet ran before this rule
    // existed: the run, the coverage switch, the json-summary reporter, the
    // reports directory and the post-remap exclusion pass.
    assert.deepEqual(coverageArgs('/tmp/plain'), [
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      '--coverage.reportsDirectory=/tmp/plain',
      '--coverage.excludeAfterRemap=true',
    ])
  })

  it('gives each copy its own exclusion flag', () => {
    // Given two package-relative copies, When the gate builds the argv, Then
    // every pre-existing argument survives, each copy becomes one
    // --coverage.exclude flag (repeated flags accumulate in vitest instead of
    // overriding each other), and the post-remap pass stays last.
    assert.deepEqual(coverageArgs('/tmp/dsh-market', ['src/dsh-home.ts', 'src/http.ts']), [
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      '--coverage.reportsDirectory=/tmp/dsh-market',
      '--coverage.exclude=src/dsh-home.ts',
      '--coverage.exclude=src/http.ts',
      '--coverage.excludeAfterRemap=true',
    ])
  })
})

describe('sharedCopyExcludes', () => {
  it('excludes exactly the manifest targets of one package, as package-relative paths', () => {
    // Given the real manifest, When the exclusions for dsh-market are derived,
    // Then they are that package's own targets relative to its directory - each
    // naming a committed copy that carries the generated header - and the set
    // equals what an independent path.relative over copyEntries() produces.
    const packageDir = join(WORKSPACE, 'packages', 'dsh-market')
    const expected = copyEntries()
      .map((entry) => slashed(relative(packageDir, entry.target)))
      .filter((rel) => !rel.startsWith('..'))
      .sort()

    const excludes = sharedCopyExcludes('dsh-market')
    assert.deepEqual(excludes, expected)
    assert.ok(excludes.includes('src/client/settings-form.ts'))
    assert.ok(excludes.includes('src/dsh-home.ts'))

    for (const rel of excludes) {
      assert.ok(!rel.startsWith('/') && !rel.startsWith('packages/'), rel + ' should be package relative')
      const path = join(packageDir, rel)
      assert.ok(existsSync(path), rel + ' should be a committed copy')
      assert.match(readFileSync(path, 'utf8').split('\n')[0], /Generated by scripts\/sync-shared\.mjs from /)
    }
  })

  it('asks for no exclusions when the manifest copies nothing into the package', () => {
    // Given a package the manifest never writes into, When the exclusions are
    // derived, Then the package asks vitest for nothing and its argv stays bare.
    assert.deepEqual(sharedCopyExcludes('dsh-no-copies'), [])
    assert.deepEqual(sharedCopyExcludes('dsh-market', []), [])
    assert.deepEqual(
      coverageArgs('/tmp/dsh-no-copies', sharedCopyExcludes('dsh-no-copies')).filter((arg) => arg.startsWith('--coverage.exclude')),
      ['--coverage.excludeAfterRemap=true'],
    )
  })

  it('follows the manifest instead of a list of its own', () => {
    // Given the real entries plus one more copy declared inside the same
    // package, When the exclusions are derived, Then the added copy becomes an
    // exclusion with no change to the gate and the rest of the list holds.
    const entries = copyEntries()
    const packageName = ownerPackage(entries[0].target)
    const before = sharedCopyExcludes(packageName, entries)
    const added = { ...entries[0], target: slashed(entries[0].target).replace(/[^/]+$/, 'added-copy.ts') }
    const after = sharedCopyExcludes(packageName, [...entries, added])

    assert.ok(!before.includes('src/client/added-copy.ts'))
    assert.deepEqual(after, [...before, 'src/client/added-copy.ts'].sort())
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

describe('planConcurrency', () => {
  it('degrades to one run at a time on a machine with fewer than three cores', () => {
    // Given runners with one or two cores, When the plan is computed, Then it
    // is the serial plan the gate used before, so a small machine cannot get
    // slower from the change.
    assert.equal(planConcurrency(1), 1)
    assert.equal(planConcurrency(2), 1)
  })

  it('leaves a core to the parent process and stops at the ceiling', () => {
    // Given a growing core count, When the plan is computed, Then it tracks
    // cores minus one up to the ceiling and never exceeds it.
    assert.equal(planConcurrency(3), 2)
    assert.equal(planConcurrency(5), MAX_CONCURRENCY)
    assert.equal(planConcurrency(64), MAX_CONCURRENCY)
  })

  it('keeps the ceiling the contention measurement supports', () => {
    // Given a package run that already fans out to availableParallelism - 1
    // workers, When the ceiling is read, Then it stays at the value the
    // interleaved measurement supports: two runs in flight bought the whole
    // speed-up, and four in flight failed 4 of 12 runs while one to three
    // failed 0 of 17. Raising this constant without a fresh measurement that
    // shows extra runs buying wall clock without buying failures is a
    // regression, so it fails here rather than shipping quietly.
    assert.equal(MAX_CONCURRENCY, 2)
  })

  it('plans serial for a core count that is not a usable number', () => {
    // Given a missing or nonsensical core count, When the plan is computed,
    // Then it falls back to serial rather than to an unbounded fleet.
    assert.equal(planConcurrency(0), 1)
    assert.equal(planConcurrency(Number.NaN), 1)
    assert.equal(planConcurrency(undefined), 1)
  })
})

/**
 * A controlled package runner for the scheduler guard: the test decides when
 * each package's run settles, so completion order is chosen rather than raced,
 * and no timer or clock is involved at all.
 */
function controlledRunner(outcomes) {
  const gates = new Map()
  const state = { started: [], inFlight: 0, maxInFlight: 0 }
  const cover = (pkg) => {
    state.started.push(pkg.name)
    state.inFlight += 1
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    return new Promise((resolve) => {
      gates.set(pkg.name, () => {
        state.inFlight -= 1
        resolve(outcomes[pkg.name])
      })
    })
  }
  const has = (name) => gates.has(name)
  const release = async (name) => {
    // The scheduler starts the next package on the microtask that follows a
    // completion, so waiting for the gate is a bounded microtask flush.
    for (let hop = 0; hop < 50 && !gates.has(name); hop += 1) await Promise.resolve()
    const gate = gates.get(name)
    assert.equal(typeof gate, 'function', 'no run was started for ' + name)
    gates.delete(name)
    gate()
  }
  return { cover, release, has, state }
}

/**
 * Settle a whole fleet latest-started-first, skipping packages whose run has
 * not started yet (a later package only starts once a slot frees, so it cannot
 * be settled before one of its predecessors). The skipped package is picked up
 * on a later pass, which keeps the completion order the reverse of every start
 * wave without any timer.
 */
async function releaseLatestFirst(runner, fleet) {
  const remaining = [...fleet].reverse().map((entry) => entry.name)
  for (let pass = 0; pass < 500 && remaining.length > 0; pass += 1) {
    const next = remaining.find((name) => runner.has(name))
    if (next === undefined) {
      await Promise.resolve()
      continue
    }
    remaining.splice(remaining.indexOf(next), 1)
    await runner.release(next)
  }
  assert.deepEqual(remaining, [], 'every package run should have settled')
}

const pkg = (name) => ({ name, dir: '/tmp/' + name, rel: 'packages/' + name })

const outcome = (lines) => ({ ok: true, metrics: { lines, statements: lines, functions: lines, branches: lines }, total: { lines: { covered: lines, total: 100 } } })

const FLEET = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(pkg)
const OUTCOMES = Object.fromEntries(FLEET.map((entry, index) => [entry.name, outcome(70 + index)]))

const collect = (events) => (pkgEntry, result) => {
  events.push(pkgEntry.name + ':' + (result.ok ? result.metrics.lines : 'FAIL'))
}

describe('runPackages', () => {
  it('keeps every package metric identical when the runs settle out of order', async () => {
    // Given the same fleet run serially and then with three runs in flight,
    // When the concurrent run's packages settle in the reverse of their start
    // order, Then every measured metric and raw total is identical.
    const serial = controlledRunner(OUTCOMES)
    const serialRun = runPackages(FLEET, serial.cover, { limit: 1 })
    for (const entry of FLEET) await serial.release(entry.name)
    const serialResult = await serialRun

    const concurrent = controlledRunner(OUTCOMES)
    const concurrentRun = runPackages(FLEET, concurrent.cover, { limit: 3 })
    await releaseLatestFirst(concurrent, FLEET)
    const concurrentResult = await concurrentRun

    assert.deepEqual(concurrentResult.measured, serialResult.measured)
    assert.deepEqual(concurrentResult.totals, serialResult.totals)
    assert.deepEqual(concurrentResult.failures, serialResult.failures)
    assert.deepEqual(concurrentResult.measured, Object.fromEntries(FLEET.map((entry) => [entry.name, OUTCOMES[entry.name].metrics])))
  })

  it('reports progress in package order however the runs settle', async () => {
    // Given a serial run and a concurrent run whose packages settle in
    // reverse, When progress is collected, Then both sequences name the
    // packages in report order, so the printed log cannot interleave.
    const serialEvents = []
    const serial = controlledRunner(OUTCOMES)
    const serialRun = runPackages(FLEET, serial.cover, { limit: 1, onProgress: collect(serialEvents) })
    for (const entry of FLEET) await serial.release(entry.name)
    await serialRun

    const concurrentEvents = []
    const concurrent = controlledRunner(OUTCOMES)
    const concurrentRun = runPackages(FLEET, concurrent.cover, { limit: 3, onProgress: collect(concurrentEvents) })
    await releaseLatestFirst(concurrent, FLEET)
    await concurrentRun

    assert.deepEqual(concurrentEvents, serialEvents)
    assert.deepEqual(concurrentEvents, ['alpha:70', 'bravo:71', 'charlie:72', 'delta:73', 'echo:74'])
  })

  it('never keeps more runs in flight than the plan allows', async () => {
    // Given a fleet of five packages and a limit of three, When the run
    // completes, Then the runner saw at most three outstanding at any moment
    // and no more than three were started before the first release.
    const runner = controlledRunner(OUTCOMES)
    const run = runPackages(FLEET, runner.cover, { limit: 3 })
    assert.deepEqual(runner.state.started, ['alpha', 'bravo', 'charlie'])
    for (const entry of FLEET) await runner.release(entry.name)
    await run
    assert.equal(runner.state.maxInFlight, 3)
    assert.deepEqual(runner.state.started, FLEET.map((entry) => entry.name))
  })

  it('keeps a failing package identified by name and output while the rest measure', async () => {
    // Given one package whose run fails with captured stderr, When the fleet
    // runs, Then the failure carries that package and its output verbatim,
    // the failed package has no metrics, and every other package is measured.
    const outcomes = { ...OUTCOMES, charlie: { ok: false, error: 'vitest exited 1', output: 'stderr tail' } }
    const runner = controlledRunner(outcomes)
    const run = runPackages(FLEET, runner.cover, { limit: 2 })
    for (const entry of FLEET) await runner.release(entry.name)
    const result = await run

    assert.deepEqual(result.failures, [{ pkg: pkg('charlie'), result: { ok: false, error: 'vitest exited 1', output: 'stderr tail' } }])
    assert.deepEqual(Object.keys(result.measured), ['alpha', 'bravo', 'delta', 'echo'])
  })

  it('records a runner that throws as that package failure instead of losing the fleet', async () => {
    // Given a runner that throws for one package, When the fleet runs, Then
    // the throw is recorded against that package and the others still measure.
    const runner = controlledRunner(OUTCOMES)
    const cover = (entry) => (entry.name === 'bravo' ? Promise.reject(new Error('spawn exploded')) : runner.cover(entry))
    const run = runPackages(FLEET, cover, { limit: 2 })
    for (const entry of FLEET) if (entry.name !== 'bravo') await runner.release(entry.name)
    const result = await run

    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].pkg.name, 'bravo')
    assert.equal(result.failures[0].result.error, 'coverage run threw: spawn exploded')
    assert.deepEqual(Object.keys(result.measured), ['alpha', 'charlie', 'delta', 'echo'])
  })

  it('plans the limit from the core count when none is given', async () => {
    // Given a two-core machine and no explicit limit, When the fleet starts,
    // Then exactly one run is in flight, which is the serial plan.
    const runner = controlledRunner(OUTCOMES)
    const run = runPackages(FLEET, runner.cover, { cpuCount: 2 })
    assert.deepEqual(runner.state.started, ['alpha'])
    for (const entry of FLEET) await runner.release(entry.name)
    await run
    assert.equal(runner.state.maxInFlight, 1)
  })
})

describe('discoverPackages', () => {
  it('keeps only package directories whose test script runs vitest', () => {
    const vitest = () => ({ scripts: { test: 'vitest run' } })
    // Only paths that exist on disk survive the manifest existence check.
    const found = discoverPackages(vitest, () => ['dsh-usage'])
    assert.deepEqual(found.map((pkg) => pkg.name), ['dsh-usage'])
    assert.ok(found[0].rel.startsWith('packages/dsh-usage'))
  })

  it('drops a package whose test script does not run vitest', () => {
    const other = () => ({ scripts: { test: 'node --test' } })
    assert.deepEqual(discoverPackages(other, () => ['dsh-usage']), [])
  })

  it('survives an unreadable manifest', () => {
    const broken = () => {
      throw new Error('bad json')
    }
    assert.deepEqual(discoverPackages(broken, () => ['dsh-usage']), [])
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
    assert.ok(names.includes('dsh-usage'))
    assert.ok(names.includes('dsh-market'))
  })
})
