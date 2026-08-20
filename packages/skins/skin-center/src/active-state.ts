/**
 * Active-skin selection persistence (issue #506): a tiny JSON document under
 * $DSH_HOME written by POST /api/skin-center/v2/active and read on every
 * index.html response by the tapIndex adapter. Kept dependency-free and
 * synchronous: the tap runs per response and must never await.
 * @module @linxin666/dsh-client-ui-skin-center/active-state
 */

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { userSkinsDir } from './skin-repo.ts'

/** Default location: $DSH_HOME/skin-center-active.json. */
export function defaultActiveStatePath(): string {
  return join(userSkinsDir(), '..', 'skin-center-active.json')
}

/** Read the persisted active skin id (null = stock look / unreadable). */
export function readActiveSelection(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { active?: unknown }
    return typeof parsed.active === 'string' ? parsed.active : null
  } catch {
    return null
  }
}

/** Persist the active skin id (creates the parent directory). */
export function writeActiveSelection(path: string, id: string | null): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  // Atomic replace (issue #678): write a sibling temp file then rename over
  // the target, so a crash mid-write can never leave a half-written JSON that
  // readActiveSelection would silently discard. The temp dir is cleaned up on
  // both success and failure.
  const tmpDir = mkdtempSync(join(dir, `${basename(path)}.tmp-`))
  const tmp = join(tmpDir, basename(path))
  try {
    writeFileSync(tmp, JSON.stringify({ active: id }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, path)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
