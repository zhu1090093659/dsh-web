/**
 * Discovery of legacy session directories plus the full import runner over
 * them. The runner is transport-free: both the CLI (`scripts/dsh-better-
 * session.mjs`) and the plugin's worker entry call `runImport` with explicit
 * roots, so tests exercise the exact production path.
 * @module better-session-manager/core/migration-run
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ForeignStoreError, insertSession, openStore, projectPersistedEvents } from './migration-core.ts'
import { parseSessionLog } from './legacy-log.ts'

export interface DiscoveredSession {
  projectKey: string
  /** On-disk segment name; the canonical id comes from the decoded header. */
  sessionId: string
  dir: string
  logPath: string
  sizeBytes: number
  encodingMismatch?: boolean
}

/** Enumerate every candidate session dir under the sessions root, sorted deterministically. */
export function discoverLegacySessions(sessionsRoot: string): DiscoveredSession[] {
  const out: DiscoveredSession[] = []
  if (!existsSync(sessionsRoot)) return out
  for (const project of readdirSync(sessionsRoot).sort()) {
    const projectDir = join(sessionsRoot, project)
    try {
      if (!statSync(projectDir).isDirectory()) continue
    } catch {
      continue
    }
    for (const entry of readdirSync(projectDir).sort()) {
      const dir = join(projectDir, entry)
      const logPath = join(dir, 'session.jsonl.zstd')
      let sizeBytes = 0
      try {
        sizeBytes = statSync(logPath).size
      } catch {
        continue
      }
      if (existsSync(join(dir, 'session.jsonl'))) {
        out.push({ projectKey: project, sessionId: entry, dir, logPath, sizeBytes, encodingMismatch: true })
        continue
      }
      out.push({ projectKey: project, sessionId: entry, dir, logPath, sizeBytes })
    }
  }
  return out
}

export interface ImportItemResult {
  sessionId: string
  projectKey: string
  status: 'imported' | 'would-import' | 'skipped-existing' | 'skipped-empty' | 'failed'
  events?: number
  dropped?: number
  torn?: boolean
  error?: string
}

export interface ImportSummary {
  totalScanned: number
  imported: number
  skippedExisting: number
  skippedEmpty: number
  failed: number
  details: ImportItemResult[]
}

export interface RunImportOptions {
  sessionsDir: string
  dbPath: string
  apply: boolean
  /** Bootstrap the sqlite file (mirrored DDL) when it does not exist yet. */
  createStore?: boolean
  includeEmpty?: boolean
  projectFilter?: string
  limit?: number
  /** Skip the decode phase entirely and report what WOULD be scanned (status fast path). */
  listOnly?: boolean
}

/**
 * Run the whole legacy-to-RDB pass. Without `apply` nothing is written and
 * every decodable item reports `would-import`.
 */
export function runImport(options: RunImportOptions): ImportSummary {
  const includeEmpty = options.includeEmpty === true
  let candidates = options.listOnly ? [] : discoverLegacySessions(options.sessionsDir)
  if (options.projectFilter !== undefined) {
    const projectFilter = options.projectFilter
    candidates = candidates.filter((s) => s.projectKey === projectFilter || s.projectKey.includes(projectFilter))
  }
  if (options.limit !== undefined && Number.isFinite(options.limit)) candidates = candidates.slice(0, Math.max(1, Math.trunc(options.limit)))

  const results: ImportItemResult[] = []
  if (!options.apply) {
    for (const session of candidates) {
      results.push(importOne(session, options, false))
    }
    return summarize(results)
  }

  const db = openStore(options.dbPath, { createStore: options.createStore === true })
  try {
    const seenIds = new Map<string, string>()
    for (const session of candidates) {
      // The existence pre-check short-circuits BEFORE the expensive decode so
      // reruns converge quickly.
      results.push(importOne(session, options, true, db, seenIds))
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
  return summarize(results)
}

function importOne(
  session: DiscoveredSession,
  options: RunImportOptions,
  applyMode: boolean,
  db?: ReturnType<typeof openStore>,
  seenIds?: Map<string, string>,
): ImportItemResult {
  const base = { sessionId: session.sessionId, projectKey: session.projectKey }
  if (session.encodingMismatch) {
    return { ...base, status: 'failed', error: 'both session.jsonl and session.jsonl.zstd present (encoding mismatch)' }
  }
  let parsed: ReturnType<typeof parseSessionLog>
  try {
    parsed = parseSessionLog(readFileSync(session.logPath))
  } catch (error) {
    return { ...base, status: 'failed', error: `decode failed: ${(error as Error).message}` }
  }
  const canonicalId = String(parsed.header.id ?? '')
  if (seenIds !== undefined) {
    const previous = seenIds.get(canonicalId)
    if (previous !== undefined && previous !== session.dir) {
      return { ...base, status: 'failed', error: `duplicate legacy session id ${canonicalId} also found at ${previous}` }
    }
    seenIds.set(canonicalId, session.dir)
  }

  const projection = projectPersistedEvents(parsed.events)
  if (projection.rows.length === 0 && !options.includeEmpty) {
    return { ...base, status: 'skipped-empty', events: 0, dropped: projection.droppedCount, torn: parsed.tornTail }
  }

  if (!applyMode || db === undefined) {
    return { ...base, status: 'would-import', events: projection.rows.length, dropped: projection.droppedCount, torn: parsed.tornTail }
  }

  try {
    const outcome = insertSession(db, parsed.header, projection)
    return { ...base, status: outcome.inserted ? 'imported' : 'skipped-existing', events: projection.rows.length, dropped: projection.droppedCount, torn: parsed.tornTail }
  } catch (error) {
    if (error instanceof ForeignStoreError) throw error
    return { ...base, status: 'failed', error: (error as Error).message }
  }
}

/** Copy the sqlite files aside before any mutating pass. Returns the backup dir or null. */
export function backupStore(dbPath: string, home = process.env.DSH_HOME || join(homedir(), '.dsh')): string | null {
  if (!existsSync(dbPath)) return null
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const backupDir = join(home, 'backups', `better-session-migrate-${stamp}`)
  mkdirSync(backupDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, join(backupDir, 'sessions.sqlite' + suffix))
  }
  return backupDir
}

function summarize(results: readonly ImportItemResult[]): ImportSummary {
  return {
    totalScanned: results.length,
    imported: results.filter((r) => r.status === 'imported').length,
    skippedExisting: results.filter((r) => r.status === 'skipped-existing').length,
    skippedEmpty: results.filter((r) => r.status === 'skipped-empty').length,
    failed: results.filter((r) => r.status === 'failed').length,
    details: results.map(({ sessionId, projectKey, status, events, dropped, torn, error }) => ({ sessionId, projectKey, status, events, dropped, torn, error })),
  }
}
