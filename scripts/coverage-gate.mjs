#!/usr/bin/env node
/**
 * Coverage ratchet for the dsh-web monorepo.
 *
 * The fleet runs with a bounded number of packages in flight. Seventeen serial
 * vitest launches spend most of their wall clock in process start-up and
 * collection rather than in the CPU work of any one suite, so the runs overlap
 * without changing what any of them measures. On a ten-core machine the
 * interleaved comparison measured 56.8 s at one run in flight against 38.8 s at
 * two, with two, three and four indistinguishable from each other (38.8 / 37.1
 * / 38.5 s best-case samples) - the whole win is in the first overlap.
 *
 * The ceiling is two because each package run parallelizes internally. A run
 * under the forks pool takes `availableParallelism - 1` workers, so on ten cores
 * one package already holds about ten processes and the measured peaks for the
 * whole fleet were 11 / 20 / 36 worker processes at one / two / four runs in
 * flight. Two runs is already about twice the core count; four is nearly four
 * times it, and that cost is not hypothetical: across every run observed here
 * and by the reviewer, four in flight failed 4 of 12 times while one to three in
 * flight failed 0 of 17 (Fisher two-tailed p = 0.021). Both failure modes are
 * load-shaped rather than semantic - a 2 s abort-propagation budget in
 * dsh-remote-web-ui and one live benchmark case in dsh-liangshen - so the gate
 * buys its stability by not oversubscribing the machine, and a nightly ratchet
 * that goes red on contention costs more than the seconds four runs would save.
 * On a machine with fewer than three cores the plan degrades to one run at a
 * time - exactly the serial behavior this replaced - so no small runner can be
 * made slower.
 *
 * Every package resolves vitest 4.x. The six packages that pin their own
 * vitest also declare their own @vitest/coverage-v8 at the same major; the root
 * devDependency serves the rest through Node resolution. Bumping a package's
 * vitest major therefore means bumping its provider too; a missing or
 * mismatched provider fails this gate loudly instead of silently reporting
 * nothing.
 *
 * This is a Tier-2 gate: it runs in the nightly workflow and on demand, not on
 * every pull request, because instrumenting ~4,400 tests costs minutes and the
 * pull-request lane already runs the full suite. The ratchet is what makes it
 * useful: scripts/coverage-baseline.json records the measured percentage of
 * every package and metric, and a change may not lower any of them. Branch
 * coverage is the metric worth reading, because it is the one that exposes an
 * untested failure path.
 *
 * A package's percentage covers only the code the package owns. The family
 * settings card trio and the shared host modules live once under shared/ and
 * are mirrored into consumers by scripts/sync-shared.mjs; every copy is byte
 * identical, committed, and tested where the source lives (shared/tests carries
 * settings-form.spec.ts, mount-once.spec.ts and the rest), so counting a copy in
 * its consumer measures one source once per consumer instead of once for the
 * fleet - the newest copy landing moved 28 metrics across 8 packages at once,
 * with no test change anywhere. A generated copy is therefore not the package's
 * own code and does not enter that package's coverage, uniformly: every manifest
 * target inside packages/<pkg>/ is excluded for that package, whether or not the
 * copy happens to be well covered, with no per-file or per-package exception.
 * The MANIFEST in scripts/sync-shared.mjs is the authority for which files those
 * are; this gate derives the list through its copyEntries() export and repeats
 * no file name and no package list of its own, so a copy added to the manifest is
 * excluded from its consumer without touching this file.
 *
 * Usage:
 *   node scripts/coverage-gate.mjs                     # compare against the baseline
 *   node scripts/coverage-gate.mjs --report            # print the current table, exit 0
 *   node scripts/coverage-gate.mjs --write-baseline    # re-record the baseline
 *   node scripts/coverage-gate.mjs [names...]          # scope to packages by name
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyEntries } from './sync-shared.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = join(dirname(SCRIPT_PATH), '..')
const BASELINE_PATH = join(dirname(SCRIPT_PATH), 'coverage-baseline.json')

/** Metrics recorded per package, in report order. */
export const METRICS = ['lines', 'statements', 'functions', 'branches']

