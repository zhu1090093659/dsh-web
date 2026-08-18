/**
 * Sync every preset directory under `sourceRoot` into `targetRoot` — the
 * dsh agent-presets discovery root (harness-home `.agent-presets`).
 *
 * A preset is a directory holding `agent.cordis.yml`; the directory name is
 * the preset id. Copy is per-directory and idempotent: a preset whose target
 * tree is byte-identical to the source tree is skipped, otherwise the source
 * tree is copied and any target files the source does not contain are removed.
 * Directories the plugin does not own (other presets the user authored) are
 * never touched.
 *
 * After a preset is synced its `agent.cordis.yml` is validated against the
 * structural preset schema; a validation failure is reported through the
 * run's `failed` entries instead of being a warn-only side effect, so callers
 * can observe (and surface) a broken preset rather than silently shipping it.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { validateAgentCordis } from './schema.ts'

/**
 * Clock/coarse-grain tolerance for the mtime fast path. When a source and a
 * target file share a size and a near-identical mtime we still fall through to
 * a byte comparison; a mtime gap beyond this simply proves the pair cannot be
 * byte-identical, so we skip the read.
 */
const MTIME_TOLERANCE_MS = 1000

/** One sync run's outcome, grouped for diagnostics. */
export interface SyncResult {
  /** Preset ids whose tree was (re)written this run. */
  synced: string[]
  /** Preset ids already current — nothing copied. */
  current: string[]
  /** Preset ids that failed, with the underlying error message. */
  failed: { id: string; error: string }[]
  /** Previously bundled preset ids removed from the target root this run. */
  retired: string[]
}

function filesUnder(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(path)
    }
  }
  walk(root)
  return out
}

/**
 * File identity is bytes. Size and mtime are only a fast negative check: a
 * size mismatch or a mtime gap beyond the tolerance proves the pair cannot be
 * byte-identical without reading both, but an equal size and close mtime still
 * fall through to a byte comparison so content differences are never missed.
 */
function sameFile(a: string, b: string): boolean {
  const sourceStat = statSync(a)
  const targetStat = statSync(b)
  if (sourceStat.size !== targetStat.size) return false
  if (Math.abs(sourceStat.mtimeMs - targetStat.mtimeMs) > MTIME_TOLERANCE_MS) return false
  return readFileSync(a).equals(readFileSync(b))
}

/**
 * Remove files not in `keep` (relative paths), then remove only the
 * directories those removals left empty — still strictly inside `root`, so
 * sibling presets are never touched.
 */
function pruneExtras(root: string, keep: ReadonlySet<string>): void {
  const parents = new Set<string>()
  for (const file of filesUnder(root)) {
    if (!keep.has(relative(root, file))) {
      parents.add(dirname(file))
      rmSync(file, { force: true })
    }
  }
  for (const start of parents) {
    let dir: string | undefined = start
    while (dir !== undefined && relative(root, dir) !== '') {
      if (existsSync(dir) && readdirSync(dir).length === 0) {
        rmSync(dir, { recursive: true, force: true })
        dir = dirname(dir)
      } else {
        dir = undefined
      }
    }
  }
}

/** Validate the synced preset's `agent.cordis.yml` artifact on disk. */
function validatePresetAgentFile(presetDir: string): string[] {
  const agent = join(presetDir, 'agent.cordis.yml')
  if (!existsSync(agent)) return ['agent.cordis.yml is missing from the preset tree']
  return validateAgentCordis(readFileSync(agent, 'utf8'))
}

/**
 * Copy the whole tree under `sourceDir` into `targetDir`, creating the target
 * directory as needed. Intentionally not `fs.cpSync` (recursive): on Node 22
 * for Windows, `fs.cpSync` with `recursive: true` crashes the process with a
 * fatal error (STATUS_STACK_BUFFER_OVERRUN / 0xC0000409, no JS exception is
 * thrown) whenever the source path contains non-ASCII characters such as a
 * CJK home directory (nodejs/node#54476, regression from nodejs/node#53614).
 * Since `engines` supports Node ^22.19.0, this must work on Node 22, so the
 * copy is done with the same per-entry primitives the rest of the module
 * already uses. Source mtimes are preserved to keep the `preserveTimestamps`
 * contract of the previous `cpSync` call.
 */
