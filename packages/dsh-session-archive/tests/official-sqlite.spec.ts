import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchiveService } from '../src/host/janitor.ts'
import { createFakeHost, fakeContext } from './fixtures.ts'
import {
  OFFICIAL_SQLITE_APPLICATION_ID,
  OFFICIAL_SQLITE_SEGMENTS_DIR,
  OFFICIAL_SQLITE_USER_VERSION,
  hasOfficialSqliteMarker,
  indexSessionDirs,
  isOfficialSessionSqlite,
  officialSqliteDbPath,
  readOfficialSqliteSessionIds,
} from '../src/host/session-files.ts'

const temps: string[] = []

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-archive-sqlite-'))
  temps.push(dir)
  return dir
}

function createOfficialSqliteDb(dshHome: string, traceIds: readonly string[]): string {
  const dbPath = officialSqliteDbPath(dshHome)
  mkdirSync(join(dshHome, 'sessions', OFFICIAL_SQLITE_SEGMENTS_DIR), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      CREATE TABLE traces (trace_uuid TEXT PRIMARY KEY, header TEXT NOT NULL, tail_segment_uuid TEXT NOT NULL, inherited_count INTEGER NOT NULL);
      PRAGMA application_id = ${OFFICIAL_SQLITE_APPLICATION_ID};
      PRAGMA user_version = ${OFFICIAL_SQLITE_USER_VERSION};
    `)
    const stmt = db.prepare('INSERT INTO traces (trace_uuid, header, tail_segment_uuid, inherited_count) VALUES (?, ?, ?, ?)')
    for (const id of traceIds) {
      stmt.run(id, '{}', `seg-${id}`, 0)
    }
  } finally {
    db.close()
  }
  return dbPath
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('official SQLite session persistence compatibility', () => {
  it('operator scanning session directories skips the official .segments storage directory', () => {
    // Given a sessions root holding both a legacy session dir and an official .segments dir with nested folders
    const home = makeHome()
    const legacyDir = join(home, 'sessions', 'proj-a', 'legacy-1')
    const segmentsNested = join(home, 'sessions', '.segments', 'nested-lock')
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(segmentsNested, { recursive: true })
    writeFileSync(join(legacyDir, 'events.jsonl'), '{}\n')
    // When the sessions root is indexed
    const index = indexSessionDirs(join(home, 'sessions'))
    // Then only the legacy session is indexed and .segments is ignored
    expect([...index.byId.keys()]).toEqual(['session-legacy-1'])
  })

  it('operator inspecting official SQLite persistence reads trace ids and routing markers accurately', () => {
    // Given an official SQLite database with one trace and a routing marker for another session
    const home = makeHome()
    const dbPath = createOfficialSqliteDb(home, ['sql-1'])
    const markerHash = createHash('sha256').update('session-marker-2').digest('hex')
    writeFileSync(join(home, 'sessions', '.segments', `${markerHash}.json`), JSON.stringify({ id: 'session-marker-2', database: dbPath }))
    // When the official SQLite fingerprint, trace index, and marker lookup run
    const recognized = isOfficialSessionSqlite(dbPath)
    const ids = readOfficialSqliteSessionIds(dbPath)
    const marked = hasOfficialSqliteMarker(home, 'session-marker-2')
    const unmarked = hasOfficialSqliteMarker(home, 'session-other')
    // Then the database and marker are both recognized cleanly
    expect(recognized).toBe(true)
    expect([...ids]).toEqual(['session-sql-1'])
    expect(marked).toBe(true)
    expect(unmarked).toBe(false)
  })

  it('user physically deleting a mixed batch protects official SQLite sessions while still deleting legacy JSONL sessions', async () => {
    // Given one official SQLite session (with an artifact-lock dir) and one legacy JSONL session
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-sql-1', updatedAt: 1000, running: false, blank: false },
        { sessionId: 'session-legacy-2', updatedAt: 2000, running: false, blank: false },
      ],
      workspaces: [{ id: 'ws-1', path: '/repo', title: 'Repo', sessionIds: ['session-sql-1', 'session-legacy-2'] }],
      archivedSessionIds: ['session-sql-1', 'session-legacy-2'],
    })
    temps.push(host.home)
    createOfficialSqliteDb(host.home, ['session-sql-1'])
    const sqlLockDir = join(host.home, 'sessions', 'proj-a', 'sql-1')
    const legacyDir = join(host.home, 'sessions', 'proj-a', 'legacy-2')
    mkdirSync(sqlLockDir, { recursive: true })
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(sqlLockDir, 'lock.json'), '{"pid":1}')
    writeFileSync(join(legacyDir, 'events.jsonl'), '{"type":"session/start"}\n')

    const service = new ArchiveService(fakeContext(host) as never, { dshHome: host.home })
    await service.start()
    try {
      // When the user requests physical deletion of both sessions
      const response = await service.deleteSessions(['session-sql-1', 'session-legacy-2'])
      // Then the official SQLite session fails safely with missing-seam and keeps its archive flag, workspace link, and lock dir
      const sqlResult = response.results.find((entry) => entry.id === 'session-sql-1')
      const legacyResult = response.results.find((entry) => entry.id === 'session-legacy-2')
      expect(sqlResult).toMatchObject({ id: 'session-sql-1', status: 'failed', reason: 'missing-seam' })
      expect(sqlResult?.detail).toContain('.segments/sessions.sqlite')
      expect(existsSync(sqlLockDir)).toBe(true)
      expect(host.registry.archivedSessionIds).toContain('session-sql-1')
      expect(host.registry.workspaces[0]?.sessionIds).toContain('session-sql-1')
      // And the legacy JSONL session is deleted normally
      expect(legacyResult).toMatchObject({ id: 'session-legacy-2', status: 'ok' })
      expect(existsSync(legacyDir)).toBe(false)
      expect(host.registry.archivedSessionIds).not.toContain('session-legacy-2')
      expect(host.registry.workspaces[0]?.sessionIds).not.toContain('session-legacy-2')
    } finally {
      service.stop()
    }
  })
})