/**
 * A metric more than this many percentage points below its recorded value is a
 * regression. Coverage instrumentation is not bit-stable: two identical runs
 * of the fleet differed by 0.04 points on dsh-ssh branches, so a zero-tolerance
 * ratchet would go red on noise. Half a point absorbs that while still catching
 * a deleted test, whose cost is far larger.
 */
const EPSILON = 0.5

/** Plugin packages that run vitest, sorted by directory name. */
export function discoverPackages(readManifest, listDirs) {
  const packages = []
  const base = join(ROOT, 'packages')
  for (const name of listDirs(base)) {
    const dir = join(base, name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = readManifest(manifestPath)
    } catch {
      continue
    }
    if (!/vitest/.test(manifest.scripts?.test ?? '')) continue
    packages.push({ name, dir, rel: relative(ROOT, dir).split('\\').join('/') })
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name))
}

/** Package directories under a base directory. */
export function listPackageDirs(base) {
  try {
    return readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

const readManifest = (path) => JSON.parse(readFileSync(path, 'utf8'))

/** Istanbul summary -> the four percentages this gate records. */
export function metricsFromSummary(summary) {
  const out = {}
  for (const metric of METRICS) out[metric] = round(summary?.total?.[metric]?.pct)
  return out
}

function round(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : 0
}

/**
 * The coverage exclusions a package carries: every scripts/sync-shared.mjs
 * MANIFEST target written inside `packages/<packageName>/`, relative to the
 * package directory.
 *
 * The list is read from copyEntries() rather than repeated here, so the manifest
 * stays the single place a generated copy is declared. Paths are package
 * relative because the gate runs vitest with the package as its working
 * directory, and vitest matches a coverage exclusion against the instrumented
 * path with contains semantics, so `src/client/settings-form.ts` removes
 * `<root>/packages/<pkg>/src/client/settings-form.ts` without an absolute path
 * (measured on vitest 4.1, see coverageArgs).
 * @param packageName - the package directory name under packages/.
 * @param entries - copyEntries() output; injected only by tests.
 * @returns package-relative paths, sorted; empty when the package has no copies.
 */
export function sharedCopyExcludes(packageName, entries = copyEntries()) {
  const marker = '/packages/' + packageName + '/'
  const excludes = []
  for (const entry of entries) {
    const target = String(entry.target).split('\\').join('/')
    const at = target.lastIndexOf(marker)
    if (at < 0) continue
    const rel = target.slice(at + marker.length)
    if (rel.length > 0) excludes.push(rel)
  }
  return excludes.sort()
}

/**
 * The vitest argv this gate runs for one package.
 *
 * `excludes` are package-relative paths carrying the same rule as
 * {@link sharedCopyExcludes}: a copied shared source is not this package's own
 * code. Repeated --coverage.exclude flags accumulate in vitest rather than
 * overriding each other, which is what lets every copy keep its literal path
 * instead of being folded into one brace glob.
 *
 * excludeAfterRemap re-applies the exclusions after coverage is remapped to
 * original sources. Without it a package whose built bundle inlines a
 * third-party dependency also reports that dependency's own unmapped files:
 * the aggregate's shell bundle carries @deepseek-ai/schemastery and cosmokit,
 * and their 562 lines at about 23% pulled dsh-web-all from roughly 92% down to
 * roughly 51% with no test change at all. Both files sit under the workspace's
 * node_modules, which the default exclusions already cover, so turning the flag
 * on cannot drop a file the default rules keep — it is a no-op for every
 * package that only instruments files inside its own directory.
 */
export function coverageArgs(outDir, excludes = []) {
  return [
    'run',
    '--coverage',
    '--coverage.reporter=json-summary',
    '--coverage.reportsDirectory=' + outDir,
    ...excludes.map((exclude) => '--coverage.exclude=' + exclude),
    '--coverage.excludeAfterRemap=true',
  ]
}

/** Hard ceiling on the output captured from one package run. */
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024

/**
 * Most package runs this gate will keep in flight at once.
 *
 * Two, not four: a run parallelizes its own suite across `availableParallelism
 * - 1` workers, so two runs already hold about twice the core count on a ten-core
 * machine, and the interleaved measurement put two, three and four in flight
 * within noise of each other while four was the only setting that failed. Raise
 * this only with a fresh measurement that shows the extra runs buying wall clock
 * without buying failures.
 */
export const MAX_CONCURRENCY = 2

/**
 * How many package runs may be in flight at once on a machine with this many
 * cores.
 *
 * One core is left to the parent process and the operating system, and the
 * result is capped at {@link MAX_CONCURRENCY}. The floor is one, which is what
 * matters for the small runners: on one or two cores the plan is a single run
 * at a time, i.e. the serial behavior this gate used before, so a small CI
 * machine can never be made slower by the change.
 * @param cpuCount - core count; a non-finite or non-positive value plans serial.
 * @returns the number of package runs to keep in flight, at least one.
 */
export function planConcurrency(cpuCount) {
  const cores = Number.isFinite(cpuCount) && cpuCount >= 1 ? Math.floor(cpuCount) : 1
  return Math.max(1, Math.min(cores - 1, MAX_CONCURRENCY))
}

/** Run one package's suite with coverage and return its metrics. */
export function coverPackage(pkg) {
  const outDir = join(tmpdir(), 'dsh-coverage', pkg.name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const bin = join(pkg.dir, 'node_modules', '.bin', 'vitest')
  if (!existsSync(bin)) return Promise.resolve({ ok: false, error: 'vitest is not installed in ' + pkg.rel })
  return new Promise((resolve) => {
    const child = spawn(bin, coverageArgs(outDir, sharedCopyExcludes(pkg.name)), { cwd: pkg.dir, stdio: ['ignore', 'pipe', 'pipe'] })
    // The two streams stay separate so the captured text is stdout followed by
    // stderr, byte for byte what the previous spawnSync call produced; merging
    // them in arrival order would reorder a failure's evidence.
    const stdout = []
    const stderr = []
    let bytes = 0
    let overflowed = false
    let settled = false
    const collect = (sink) => (chunk) => {
      if (overflowed) return
      bytes += chunk.length
      if (bytes > MAX_OUTPUT_BYTES) {
        overflowed = true
        child.kill()
        return
      }
      sink.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({ ok: false, error: 'vitest could not be started: ' + error.message })
    })
    child.on('close', (status) => {
      if (settled) return
      settled = true
      const output = stdout.join('') + stderr.join('')
      if (overflowed) return resolve({ ok: false, error: 'vitest output exceeded the capture cap', output: tail(output) })
      if (status !== 0) return resolve({ ok: false, error: 'vitest exited ' + status, output: tail(output) })
      const summaryPath = join(outDir, 'coverage-summary.json')
      if (!existsSync(summaryPath)) return resolve({ ok: false, error: 'no coverage summary was written', output: tail(output) })
      let summary
      try {
        summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
      } catch (error) {
        return resolve({ ok: false, error: 'unreadable coverage summary: ' + error.message })
      }
      resolve({ ok: true, metrics: metricsFromSummary(summary), total: summary.total })
    })
  })
}

/**
 * Run every package's coverage and collect the results, with at most
 * `options.limit` runs in flight.
 *
 * Determinism is the point of this function's shape. A result is stored at its
 * package's own index, never in arrival order, and `onProgress` is called in
 * package order as the completed prefix becomes contiguous. Two runs that
 * complete in different orders therefore produce the same `measured`, `totals`,
 * `failures` and the same progress sequence; only the wall clock differs.
 *
 * A runner that throws is recorded as that package's failure rather than
 * rejecting the fleet, so one broken runner can never leave the other packages
 * unmeasured.
 * @param packages - packages in report order.
 * @param cover - one package's runner; injected so tests can control completion order.
 * @param options - `limit` (in flight), `cpuCount` (used to plan `limit`), `onProgress(pkg, result)`.
 * @returns measured metrics by name, raw totals by name, and failures in package order.
 */
export async function runPackages(packages, cover, options = {}) {
  const limit = Math.max(1, options.limit ?? planConcurrency(options.cpuCount ?? cpus().length))
  const onProgress = options.onProgress ?? (() => {})
  const results = Array(packages.length)
  const done = Array(packages.length).fill(false)
  let next = 0
  let reported = 0
  const flush = () => {
    while (reported < packages.length && done[reported]) {
      onProgress(packages[reported], results[reported])
      reported += 1
    }
  }
  const worker = async () => {
    while (next < packages.length) {
      const index = next
      next += 1
      try {
        results[index] = await cover(packages[index])
      } catch (error) {
        results[index] = { ok: false, error: 'coverage run threw: ' + (error?.message ?? String(error)) }
      }
      done[index] = true
      flush()
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(limit, packages.length); i += 1) workers.push(worker())
  await Promise.all(workers)

  const measured = {}
  const totals = {}
  const failures = []
  for (let i = 0; i < packages.length; i += 1) {
    const pkg = packages[i]
    const result = results[i]
    if (!result.ok) {
      failures.push({ pkg, result })
      continue
    }
    measured[pkg.name] = result.metrics
    totals[pkg.name] = result.total
  }
  return { measured, totals, failures }
}

function tail(text, lines = 25) {
  const all = String(text).trimEnd().split('\n')
  return all.slice(Math.max(0, all.length - lines)).join('\n')
}

/** Compare measured metrics against a recorded baseline. */
export function compare(baseline, measured) {
  const regressions = []
  const improvements = []
  const missing = []
  for (const [name, metrics] of Object.entries(measured)) {
    const base = baseline.packages?.[name]
    if (!base) {
      missing.push(name)
      continue
    }
    for (const metric of METRICS) {
      const before = base[metric] ?? 0
      const after = metrics[metric] ?? 0
      if (after + EPSILON < before) regressions.push({ name, metric, before, after })
      else if (after > before + EPSILON) improvements.push({ name, metric, before, after })
    }
  }
  return { regressions, improvements, missing }
}

/** Weighted repository total across the packages that were measured. */
export function aggregate(measured, totals) {
  const sums = {}
  for (const metric of METRICS) sums[metric] = { covered: 0, total: 0 }
  for (const name of Object.keys(measured)) {
    const total = totals[name]
    if (!total) continue
    for (const metric of METRICS) {
      sums[metric].covered += total[metric]?.covered ?? 0
      sums[metric].total += total[metric]?.total ?? 0
    }
  }
  const out = {}
  for (const metric of METRICS) {
    const entry = sums[metric]
    out[metric] = entry.total === 0 ? 0 : round((entry.covered / entry.total) * 100)
  }
  return out
}

/**
 * One package per line: the baseline is reviewed in diffs, and a nested JSON
 * dump would turn a one-package ratchet into a five-line hunk.
 */
export function serializeBaseline(measured) {
  const packages = {}
  for (const name of Object.keys(measured).sort()) packages[name] = measured[name]
  const lines = ['{', '  "version": 1,', '  "metrics": ' + JSON.stringify(METRICS) + ',', '  "packages": {']
  const names = Object.keys(packages)
  names.forEach((name, index) => {
    const metrics = packages[name]
    const body = METRICS.map((metric) => JSON.stringify(metric) + ': ' + metrics[metric]).join(', ')
    lines.push('    ' + JSON.stringify(name) + ': { ' + body + ' }' + (index === names.length - 1 ? '' : ','))
  })
  lines.push('  }', '}')
  return lines.join('\n') + '\n'
}

/** Rewrite the baseline from a fresh measurement; dropped packages are pruned. */
export function writeBaseline(measured) {
  const packages = {}
  for (const name of Object.keys(measured).sort()) packages[name] = measured[name]
  writeFileSync(BASELINE_PATH, serializeBaseline(measured))
  return { version: 1, metrics: METRICS, packages }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { version: 1, metrics: METRICS, packages: {} }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

function formatTable(measured) {
  const width = Math.max(...Object.keys(measured).map((name) => name.length), 7)
  const header = 'package'.padEnd(width) + METRICS.map((metric) => metric.padStart(11)).join('')
  const rows = [header]
  for (const name of Object.keys(measured)) {
    rows.push(name.padEnd(width) + METRICS.map((metric) => String(measured[name][metric]).padStart(11)).join(''))
  }
  return rows.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/coverage-gate.mjs [--report] [--write-baseline] [names...]\n\nRuns vitest coverage for every plugin package and compares the four metrics\n(lines, statements, functions, branches) against scripts/coverage-baseline.json.')
    return 0
  }
  const filters = args.filter((arg) => !arg.startsWith('-'))
  const all = discoverPackages(readManifest, listPackageDirs)
  const packages = filters.length === 0 ? all : all.filter((pkg) => filters.some((filter) => pkg.name.includes(filter)))
  if (packages.length === 0) {
    console.log('[coverage] no package matched')
    return 1
  }

  // One line per package, emitted when the completed prefix reaches it, so the
  // log stays in package order and reads exactly as the serial one did.
  const { measured, totals, failures } = await runPackages(packages, coverPackage, {
    onProgress: (pkg, result) => {
      if (!result.ok) {
        console.log('[coverage] ' + pkg.name + ' ... FAIL (' + result.error + ')')
        return
      }
      console.log('[coverage] ' + pkg.name + ' ... ' + METRICS.map((metric) => metric + ' ' + result.metrics[metric] + '%').join(' '))
    },
  })

  for (const failure of failures) {
    console.log('')
    console.log('[coverage] ' + failure.pkg.rel + ': ' + failure.result.error)
    if (failure.result.output) console.log(failure.result.output)
  }
  if (failures.length > 0) {
    console.log('[coverage] FAIL: ' + failures.length + ' package(s) could not produce coverage')
    return 1
  }

  const repo = aggregate(measured, totals)
  if (args.includes('--write-baseline')) {
    const payload = writeBaseline(measured)
    console.log('')
    console.log('[coverage] baseline written for ' + Object.keys(payload.packages).length + ' package(s)')
    console.log('[coverage] repository totals: ' + METRICS.map((metric) => metric + ' ' + repo[metric] + '%').join(' '))
    return 0
  }

  if (args.includes('--report')) {
    console.log('')
    console.log(formatTable(measured))
    console.log('')
    console.log('[coverage] repository totals: ' + METRICS.map((metric) => metric + ' ' + repo[metric] + '%').join(' '))
    return 0
  }

  const baseline = readBaseline()
  const { regressions, improvements, missing } = compare(baseline, measured)
  console.log('')
  console.log('[coverage] repository totals: ' + METRICS.map((metric) => metric + ' ' + repo[metric] + '%').join(' '))

  if (missing.length > 0) {
    console.log('[coverage] not in the baseline (' + missing.length + '); record with --write-baseline: ' + missing.join(', '))
  }
  if (improvements.length > 0) {
    console.log('[coverage] ratchet-up available (' + improvements.length + '); record it with --write-baseline:')
    for (const item of improvements.slice(0, 10)) {
      console.log('  ' + item.name + ' ' + item.metric + ' ' + item.before + '% -> ' + item.after + '%')
    }
    if (improvements.length > 10) console.log('  ... ' + (improvements.length - 10) + ' more')
  }

  if (regressions.length > 0) {
    console.log('[coverage] FAIL: ' + regressions.length + ' metric(s) regressed:')
    for (const item of regressions) {
      console.log('  ' + item.name + ' ' + item.metric + ' ' + item.before + '% -> ' + item.after + '%')
    }
  }
  if (regressions.length > 0 || missing.length > 0) return 1
  console.log('[coverage] OK: no package regressed')
  return 0
}

const invokedDirectly = process.argv[1] ? join(process.argv[1]) === SCRIPT_PATH : false
if (invokedDirectly) process.exit(await main())
