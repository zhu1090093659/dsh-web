#!/usr/bin/env node
/**
 * Split the workspace test suites across CI shards.
 *
 * The CI unit lane runs four of these in parallel
 * (`node scripts/test-shard.mjs <shard> 4`), so the partition must be
 * complete (the union of all shards is exactly the set of workspace packages
 * that declare a `test` script), disjoint (no package runs twice) and
 * deterministic (the same tree always yields the same assignment, whatever
 * order the enumeration returns). Those three properties are asserted by
 * scripts/test-shard.test.mjs, which runs as part of pnpm test:scripts.
 *
 * The assignment is longest-processing-time first over the checked-in weight
 * table below, with the workspace directory as the tie-break, and it is a pure
 * function so it can be tested without running a suite.
 *
 * Usage:
 *   node scripts/test-shard.mjs <shard> <total> [--dry-run] [--concurrency <n>]
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT_PATH), '..')

/**
 * Measured suite durations in seconds, keyed by workspace-relative directory
 * (local run, ten cores). They only steer the partition: being wrong about one
 * package costs balance, never coverage, because the shard set is derived from
 * the workspace rather than from this table.
 */
export const PACKAGE_WEIGHTS = Object.freeze({
  'packages/dsh-task-board': 20,
  'packages/dsh-git-graph': 14,
  'shared': 11,
  'packages/dsh-ssh': 8,
  'packages/dsh-web-all': 7,
  'packages/dsh-plugin-manager': 7,
  'packages/dsh-task-board-github': 6,
  'packages/dsh-usage': 5,
  'packages/dsh-skill-explorer': 5,
  'packages/dsh-liangshen': 5,
  'packages/dsh-update': 4,
  'packages/dsh-session-archive': 4,
  'packages/dsh-market': 4,
  'packages/dsh-session-id': 2,
  'packages/dsh-i18n': 2,
})

/** Weight of a package missing from PACKAGE_WEIGHTS: the table's median. */
export const DEFAULT_WEIGHT_SECONDS = 5

/**
 * How many package suites one shard runs at once. Each suite runner already
 * fans out over several cores (vitest sizes its default pool from the CPU
 * count), so in-flight suites bound oversubscription rather than filling idle
 * capacity: two keeps a four-vCPU CI runner busy without stacking whole suites
 * on top of each other's workers. Overridable with --concurrency.
 */
const DEFAULT_CONCURRENCY = 2

const DEFAULT_SHARD_TOTAL = 4

/** How much of a failed package's captured output is echoed (the tail carries the failure). */
const FAILED_OUTPUT_TAIL_LINES = 200

const USAGE = 'usage: node scripts/test-shard.mjs <shard> <total> [--dry-run] [--concurrency <n>]'

