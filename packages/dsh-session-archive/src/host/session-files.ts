/**
 * Session storage file layer: legacy jsonl.zstd directory discovery, segment
 * matching, path-safety checks, size accounting, and session-rdb sqlite row
 * deletion. The physical-delete boundary — every path removal here is
 * validated to stay inside the sessions root and never follows symlinks out.
 * @module @linxin666/dsh-session-archive/host/session-files
 */

import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/** Official `@deepseek-ai/dsh-session-persistence-sqlite` storage directory under `<dshHome>/sessions`. */
export const OFFICIAL_SQLITE_SEGMENTS_DIR = '.segments'

/** Official `@deepseek-ai/dsh-session-persistence-sqlite` SQLite application_id (`'DSPC'`). */
export const OFFICIAL_SQLITE_APPLICATION_ID = 0x44535043

/** Official `@deepseek-ai/dsh-session-persistence-sqlite` SQLite schema user_version. */
export const OFFICIAL_SQLITE_USER_VERSION = 1

/**
 * Canonical session id for one segment dir name. DSH persistence keys the
 * segment off the session id: a `session-<uuid>` id lands as segment
 * `<uuid>` (and some layouts keep the prefix). One dir maps to exactly one
 * canonical id — the `session-`-prefixed form used everywhere else — so the
 * inventory never produces phantom duplicate rows.
 */
export function canonicalSessionId(segment: string): string {
  return segment.startsWith('session-') ? segment : `session-${segment}`
}

export interface SessionDirIndex {
  /** session id (as used in the archive set) -> absolute dir path. */
  byId: Map<string, string>
  /** Summed file sizes per session id, when the dir exists. */
  sizes: Map<string, number>
  /** Segment dirs that could not be read at all. */
  unreadable: string[]
}

function dirSize(path: string): number {
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(path)
  } catch {
    return 0
  }
  for (const entry of entries) {
    try {
      const stat = statSync(join(path, entry))
      if (stat.isDirectory()) total += dirSize(join(path, entry))
      else total += stat.size
    } catch {
      // A vanished entry contributes nothing.
    }
  }
  return total
}

/** True when `child` is `root` itself or lies under it (realpath-ed, lexical). */
export function isInside(root: string, child: string): boolean {
  const relative = relativeWithin(root, child)
  return relative !== undefined
}

/** Lexical relative path of `child` under `root`, or undefined when outside. */
function relativeWithin(root: string, child: string): string | undefined {
  const rootAbs = resolve(root)
  const childAbs = resolve(child)
  if (childAbs === rootAbs) return ''
  if (!childAbs.startsWith(rootAbs + sep)) return undefined
  return childAbs.slice(rootAbs.length + 1)
}

/**
 * Scan the sessions root once and index every session dir. A session dir is
 * any directory under `<sessionsRoot>/<project>/` (the project key dirs are
 * the cwd-encoded ones). Symlinks are never followed into the index: a link
 * under the sessions root pointing outside is recorded as unreadable instead.
 */
export function indexSessionDirs(sessionsRoot: string): SessionDirIndex {
  const index: SessionDirIndex = { byId: new Map(), sizes: new Map(), unreadable: [] }
  if (!existsSync(sessionsRoot)) return index
  let rootReal: string
  try {
    rootReal = realpathSync(sessionsRoot)
  } catch {
    return index
  }
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(sessionsRoot)
  } catch {
    return index
  }
  for (const project of projectDirs) {
    // Official SQLite segment storage lives under `<sessionsRoot>/.segments`;
    // it is not a project directory and must never be scanned or deleted as one.
    if (project === OFFICIAL_SQLITE_SEGMENTS_DIR) continue
    const projectPath = join(sessionsRoot, project)
    let entries: string[]
    try {
      entries = readdirSync(projectPath)
    } catch {
      continue
    }
    for (const segment of entries) {
      const dirPath = join(projectPath, segment)
      let stat
      try {
        stat = statSync(dirPath)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      let real: string
      try {
        real = realpathSync(dirPath)
      } catch {
        index.unreadable.push(dirPath)
        continue
      }
      if (!isInside(rootReal, real)) {
        // A symlink escaping the sessions root is never managed here.
        index.unreadable.push(dirPath)
        continue
      }
      for (const candidate of [canonicalSessionId(segment)]) {
        if (!index.byId.has(candidate)) {
          index.byId.set(candidate, dirPath)
          index.sizes.set(candidate, dirSize(dirPath))
        }
      }
    }
  }
  return index
}

/**
 * Resolve one session's storage dir against an index. Returns undefined when
 * the session has no legacy directory (rdb-stored or foreign).
 */
