/**
 * In-process pet switching for the pet center — which pet is active is
 * controlled by a managed section of `~/.dsh/cordis.patch.yml` (atomic
 * rewrite, hot-reloaded by the DSH config watcher within seconds, no
 * restart), mirroring how the skin center switches skins.
 *
 * The two pets are both bundle-wired rows of the family aggregate (no insert
 * row needed): the active pet is the one the managed section does NOT
 * disable. `usePet` rewrites the section so exactly one pet stays enabled and
 * the other is disabled; `current` reads the active back.
 *
 * The behaviour/text is a focused port of the skin center's skin-switch.ts.
 * @module @linxin666/dsh-client-ui-pet-center/pet-switch
 */

import {
  mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join as joinPath } from 'node:path'

/** Pet ids the center understands. */
export type PetId = 'pet' | 'pet-maid'

/** One pet's switch metadata (both are bundle-wired aggregate rows). */
export interface PetSwitchEntry {
  /** Pet id = the aggregate cordis.patch.yml row id. */
  id: PetId
  /** The cordis plugin package (boot-graph entry when active). */
  pkg: string
  /** Human-facing key fragment used to compose locale labels. */
  key: 'original' | 'introduced'
}

/** Pets the center can select between. */
export const PETS: readonly PetSwitchEntry[] = [
  { id: 'pet', pkg: '@linxin666/dsh-pet', key: 'original' },
  { id: 'pet-maid', pkg: '@linxin666/dsh-pet-maid', key: 'introduced' },
] as const

/** The default pet when the managed section is absent / both are enabled. */
export const DEFAULT_PET: PetId = 'pet'

/** Managed patch-section delimiters (the single authority of pet switching). */
export const MANAGED_START = '# --- dsh-pet managed (auto-generated; do not edit) ---'
export const MANAGED_END = '# --- end dsh-pet managed ---'

/** The GUI profile this machine runs (dsh web); overridable via DSH_PET_PROFILE. */
const DEFAULT_PROFILE = process.env.DSH_PET_PROFILE ?? 'web'

/** Layout of the DSH home the pet switch operates on. */
export interface PetSwitchPaths {
  /** ~/.dsh/cordis.patch.yml */
  patchPath: string
  /** ~/.dsh/profiles/<profile> (unused for pets; kept for parity/probing). */
  profileDir: string
}

/**
 * Resolve the DSH paths under a HOME. home/profile are injectable so tests
 * can point at a throwaway HOME.
 * @param home - home dir (defaults to the process HOME).
 * @param profile - profile name (defaults to DSH_PET_PROFILE or 'web').
 */
export function resolvePetPaths(home: string = homedir(), profile: string = DEFAULT_PROFILE): PetSwitchPaths {
  return {
    patchPath: joinPath(home, '.dsh', 'cordis.patch.yml'),
    profileDir: joinPath(home, '.dsh', 'profiles', profile),
  }
}

/** Read a patch file, tolerating absence. */
function readPatch(patchPath: string): string {
  try {
    return readFileSync(patchPath, 'utf8')
  } catch {
    return ''
  }
}

/** Atomic replace: write a sibling temp file then rename over the target. */
function writePatchAtomic(filePath: string, next: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmp, next)
  renameSync(tmp, filePath)
}

/** Remove the managed pet section; throws on an unterminated section. */
export function stripManaged(patch: string): string {
  const start = patch.indexOf(MANAGED_START)
  if (start === -1) return patch
  const end = patch.indexOf(MANAGED_END, start)
  if (end === -1) throw new Error('managed pet section is unterminated; fix ~/.dsh/cordis.patch.yml')
  return patch.slice(0, start) + patch.slice(end + MANAGED_END.length)
}

/**
 * Render the managed section so exactly `active` stays enabled: every other
 * pet gets `disabled: true`; both pets are bundle-wired, so the active needs
 * no insert row.
 * @param active - the pet to keep enabled.
 */
export function renderManaged(active: PetId): string {
  const lines = [MANAGED_START]
  for (const pet of PETS) {
    if (pet.id === active) continue
    lines.push(`- id: ${pet.id}`, '  disabled: true')
  }
  lines.push(MANAGED_END)
  return lines.join('\n')
}

/**
 * Which pet a patch keeps active: the bundle-wired pet the patch resource of
 * the managed section does NOT disable. When neither is disabled (or the
 * section is absent) both are live and the default is reported.
 * @param patch - raw patch file text.
 * @param fallback - pet id to report when neither is disabled.
 */
export function currentActive(patch: string, fallback: PetId = DEFAULT_PET): PetId {
  const managed = patch.slice(
    patch.indexOf(MANAGED_START) === -1 ? 0 : patch.indexOf(MANAGED_START),
    patch.indexOf(MANAGED_END) === -1 ? patch.length : patch.indexOf(MANAGED_END),
  )
  const disabled = new Set<PetId>()
  for (const m of managed.matchAll(/^- id: (pet|pet-maid)\n  disabled: true/gm)) {
    if (m[1] === 'pet' || m[1] === 'pet-maid') disabled.add(m[1])
  }
  const live = PETS.filter(pet => !disabled.has(pet.id)).map(pet => pet.id)
  return live.length === 1 ? live[0]! : fallback
}

/**
 * Switch the active pet: rewrite the managed section of the boot patch so
 * exactly one pet stays enabled, atomically.
 * @param name - pet id to activate.
 * @param opts - injectable HOME/profile.
 * @returns the human-facing confirmation string.
 */
export function usePet(name: string, opts: { home?: string; profile?: string } = {}): string {
  if (name !== 'pet' && name !== 'pet-maid') {
    throw new Error(`unknown pet "${name}". Known: pet, pet-maid`)
  }
  const paths = resolvePetPaths(opts.home, opts.profile)
  const patch = stripManaged(readPatch(paths.patchPath))
  const next = `${patch.replace(/\s+$/, '')}\n\n${renderManaged(name)}\n`
  writePatchAtomic(paths.patchPath, next)
  return `pet switched to "${name}" — the config watcher applies it within seconds; refresh the page to see it.`
}

/**
 * Read the active pet.
 * @param patch - optional pre-read patch text.
 * @param opts - injectable HOME/profile.
 * @returns the active pet id (defaults to `pet` when both are live).
 */
export function currentPet(patch: string | undefined, opts: { home?: string; profile?: string } = {}): PetId {
  const paths = resolvePetPaths(opts.home, opts.profile)
  return currentActive(patch ?? readPatch(paths.patchPath))
}
