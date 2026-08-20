/**
 * Legacy bridge (issue #506, migration path): ONE-SHOT, THIN. On the first
 * v2 boot it reads the retired dsh-skin machinery's state — the
 * "dsh-skin managed" section of the active profile's cordis.patch.yml —
 * migrates the active skin id into the v2 selection store
 * (skin-center-active.json), and strips the managed/legacy skin rows so the
 * config watcher's next reload boots without the old bundle. No old runtime
 * is kept: after the migration the managed section is gone for good.
 *
 * Reading the active id without the retired registry:
 *  1. an insert row naming a dsh-client-ui-skin-<id> package → that id;
 *  2. otherwise, with the v2 catalog as the known-id universe: the known id
 *     whose ui-skin-<id> row is NOT disabled inside the managed section
 *     (bundle-wired active skins carried no row of their own);
 *  3. a managed section disabling everything (or no section at all) → stock.
 * @module @linxin666/dsh-client-ui-skin-center/legacy-bridge
 */

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { readActiveSelection, writeActiveSelection } from './active-state.ts'
import { resolveHarnessPaths } from './harness-home.ts'

/**
 * Atomic replace: write a sibling temp file then rename over the target, so
 * a crash mid-write can never leave a half-written boot patch and the config
 * watcher only ever sees complete content (ported from the retired
 * skin-switch.ts).
 */
export function writePatchAtomic(filePath: string, next: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  let previousMode: number | undefined
  try {
    previousMode = statSync(filePath).mode & 0o777
  } catch {
    previousMode = undefined
  }
  const tmpDir = mkdtempSync(join(dir, `${basename(filePath)}.tmp-`))
  const tmp = join(tmpDir, basename(filePath))
  try {
    writeFileSync(tmp, next, { flag: 'wx' })
    chmodSync(tmp, previousMode ?? 0o600)
    renameSync(tmp, filePath)
  } catch (error) {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Preserve the original write failure over a cleanup failure.
    }
    throw error
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // The patch was already renamed into place; an empty tmp-dir cleanup
    // failure must not turn a successful write into an error.
  }
}

export const MANAGED_START = '# --- dsh-skin managed (auto-generated; do not edit) ---'
export const MANAGED_END = '# --- end dsh-skin managed ---'

/**
 * Remove every managed skin section (issue #676: a second stray section kept
 * hasLegacyState true and re-ran the migration on each boot). Throws on an
 * unterminated section (a malformed boot patch must fail loudly, never be
 * silently half-written).
 */
export function stripManaged(patch: string): string {
  let out = patch
  while (true) {
    const start = out.indexOf(MANAGED_START)
    if (start === -1) return out
    const end = out.indexOf(MANAGED_END, start)
    if (end === -1) throw new Error('managed skin section is unterminated; fix the harness cordis.patch.yml')
    out = out.slice(0, start) + out.slice(end + MANAGED_END.length)
  }
}

/** Remove - insert: items left with no - id: rows after legacy cleanup. */
function dropEmptyInserts(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (/^-\s*insert:\s*(?:\[\s*\])?\s*$/.exec(trimmed) === null) {
      out.push(line)
      i += 1
      continue
    }
    const indent = line.length - trimmed.length
    let j = i + 1
    let hasRow = false
    while (j < lines.length) {
      const t = lines[j].trim()
      if (t === '') { j += 1; continue }
      const ind = lines[j].length - t.length
      if (ind <= indent) break
      if (!t.startsWith('#') && /^- id:/.test(t)) hasRow = true
      j += 1
    }
    if (hasRow) {
      for (let k = i; k < j; k += 1) out.push(lines[k])
    }
    i = j
  }
  return out.join('\n')
}

/**
 * Drop legacy hand-written skin insert rows (and their touch comments).
 * Id-target rows (- id: ui-skin-x + disabled: true, no name: line) carry the
 * mutual-exclusion wiring and are removed by stripManaged together with the
 * section; stragglers outside the section are dropped here only when they
 * are insert rows (a name: line directly below).
 */