export function findSessionDir(index: SessionDirIndex, id: string): string | undefined {
  return index.byId.get(id)
}

/** The session-rdb sqlite locations DSH/dsh-perf use, most likely first. */
export function rdbDbPaths(dshHome: string): string[] {
  return [join(dshHome, 'sessions', 'sessions.sqlite'), join(dshHome, 'sessions.sqlite')]
}

/** The official `@deepseek-ai/dsh-session-persistence-sqlite` database path. */
export function officialSqliteDbPath(dshHome: string): string {
  return join(dshHome, 'sessions', OFFICIAL_SQLITE_SEGMENTS_DIR, 'sessions.sqlite')
}

/** Whether `dbPath` is an official `@deepseek-ai/dsh-session-persistence-sqlite` database. */
export function isOfficialSessionSqlite(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const appId = db.prepare('pragma application_id').get() as { application_id?: number } | undefined
      const userVersion = db.prepare('pragma user_version').get() as { user_version?: number } | undefined
      return appId?.application_id === OFFICIAL_SQLITE_APPLICATION_ID && userVersion?.user_version === OFFICIAL_SQLITE_USER_VERSION
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/**
 * Read the canonical session ids currently stored in the official SQLite
 * segment database (`traces.trace_uuid`). Returns an empty set when the
 * database does not exist, has another fingerprint, or cannot be read.
 */
export function readOfficialSqliteSessionIds(dbPath: string): Set<string> {
  const ids = new Set<string>()
  if (!isOfficialSessionSqlite(dbPath)) return ids
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db.prepare('select trace_uuid from traces').all() as Array<{ trace_uuid?: unknown }>
      for (const row of rows) {
        if (typeof row.trace_uuid === 'string' && row.trace_uuid.length > 0) {
          ids.add(canonicalSessionId(row.trace_uuid))
        }
      }
    } finally {
      db.close()
    }
  } catch {
    // Unreadable database falls back to marker detection in callers.
  }
  return ids
}

/**
 * Whether a session has an official SQLite routing marker under
 * `<dshHome>/sessions/.segments/<sha256(id)>.json`. Used alongside
 * {@link readOfficialSqliteSessionIds} so an in-use or locked database still
 * protects SQLite-owned sessions from destructive directory deletion.
 */
export function hasOfficialSqliteMarker(dshHome: string, id: string, nativeId?: string): boolean {
  const dir = join(dshHome, 'sessions', OFFICIAL_SQLITE_SEGMENTS_DIR)
  if (!existsSync(dir)) return false
  const canonical = canonicalSessionId(id)
  const bare = canonical.startsWith('session-') ? canonical.slice('session-'.length) : canonical
  const spellings = new Set<string>([canonical, bare])
  if (nativeId !== undefined && nativeId.length > 0) spellings.add(nativeId)
  for (const spelling of spellings) {
    const hash = createHash('sha256').update(spelling).digest('hex')
    if (existsSync(join(dir, `${hash}.json`))) return true
  }
  return false
}

/** The session-rdb fingerprint: application_id + user_version (dsh-perf contract). */
export function isSessionRdb(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const appId = db.prepare('pragma application_id').get() as { application_id?: number } | undefined
      const userVersion = db.prepare('pragma user_version').get() as { user_version?: number } | undefined
      return appId?.application_id === 1146308688 && userVersion?.user_version === 1
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/**
 * Delete one session's rows from a session-rdb store. FK cascades remove the
 * event tables; returns true when a row was deleted, false when the session
 * was absent. Throws on storage errors (the caller converts to a failure).
 */
export function deleteRdbSession(dbPath: string, id: string): boolean {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('begin')
    try {
      const result = db.prepare('delete from t_sessions where f_session_id = ?').run(id)
      const removed = Number(result.changes) > 0
      db.exec('commit')
      return removed
    } catch (error) {
      try {
        db.exec('rollback')
      } catch {
        // Rollback after a hard failure is best-effort.
      }
      throw error
    }
  } finally {
    db.close()
  }
}

/**
 * Physically remove one session directory. The dir must already be resolved
 * from the index (which never follows escaping symlinks); this re-validates
 * the realpath against the sessions root before the recursive removal, so no
 * caller-supplied path can delete anything outside session storage.
 */
export function removeSessionDir(dirPath: string, sessionsRoot: string): void {
  const rootReal = realpathSync(sessionsRoot)
  const real = realpathSync(dirPath)
  if (!isInside(rootReal, real)) {
    throw new Error(`refusing to remove '${dirPath}': outside the sessions root`)
  }
  rmSync(real, { recursive: true, force: false })
}