function copyTreeSync(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(sourceDir)) {
    const source = join(sourceDir, entry)
    const target = join(targetDir, entry)
    const stat = statSync(source)
    if (stat.isDirectory()) {
      copyTreeSync(source, target)
    } else {
      copyFileSync(source, target)
      utimesSync(target, stat.atime, stat.mtime)
    }
  }
}

/** Copy `sourceRoot/<id>` into `targetRoot/<id>`, idempotently. */
export function syncOnePreset(sourceDir: string, targetDir: string): 'synced' | 'current' {
  const sourceFiles = filesUnder(sourceDir)
  const sourceSet = new Set(sourceFiles.map(file => relative(sourceDir, file)))

  if (existsSync(targetDir) && !statSync(targetDir).isDirectory()) {
    rmSync(targetDir, { recursive: true, force: true })
  }
  if (!existsSync(targetDir)) {
    copyTreeSync(sourceDir, targetDir)
    pruneExtras(targetDir, sourceSet)
    return 'synced'
  }

  let dirty = false
  for (const file of sourceFiles) {
    const dest = join(targetDir, relative(sourceDir, file))
    if (!existsSync(dest) || !sameFile(file, dest)) {
      dirty = true
      break
    }
  }
  if (!dirty) {
    for (const file of filesUnder(targetDir)) {
      if (!sourceSet.has(relative(targetDir, file))) {
        dirty = true
        break
      }
    }
  }
  if (!dirty) return 'current'

  // Drop target-only entries first so file/dir type clashes never reach the
  // copy, then copy and prune again per the post-copy contract.
  pruneExtras(targetDir, sourceSet)
  copyTreeSync(sourceDir, targetDir)
  pruneExtras(targetDir, sourceSet)
  return 'synced'
}

/**
 * Sync every preset under `sourceRoot` into `targetRoot`, then remove
 * target directories named in `retire` that the bundle no longer ships —
 * preset ids the plugin once owned and later dropped. Only those exact ids
 * are removed; every other target directory is left untouched.
 *
 * Each synced (or already-current) preset is validated against the structural
 * `agent.cordis.yml` schema; a validation failure lands in `failed` so the
 * caller can surface a broken preset as a first-class result instead of a
 * warn-only log line.
 * @param sourceRoot - plugin-owned preset tree (bundled in the package).
 * @param targetRoot - dsh agent-presets discovery root (e.g. <home>/.dsh/.agent-presets).
 * @param retire - previously bundled preset ids to remove when absent from the source.
 */
export function syncPresetTrees(sourceRoot: string, targetRoot: string, retire: string[] = []): SyncResult {
  const result: SyncResult = { synced: [], current: [], failed: [], retired: [] }
  mkdirSync(targetRoot, { recursive: true })
  if (existsSync(sourceRoot)) {
    for (const entry of readdirSync(sourceRoot)) {
      const source = join(sourceRoot, entry)
      if (!statSync(source).isDirectory()) continue
      const id = basename(source)
      const targetDir = join(targetRoot, id)
      let outcome: 'synced' | 'current'
      try {
        outcome = syncOnePreset(source, targetDir)
      } catch (error) {
        result.failed.push({ id, error: error instanceof Error ? error.message : String(error) })
        continue
      }
      try {
        const problems = validatePresetAgentFile(targetDir)
        if (problems.length > 0) {
          result.failed.push({ id, error: `agent.cordis.yml failed validation: ${problems.join('; ')}` })
        } else if (outcome === 'synced') {
          result.synced.push(id)
        } else {
          result.current.push(id)
        }
      } catch (error) {
        result.failed.push({ id, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  for (const id of retire) {
    if (existsSync(join(sourceRoot, id))) continue
    const stale = join(targetRoot, id)
    if (existsSync(stale) && statSync(stale).isDirectory()) {
      rmSync(stale, { recursive: true, force: true })
      result.retired.push(id)
    }
  }
  return result
}