/** The `packages:` list of pnpm-workspace.yaml, in file order. */
export function parseWorkspaceGlobs(yamlText) {
  const globs = []
  let inPackages = false
  for (const rawLine of yamlText.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/\s+$/, '')
    if (!inPackages) {
      if (/^packages:\s*$/.test(line)) inPackages = true
      continue
    }
    if (line.trim() === '') continue
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item === null) break
    globs.push(item[1].replace(/^['"]|['"]$/g, ''))
  }
  return globs
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isDirectory(path) {
  const stats = statSync(path, { throwIfNoEntry: false })
  return stats !== undefined && stats.isDirectory()
}

/** Directories of one workspace glob pattern, workspace-relative, POSIX separators. */
function expandPattern(root, pattern) {
  let bases = ['']
  for (const segment of pattern.split('/')) {
    if (segment.includes('**')) {
      throw new Error(`pnpm-workspace.yaml uses a recursive glob that scripts/test-shard.mjs does not expand: ${pattern}`)
    }
    const next = []
    for (const base of bases) {
      if (!segment.includes('*')) {
        next.push(base === '' ? segment : `${base}/${segment}`)
        continue
      }
      const absoluteBase = join(root, base)
      if (!isDirectory(absoluteBase)) continue
      const matcher = new RegExp(`^${segment.split('*').map(escapeRegExp).join('.*')}$`)
      for (const entry of readdirSync(absoluteBase, { withFileTypes: true })) {
        if (entry.isDirectory() && matcher.test(entry.name)) {
          next.push(base === '' ? entry.name : `${base}/${entry.name}`)
        }
      }
    }
    bases = next
  }
  return bases.sort()
}

/**
 * Every directory the workspace globs select. A pattern that matches nothing,
 * or an exact path that does not exist, is an error: a silently shrunk
 * workspace is exactly the failure this script must not have.
 */
export function expandWorkspaceGlobs(root, globs) {
  const selected = new Set()
  for (const raw of globs) {
    const pattern = raw.trim()
    if (pattern === '') continue
    if (pattern.startsWith('!')) {
      throw new Error(`pnpm-workspace.yaml negation patterns are not supported by scripts/test-shard.mjs: ${pattern}`)
    }
    const matches = expandPattern(root, pattern)
    if (matches.length === 0) {
      throw new Error(`pnpm-workspace.yaml pattern '${pattern}' selects no directory`)
    }
    for (const match of matches) {
      if (!isDirectory(join(root, match))) {
        throw new Error(`pnpm-workspace.yaml pattern '${pattern}' selects a missing directory: ${match}`)
      }
      selected.add(match)
    }
  }
  return [...selected].sort()
}

/**
 * Workspace packages that declare a test script, one entry per package, sorted
 * by directory. `dir` is workspace-relative with POSIX separators; `name` is
 * the manifest name; `weight` is the checked-in table value or the default.
 */
export function listTestPackages(root = ROOT) {
  const globs = parseWorkspaceGlobs(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  if (globs.length === 0) {
    throw new Error('pnpm-workspace.yaml declares no packages list')
  }
  const packages = []
  for (const dir of expandWorkspaceGlobs(root, globs)) {
    const manifestPath = join(root, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const testScript = manifest.scripts?.test
    if (typeof testScript !== 'string' || testScript.trim() === '') continue
    packages.push({ dir, name: manifest.name, weight: PACKAGE_WEIGHTS[dir] ?? DEFAULT_WEIGHT_SECONDS })
  }
  if (packages.length === 0) {
    throw new Error('no workspace package declares a test script')
  }
  return packages.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}

/** Total weight of one shard, in the table's seconds. */
export function shardWeight(shard) {
  return shard.reduce((total, pkg) => total + pkg.weight, 0)
}

/**
 * Pure partition: longest processing time first into the least loaded shard,
 * the lowest shard index winning a tie, the directory name breaking the weight
 * tie in the input order. Each shard keeps its packages heaviest first.
 */
export function partitionShards(packages, shardCount) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shard count must be a positive integer, got ${shardCount}`)
  }
  const ordered = [...packages].sort(
    (a, b) => b.weight - a.weight || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0),
  )
  const shards = Array.from({ length: shardCount }, () => [])
  const loads = new Array(shardCount).fill(0)
  for (const pkg of ordered) {
    let target = 0
    for (let index = 1; index < shardCount; index += 1) {
      if (loads[index] < loads[target]) target = index
    }
    shards[target].push(pkg)
    loads[target] += pkg.weight
  }
  return shards
}

/** One line per shard: index, weight, count and the package directories. */
export function formatPlan(shards) {
  return shards.map((shard, index) => {
    const dirs = shard.map((pkg) => pkg.dir).join(', ')
    return `test-shard: shard ${index + 1}/${shards.length} weight ${shardWeight(shard)}s ${shard.length} packages: ${dirs}`
  })
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function runSuite(pkg) {
  return new Promise((resolveRun) => {
    const started = Date.now()
    const child = spawn(pnpmCommand(), ['run', 'test'], {
      cwd: join(ROOT, pkg.dir),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk) => {
      output += chunk
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      resolveRun({ pkg, code: 1, seconds: (Date.now() - started) / 1000, output: `${output}\n${error.message}` })
    })
    child.on('close', (code) => {
      resolveRun({ pkg, code: code ?? 1, seconds: (Date.now() - started) / 1000, output })
    })
  })
}

async function runBounded(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function tailLines(text, limit) {
  const lines = text.split('\n')
  if (lines.length <= limit) return lines.join('\n')
  return [`... ${lines.length - limit} earlier lines omitted ...`, ...lines.slice(-limit)].join('\n')
}

async function runShard(shardIndex, shards, concurrency) {
  const shard = shards[shardIndex - 1]
  const label = `shard ${shardIndex}/${shards.length}`
  const wallStarted = Date.now()
  console.log(`test-shard: ${label} weight ${shardWeight(shard)}s, ${shard.length} packages, concurrency ${concurrency}`)

  const results = await runBounded(shard, concurrency, async (pkg) => {
    const result = await runSuite(pkg)
    const status = result.code === 0 ? 'ok  ' : 'FAIL'
    console.log(`[${label}] ${status} ${pkg.dir} ${result.seconds.toFixed(1)}s`)
    if (result.code !== 0) {
      console.log(`[${label}] ----- output: ${pkg.dir} (exit ${result.code}) -----`)
      console.log(tailLines(result.output, FAILED_OUTPUT_TAIL_LINES).replace(/\s+$/, ''))
      console.log(`[${label}] ----- end output: ${pkg.dir} -----`)
      console.log(`::error::${pkg.dir} failed in ${label} (exit ${result.code})`)
    }
    return result
  })

  const failed = results.filter((result) => result.code !== 0)
  const wall = (Date.now() - wallStarted) / 1000
  console.log(
    `test-shard: ${label} done: ${results.length - failed.length} passed, ${failed.length} failed, wall ${wall.toFixed(1)}s`,
  )
  if (failed.length > 0) {
    console.log(`test-shard: ${label} failing packages: ${failed.map((result) => result.pkg.dir).join(', ')}`)
    return 1
  }
  return 0
}

function parseArgs(argv) {
  const positional = []
  let dryRun = false
  let concurrency = DEFAULT_CONCURRENCY
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--concurrency') {
      index += 1
      concurrency = Number(argv[index])
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = Number(arg.slice('--concurrency='.length))
    } else if (arg === '--help' || arg === '-h') {
      return { help: true }
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  const shardIndex = Number(positional[0])
  const total = positional.length > 1 ? Number(positional[1]) : DEFAULT_SHARD_TOTAL
  if (!Number.isInteger(shardIndex) || shardIndex < 1) {
    throw new Error(`shard index must be a positive integer, got '${positional[0] ?? ''}'`)
  }
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard total must be a positive integer, got '${positional[1] ?? ''}'`)
  }
  if (shardIndex > total) {
    throw new Error(`shard index ${shardIndex} is outside 1..${total}`)
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got '${concurrency}'`)
  }
  return { shardIndex, total, dryRun, concurrency }
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const packages = listTestPackages(ROOT)
  const shards = partitionShards(packages, options.total)
  for (const line of formatPlan(shards)) console.log(line)
  if (options.dryRun) {
    const totalWeight = shardWeight(packages)
    console.log(`test-shard: dry run, ${packages.length} packages, weight ${totalWeight}s, nothing executed`)
    return 0
  }
  return runShard(options.shardIndex, shards, options.concurrency)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(`test-shard: ${error.message}`)
      process.exitCode = 1
    })
}
