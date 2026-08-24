/**
 * Active-skin selection persistence (issue #506): a tiny JSON document under
 * $DSH_HOME written by POST /api/skin-center/v2/active and read on every
 * index.html response by the tapIndex adapter. Since issue #996 the same
 * document also carries the skin-background preference set, so paired remote
 * desktops (where the settings scope is loopback-only) read and persist
 * background values through the v2 channel. Kept dependency-free and
 * synchronous: the tap runs per response and must never await.
 * @module @linxin666/dsh-client-ui-skin-center/active-state
 */

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { normalizeSkinBackground, type SkinBackgroundConfig } from './core/background.ts'
import { userSkinsDir } from './skin-repo.ts'

/**
 * The single skin shipped with the package (the market on-demand plan): the
 * default look for a fresh install. Every other skin is a market download
 * into the user skins directory; nothing else is bundled.
 */
export const DEFAULT_SKIN_ID = 'blue-fantasy'

/** Default location: $DSH_HOME/skin-center-active.json. */
export function defaultActiveStatePath(): string {
  return join(userSkinsDir(), '..', 'skin-center-active.json')
}

/** The persisted document: active skin id plus the background preferences. */
export interface ActiveStateFile {
  active: string | null
  background: SkinBackgroundConfig | null
  initialized: boolean
}

/** Fields a write may set; absent keys keep their stored value (merge). */
export interface ActiveStateUpdate {
  active?: string | null
  background?: SkinBackgroundConfig | null
}

/** Read the whole state document; unreadable data yields all-null fields and initialized=false. */
export function readActiveState(path: string): ActiveStateFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { active?: unknown; background?: unknown; initialized?: unknown }
    const hasInitialized = typeof parsed.initialized === 'boolean'
      ? parsed.initialized
      : (typeof parsed === 'object' && parsed !== null && ('active' in parsed || 'background' in parsed))
    return {
      active: typeof parsed.active === 'string' ? parsed.active : null,
      background: parsed.background === undefined || parsed.background === null
        ? null
        : normalizeSkinBackground(parsed.background),
      initialized: hasInitialized,
    }
  } catch {
    return { active: null, background: null, initialized: false }
  }
}

/** Read the persisted active skin id (null = stock look / unreadable). */
export function readActiveSelection(path: string): string | null {
  return readActiveState(path).active
}

/**
 * Persist an update with merge semantics: keys absent from `update` keep
 * their stored value, so a skin switch never wipes the background section
 * and a background write never wipes the selection. The background key is
 * omitted from the document while it is null, keeping legacy files clean.
 */
export function writeActiveState(path: string, update: ActiveStateUpdate): void {
  const current = readActiveState(path)
  const active = update.active === undefined ? current.active : update.active
  const background = update.background === undefined ? current.background : update.background
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  // Atomic replace (issue #678): write a sibling temp file then rename over
  // the target, so a crash mid-write can never leave a half-written JSON that
  // readActiveState would silently discard. The temp dir is cleaned up on
  // both success and failure.
  const tmpDir = mkdtempSync(join(dir, `${basename(path)}.tmp-`))
  const tmp = join(tmpDir, basename(path))
  const document: { active: string | null; background?: SkinBackgroundConfig; initialized: boolean } = {
    active,
    initialized: true,
  }
  if (background !== null) document.background = background
  try {
    writeFileSync(tmp, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, path)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** Persist the active skin id (creates the parent directory). */
export function writeActiveSelection(path: string, id: string | null): void {
  writeActiveState(path, { active: id })
}

/**
 * Seed the active selection on a first boot (no persisted selection): the
 * shipped default skin becomes the active look. Never overwrites an existing
 * selection — in particular an upgrade keeps (and later resolves) whatever
 * the user had picked, and a selection that vanished from the catalog falls
 * back to the stock look on the browser side.
 * @param path - active-state file path.
 * @param find - whether the default id exists in the current catalog.
 * @returns whether the seed wrote the selection.
 */
export function seedDefaultActiveSkin(path: string, find: (id: string) => boolean): boolean {
  const state = readActiveState(path)
  if (state.initialized || state.active !== null) return false
  if (!find(DEFAULT_SKIN_ID)) return false
  writeActiveSelection(path, DEFAULT_SKIN_ID)
  return true
}
