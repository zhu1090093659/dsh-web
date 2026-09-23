#!/usr/bin/env node
/**
 * Coverage ratchet for the dsh-web monorepo.
 *
 * The repository runs two vitest majors (3.x in the older plugin packages,
 * 4.x everywhere else), so the v8 coverage provider is declared per major: the
 * 3.x packages carry @vitest/coverage-v8@^3.2.7, and the root devDependency
 * serves every 4.x package through Node resolution. Bumping a package's vitest
 * major therefore means bumping its provider too; a missing or mismatched
 * provider fails this gate loudly instead of silently reporting nothing.
 *
 * This is a Tier-2 gate: it runs in the nightly workflow and on demand, not on
 * every pull request, because instrumenting ~4,400 tests costs minutes and the
 * pull-request lane already runs the full suite. The ratchet is what makes it
 * useful: scripts/coverage-baseline.json records the measured percentage of
 * every package and metric, and a change may not lower any of them. Branch
 * coverage is the metric worth reading, because it is the one that exposes an
 * untested failure path.
 *
 * Usage:
 *   node scripts/coverage-gate.mjs                     # compare against the baseline
 *   node scripts/coverage-gate.mjs --report            # print the current table, exit 0
 *   node scripts/coverage-gate.mjs --write-baseline    # re-record the baseline
 *   node scripts/coverage-gate.mjs [names...]          # scope to packages by name
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  for (const base of [join(ROOT, 'packages'), join(ROOT, 'packages', 'skins')]) {
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

/** Run one package's suite with coverage and return its metrics. */
export function coverPackage(pkg) {
  const outDir = join(tmpdir(), 'dsh-coverage', pkg.name)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const bin = join(pkg.dir, 'node_modules', '.bin', 'vitest')
  if (!existsSync(bin)) return { ok: false, error: 'vitest is not installed in ' + pkg.rel }
  const result = spawnSync(bin, [
    'run',
    '--coverage',
    '--coverage.reporter=json-summary',
    '--coverage.reportsDirectory=' + outDir,
  ], { cwd: pkg.dir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  if (result.status !== 0) return { ok: false, error: 'vitest exited ' + result.status, output: tail(output) }
  const summaryPath = join(outDir, 'coverage-summary.json')
  if (!existsSync(summaryPath)) return { ok: false, error: 'no coverage summary was written', output: tail(output) }
  let summary
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  } catch (error) {
    return { ok: false, error: 'unreadable coverage summary: ' + error.message }
  }
  return { ok: true, metrics: metricsFromSummary(summary), total: summary.total }
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

function main() {
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

  const measured = {}
  const totals = {}
  const failures = []
  for (const pkg of packages) {
    process.stdout.write('[coverage] ' + pkg.name + ' ... ')
    const result = coverPackage(pkg)
    if (!result.ok) {
      console.log('FAIL (' + result.error + ')')
      failures.push({ pkg, result })
      continue
    }
    console.log(METRICS.map((metric) => metric + ' ' + result.metrics[metric] + '%').join(' '))
    measured[pkg.name] = result.metrics
    totals[pkg.name] = result.total
  }

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
if (invokedDirectly) process.exit(main())
