/**
 * Active-skin selection persistence (issue #506): a tiny JSON document under
 * $DSH_HOME written by POST /api/skin-center/v2/active and read on every
 * index.html response by the tapIndex adapter. Kept dependency-free and
 * synchronous: the tap runs per response and must never await.
 *
 * The document also carries the background preferences (occlusion / blur
 * strengths): the settings scope is loopback-only for paired remote devices,
 * so background values persist here and ride the v2 channel instead.
 * @module @linxin666/dsh-client-ui-skin-center/active-state
 */

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { parseBackgroundConfig, type SkinBackgroundConfig } from './core/background.ts'
import { userSkinsDir } from './skin-repo.ts'

/** Default location: $DSH_HOME/skin-center-active.json. */
export function defaultActiveStatePath(): string {
  return join(userSkinsDir(), '..', 'skin-center-active.json')
}

/** The complete v2 state document: active skin id plus background preferences. */
export interface ActiveStateFile {
  active: string | null
  background: SkinBackgroundConfig | null
}

/** Read the persisted active skin id (null = stock look / unreadable). */
export function readActiveSelection(path: string): string | null {
  return readActiveState(path).active
}

/**
 * Read the complete state document. The background section is schema-validated:
 * missing or invalid values read back as null; the active id follows the same
 * fail-closed rule.
 */
export function readActiveState(path: string): ActiveStateFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { active?: unknown, background?: unknown }
    return {
      active: typeof parsed.active === 'string' ? parsed.active : null,
      background: parsed.background === undefined ? null : parseBackgroundConfig(parsed.background),
    }
  } catch {
    return { active: null, background: null }
  }
}

/**
 * Persist the active skin id and the background preferences (creates the
 * parent directory). An omitted (`undefined`) background preserves the value
 * already in the file; `null` explicitly clears it.
 */
export function writeActiveState(path: string, active: string | null, background?: SkinBackgroundConfig | null): void {
  const existing = background === undefined ? readActiveState(path).background : background
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  // Atomic replace (issue #678): write a sibling temp file then rename over
  // the target, so a crash mid-write can never leave a half-written JSON that
  // the readers would silently discard. The temp dir is cleaned up on both
  // success and failure.
  const tmpDir = mkdtempSync(join(dir, `${basename(path)}.tmp-`))
  const tmp = join(tmpDir, basename(path))
  try {
    writeFileSync(tmp, JSON.stringify({ active, background: existing }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, path)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** Persist the active skin id, preserving any existing background preferences. */
export function writeActiveSelection(path: string, id: string | null): void {
  writeActiveState(path, id)
}