export function stripLegacySkinRows(patch: string): string {
  const lines = patch.split(/\r?\n/)
  const kept: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const idMatch = /^\s*- id:\s*(ui-skin-[a-z0-9-]+)\s*$/.exec(line)
    if (idMatch !== null) {
      const next = lines[i + 1]
      // dsh-client-ui-skin-center is the skin CENTER's own wiring, never a
      // skin row — the negative lookahead keeps it untouched.
      const insertName = next === undefined
        ? null
        : /^\s*name:\s*['"]?@[a-z0-9][a-z0-9._-]*\/dsh-client-ui-skin-(?!center['"]?\s*$)[^'"]*['"]?\s*$/.exec(next)
      if (insertName !== null) {
        if (i > 0 && /^\s*#[^\n]*$/.test(lines[i - 1]) && kept[kept.length - 1] === lines[i - 1]) kept.pop()
        i += 1 // skip the name line; the loop increment skips the id line
        continue
      }
    }
    kept.push(line)
  }
  let text = kept.join('\n').replace(/^# \(touch\)[^\n]*\n?/gm, '')
  text = dropEmptyInserts(text)
  return text.replace(/\n{3,}/g, '\n\n')
}

/** Drop bare top-level empty flow lists left by the stock profile template. */
export function stripEmptyPatchList(patch: string): string {
  return patch.replace(/^[ \t]*\[\s*\][ \t]*\r?\n?/gm, '')
}

/** Full legacy cleanup: managed section + insert rows + empty flow list. */
export function stripLegacySkinState(patch: string): string {
  return stripEmptyPatchList(stripLegacySkinRows(stripManaged(patch)))
}

/**
 * Read the active legacy skin id from a patch text.
 * @param patch - raw cordis.patch.yml text.
 * @param knownIds - the v2 catalog's known skin ids (bundle-wired detection).
 */
export function readLegacyActiveId(patch: string, knownIds: readonly string[]): string | null {
  // The first skin insert row wins; dsh-client-ui-skin-center is the skin
  // center's own wiring and never names an active skin.
  for (const m of patch.matchAll(/name:\s*['"]?@linxin666\/dsh-client-ui-skin-([a-z0-9-]+)['"]?/g)) {
    if (m[1] !== 'center') return m[1]
  }
  if (!patch.includes(MANAGED_START)) return null
  const disabled = new Set<string>()
  for (const m of patch.matchAll(/^- id: (ui-skin-[a-z0-9-]+)\r?\n  disabled: true/gm)) {
    disabled.add(m[1].replace('ui-skin-', ''))
  }
  const candidates = knownIds.filter((id) => !disabled.has(id))
  return candidates.length === 1 ? candidates[0] : null
}

export interface LegacyMigrationResult {
  /** The migrated skin id, or null when there was nothing to migrate. */
  migrated: string | null
  /** Whether the patch file was rewritten (legacy rows stripped). */
  patchCleaned: boolean
  /** Human-readable notes for the host log. */
  notes: string[]
}

/**
 * Run the one-shot migration. Idempotent: once the v2 selection file exists
 * and the patch carries no managed section, this is a no-op. Never throws —
 * a failed migration leaves the legacy state untouched (the old mechanism
 * still works until M4 removes it) and reports via notes.
 */
export function migrateLegacySelection(options: {
  knownIds: readonly string[]
  activeStatePath: string
  patchPath?: string
  writePatch?: (path: string, next: string) => void
}): LegacyMigrationResult {
  const notes: string[] = []
  const result: LegacyMigrationResult = { migrated: null, patchCleaned: false, notes }
  try {
    const patchPath = options.patchPath ?? resolveHarnessPaths().patchPath
    let patch: string
    try {
      patch = readFileSync(patchPath, 'utf8')
    } catch {
      notes.push('no readable cordis.patch.yml; nothing to migrate')
      return result
    }
    const hasLegacyState = patch.includes(MANAGED_START)
      || /name:\s*['"]?@linxin666\/dsh-client-ui-skin-/.test(patch)
    const alreadyMigrated = readActiveSelection(options.activeStatePath) !== null

    if (!hasLegacyState) {
      notes.push('no legacy managed skin state; nothing to migrate')
      return result
    }

    if (!alreadyMigrated) {
      const active = readLegacyActiveId(patch, options.knownIds)
      if (active !== null) {
        writeActiveSelection(options.activeStatePath, active)
        result.migrated = active
        notes.push(`migrated active skin "${active}" to the v2 selection store`)
      } else {
        notes.push('legacy state resolves to the stock look; selection store left unset')
      }
    } else {
      notes.push('v2 selection already present; skipped id migration')
    }

    let cleaned = stripLegacySkinState(patch)
    // A patch whose only content was the managed section would be left
    // empty — and an empty cordis.patch.yml is not a valid patch list (the
    // next boot fails on it). Normalize to the stock empty-sequence root.
    const isCommentOnly = cleaned.split(/\r?\n/)
      .every(line => line.trim() === '' || line.trimStart().startsWith('#'))
    if (isCommentOnly) cleaned = '[]\n'
    if (cleaned !== patch) {
      const write = options.writePatch ?? writePatchAtomic
      write(patchPath, cleaned)
      result.patchCleaned = true
      notes.push('stripped the legacy managed skin rows from cordis.patch.yml')
    }
    return result
  } catch (error) {
    notes.push(`legacy migration failed closed: ${(error as Error)?.message ?? error}`)
    return result
  }
}
