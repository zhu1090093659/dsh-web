/**
 * probe-selftest -- the probes must discriminate before a model is charged for
 * them.
 *
 * Each probe ships two scripted policies: the habit the probe looks for
 * ('bad') and the habit the rule set asks for ('good'). Both are driven through
 * the same environment and graded by the same oracle, so a probe that cannot
 * separate them is measuring nothing. This is the offline half of the method:
 * it costs nothing, it runs in a second, and a changed oracle has to keep
 * failing the bad policy or it does not ship.
 *
 * Usage: node tools/probe-selftest.mjs [--verbose]
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PROBE_ROOT = join(HERE, 'probes')
export const SHARED = join(PROBE_ROOT, 'shared.mjs')

/** Every probe, in the order the report lists them. */
export const PROBES = ['prior-override', 'refresh-quota', 'oncall-backlog', 'budget-ledger']

/** The metric that must move in the expected direction for each probe. */
export const DISCRIMINATORS = {
  'prior-override': { metric: 'admitted', direction: 'up' },
  'refresh-quota': { metric: 'served', direction: 'up' },
  'oncall-backlog': { metric: 'escalations', direction: 'down' },
  'budget-ledger': { metric: 'submitted', direction: 'up' },
}

/** Materialize one probe into a fresh directory, the way a task workspace is built. */
export function materializeProbe(name) {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-probe-' + name + '-'))
  mkdirSync(workspace, { recursive: true })
  cpSync(join(PROBE_ROOT, name), workspace, { recursive: true })
  cpSync(SHARED, join(workspace, 'shared.mjs'))
  return workspace
}

/** Drive one scripted policy through a fresh workspace and grade the episode. */
export async function runStrategy(name, policy, options = {}) {
  const workspace = materializeProbe(name)
  try {
    const strategiesModule = await import(
      pathToFileURL(join(PROBE_ROOT, name, 'strategies.mjs')).href + '?v=' + Date.now(),
    )
    const strategy = strategiesModule.strategies[policy]
    if (strategy === undefined) throw new Error('probe ' + name + ' has no ' + policy + ' strategy')
    const run = (args) => execFileSync(process.execPath, [join(workspace, 'env.mjs'), ...args], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 30000,
    })
    const transcript = strategy.steps(run)
    const gradeModule = await import(
      pathToFileURL(join(workspace, 'grade.mjs')).href + '?v=' + Date.now(),
    )
    const previous = process.env.DSH_PROBE_EPISODE
    process.env.DSH_PROBE_EPISODE = workspace
    let result
    try {
      result = gradeModule.grade()
    } finally {
      if (previous === undefined) delete process.env.DSH_PROBE_EPISODE
      else process.env.DSH_PROBE_EPISODE = previous
    }
    return { ...result, label: strategy.label, transcript: options.verbose === true ? transcript : undefined }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

/** The inventory a run report can quote: every probe dir must be complete. */
export function probeInventory() {
  return PROBES.map((name) => ({
    name,
    files: readdirSync(join(PROBE_ROOT, name)).sort(),
  }))
}

/** Run every probe's two policies and report whether each probe discriminates. */
export async function runSelftest(options = {}) {
  const rows = []
  for (const name of PROBES) {
    const bad = await runStrategy(name, 'bad', options)
    const good = await runStrategy(name, 'good', options)
    const rule = DISCRIMINATORS[name]
    const badValue = Number(bad.metrics[rule.metric] ?? 0)
    const goodValue = Number(good.metrics[rule.metric] ?? 0)
    const directionHolds = rule.direction === 'up' ? goodValue > badValue : goodValue < badValue
    rows.push({
      name,
      rule,
      bad: { passed: bad.passed === true, score: bad.score, value: badValue, label: bad.label },
      good: { passed: good.passed === true, score: good.score, value: goodValue, label: good.label },
      ok: good.passed === true && bad.passed === false && directionHolds,
    })
  }
  return { rows, ok: rows.every((row) => row.ok) }
}

function render(result) {
  const lines = []
  lines.push('probe                 bad policy                      good policy                     discriminates')
  for (const row of result.rows) {
    const bad = (row.bad.passed ? 'PASS' : 'fail') + ' ' + row.rule.metric + '=' + row.bad.value
    const good = (row.good.passed ? 'PASS' : 'fail') + ' ' + row.rule.metric + '=' + row.good.value
    lines.push(row.name.padEnd(20) + '  ' + bad.padEnd(30) + '  ' + good.padEnd(30) + '  ' + (row.ok ? 'yes' : 'NO'))
  }
  return lines.join('\n')
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('probe-selftest.mjs')
if (isMain) {
  const verbose = process.argv.includes('--verbose')
  const result = await runSelftest({ verbose })
  console.log(render(result))
  if (verbose) {
    for (const row of result.rows) {
      console.log('')
      console.log(row.name + ' good policy: ' + row.good.label)
      console.log(row.name + ' bad policy:  ' + row.bad.label)
    }
  }
  process.exit(result.ok ? 0 : 1)
}