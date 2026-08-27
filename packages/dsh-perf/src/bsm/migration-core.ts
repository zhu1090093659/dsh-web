/**
 * Projection + SQLite insertion for the legacy-to-RDB session import.
 * Byte-faithful port of the semantics of @morlay/session-rdb@0.0.11:
 * drop `assistant/chunk` / `ignorable` / packed rows, keep upstream seqs as
 * `f_original_seq`, prune surface provenance against dropped seqs, chain event
 * ids via `f_parent_id`, number bridges densely from 0 and maintain the head
 * cursor. Direct-SQL insert is safe here — the target schema has no triggers,
 * computed or checksum columns.
 * @module better-session-manager/core/migration-core
 */
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { PACKED_ROW_TAGS, type RawStorageRow, type SessionHeader } from './legacy-log.ts'

/** Event types whose CONTENT is not persisted (rdb `EPHEMERAL_EVENT_TYPES`). */
export const EPHEMERAL_EVENT_TYPES = ['assistant/chunk'] as const

/**
 * Identity constants mirroring @morlay/session-rdb@0.0.11; used to bootstrap a
 * compatible empty database and to fingerprint-check an existing one so this
 * tool never mutates foreign sqlite files.
 */
export const SQLITE_APPLICATION_ID = 1146308688
export const SCHEMA_VERSION = 1

/**
 * Whether a decoded event gets a persisted row. Keeps the exact predicate of
 * the rdb backend's `isPersistedEvent` plus the packed-row tags the rdb layer
 * never receives (they expand into delta events before reaching it).
 */
export function isPersistedEvent(event: RawStorageRow): boolean {
  const type = event.type ?? ''
  return !(PACKED_ROW_TAGS as readonly string[]).includes(type)
    && !(EPHEMERAL_EVENT_TYPES as readonly string[]).includes(type)
    && event.ignorable !== true
}

/**
 * Playpen dimensions for `t_events.f_role/f_name/f_action_id`. Verbatim port
 * of the rdb backend's `eventDimensions` (unknown plugin-merged types keep
 * playpen defaults).
 */
export function eventDimensions(event: RawStorageRow): { role: string; name: string; actionId: string } {
  switch (event.type) {
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'session/end-seed':
      return { role: 'turn', name: '', actionId: '' }
    case 'user/message':
    case 'request/header':
    case 'request/context':
      return { role: 'user', name: '', actionId: '' }
    case 'assistant/message':
      return { role: 'model', name: '', actionId: '' }
    case 'tool/call': {
      const data = (event.data ?? {}) as { name?: unknown; callId?: unknown }
      return { role: 'function', name: String(data.name ?? ''), actionId: String(data.callId ?? '') }
    }
    case 'tool/result': {
      const data = (event.data ?? {}) as { message?: { content?: Array<{ toolCallId?: unknown }> } }
      return { role: 'function', name: '', actionId: String(data.message?.content?.[0]?.toolCallId ?? '') }
    }
    case 'todo/write':
      return { role: 'state', name: 'todos', actionId: '' }
    default:
      return { role: '', name: '', actionId: '' }
  }
}

/** One ready-to-bind persisted row (`t_events` payload without the bridge). */
export interface ProjectedEvent {
  eventId: string
  kind: string
  data: string
  createdAt: number
  originalSeq: number
  sourceEventSeqs: string | null
  surfaceOp: string | null
  role: string
  name: string
  actionId: string
}

export interface ProjectionResult {
  rows: ProjectedEvent[]
  droppedSeqs: number[]
  droppedCount: number
  rawCount: number
}

/**
 * Reduce one session's decoded events to persisted rows: drops ephemeral /
 * ignorable / packed rows, prunes surface provenance referencing dropped seqs
 * (fully-pruned lists store NULL, like the rdb write path), and prepares the
 * parent-chain values. Bridge sequences are assigned densely from 0 in log
 * order — an importer always writes complete logs from a fresh head at -1.
 */
export function projectPersistedEvents(events: readonly RawStorageRow[]): ProjectionResult {
  const droppedSeqs: number[] = []
  for (const event of events) {
    if (!isPersistedEvent(event)) droppedSeqs.push(Number(event.seq ?? event.seq0))
  }
  const dropped = new Set(droppedSeqs)
  const rows: ProjectedEvent[] = []
  for (const event of events) {
    if (!isPersistedEvent(event)) continue
    const refs = Array.isArray(event.sourceEventSeqs)
      ? (event.sourceEventSeqs as unknown[]).filter((seq) => !dropped.has(Number(seq))).map(String)
      : undefined
    const dims = eventDimensions(event)
    rows.push({
      eventId: randomUUID(),
      kind: String(event.type),
      data: JSON.stringify(event.data ?? {}),
      createdAt: Number(event.time ?? 0),
      originalSeq: Number(event.seq),
      sourceEventSeqs: refs !== undefined && refs.length > 0 ? JSON.stringify(refs.map(Number)) : null,
      surfaceOp: event.surfaceOp !== undefined ? JSON.stringify(event.surfaceOp) : null,
      role: dims.role,
      name: dims.name,
      actionId: dims.actionId,
    })
  }
  return { rows, droppedSeqs, droppedCount: dropped.size, rawCount: events.length }
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS "t_persistence_state" (
\t"f_singleton"\tINTEGER PRIMARY KEY CHECK("f_singleton" = 1),
\t"f_store_id"\tTEXT NOT NULL
) STRICT`,
  `CREATE TABLE IF NOT EXISTS "t_sessions" (
\t"f_id"\tINTEGER PRIMARY KEY AUTOINCREMENT,
\t"f_session_id"\tTEXT NOT NULL UNIQUE,
\t"f_head_event_id"\tTEXT NOT NULL DEFAULT '',
\t"f_head_sequence"\tINTEGER NOT NULL DEFAULT -1,
\t"f_version"\tINTEGER NOT NULL,
\t"f_created_at"\tINTEGER NOT NULL,
\t"f_cwd"\tTEXT,
\t"f_parent_session"\tTEXT,
\t"f_seed_length"\tINTEGER,
\t"f_origin"\tTEXT,
\t"f_delegation_depth"\tINTEGER,
\t"f_incarnation"\tTEXT NOT NULL,
\t"f_revision"\tINTEGER NOT NULL
) STRICT`,
  `CREATE TABLE IF NOT EXISTS "t_events" (
\t"f_id"\tINTEGER PRIMARY KEY AUTOINCREMENT,
\t"f_event_id"\tTEXT NOT NULL UNIQUE,
\t"f_parent_id"\tTEXT NOT NULL DEFAULT '',
\t"f_kind"\tTEXT NOT NULL DEFAULT '',
\t"f_role"\tTEXT NOT NULL DEFAULT '',
\t"f_name"\tTEXT NOT NULL DEFAULT '',
\t"f_action_id"\tTEXT NOT NULL DEFAULT '',
\t"f_encoding"\tTEXT NOT NULL DEFAULT '',
\t"f_data"\tTEXT NOT NULL,
\t"f_created_at"\tINTEGER NOT NULL DEFAULT 0,
\t"f_original_seq"\tINTEGER NOT NULL,
\t"f_source_event_seqs"\tTEXT,
\t"f_surface_op"\tTEXT
) STRICT`,
  `CREATE TABLE IF NOT EXISTS "t_session_events" (
\t"f_id"\tINTEGER PRIMARY KEY AUTOINCREMENT,
\t"f_session_id"\tTEXT NOT NULL REFERENCES "t_sessions"("f_session_id") ON DELETE CASCADE,
\t"f_event_id"\tTEXT NOT NULL REFERENCES "t_events"("f_event_id") ON DELETE CASCADE,
\t"f_sequence"\tINTEGER NOT NULL,
\tUNIQUE("f_session_id", "f_sequence")
) STRICT`,
]

export class ForeignStoreError extends Error {}

/**
 * Open the RDB store. Existing stores are fingerprint-checked against the
 * mirrored identity constants; a missing file can only be opened with
 * `createStore` set, which bootstraps the DDL above byte-compatible with the
 * backend's own entity definitions.
 */
export function openStore(dbPath: string, { createStore = false }: { createStore?: boolean } = {}): DatabaseSync {
  const existed = existsSync(dbPath)
  if (!existed && !createStore) throw new ForeignStoreError(`${dbPath} does not exist yet`)
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  if (!existed) {
    db.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    for (const ddl of DDL) db.exec(ddl)
    db.prepare('INSERT INTO t_persistence_state (f_singleton, f_store_id) VALUES (1, ?) ON CONFLICT DO NOTHING').run(randomUUID())
  }
  const applicationId = db.prepare('PRAGMA application_id').get() as { [key: string]: unknown } | undefined
  const userVersion = db.prepare('PRAGMA user_version').get() as { [key: string]: unknown } | undefined
  const appIdValue = Number(applicationId !== undefined ? Object.values(applicationId)[0] : NaN)
  const versionValue = Number(userVersion !== undefined ? Object.values(userVersion)[0] : NaN)
  if (appIdValue !== SQLITE_APPLICATION_ID || versionValue !== SCHEMA_VERSION) {
    db.close()
    throw new ForeignStoreError(`not a session-rdb store (application_id=${appIdValue}, user_version=${versionValue})`)
  }
  return db
}

export interface InsertOutcome {
  inserted: boolean
}

/**
 * Insert one projected session transactionally; the session id anchor makes
 * reruns no-ops.
 */
export function insertSession(db: DatabaseSync, header: SessionHeader, projection: ProjectionResult): InsertOutcome {
  const sessionId = String(header.id ?? '')
  if (sessionId === '') throw new Error('session header carries no id')
  if (db.prepare('SELECT 1 FROM t_sessions WHERE f_session_id = ?').get(sessionId)) {
    return { inserted: false }
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO t_sessions
        (f_session_id, f_version, f_created_at, f_cwd, f_parent_session, f_seed_length, f_origin, f_delegation_depth, f_incarnation, f_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
      sessionId,
      0, // stored f_version mirrors SESSION_FORMAT_VERSION (the only format the rdb backend accepts)
      Number(header.createdAt ?? 0),
      header.cwd != null ? String(header.cwd) : null,
      header.parentSession != null ? String(header.parentSession) : null,
      header.seedLength != null ? Number(header.seedLength) : null,
      header.origin != null ? String(header.origin) : null,
      header.delegationDepth != null ? Number(header.delegationDepth) : null,
      randomUUID(),
    )
    let parentId = ''
    let sequence = 0
    for (const row of projection.rows) {
      db.prepare(`INSERT INTO t_events
          (f_event_id, f_parent_id, f_kind, f_role, f_name, f_action_id, f_encoding, f_data, f_created_at, f_original_seq, f_source_event_seqs, f_surface_op)
          VALUES (?, ?, ?, ?, ?, ?, 'json', ?, ?, ?, ?, ?)`).run(
        row.eventId, parentId, row.kind, row.role, row.name, row.actionId, row.data, row.createdAt, row.originalSeq, row.sourceEventSeqs, row.surfaceOp,
      )
      db.prepare('INSERT INTO t_session_events (f_session_id, f_event_id, f_sequence) VALUES (?, ?, ?)').run(sessionId, row.eventId, sequence)
      parentId = row.eventId
      sequence++
    }
    if (projection.rows.length > 0) {
      db.prepare('UPDATE t_sessions SET f_head_event_id = ?, f_head_sequence = ?, f_revision = f_revision + 1 WHERE f_session_id = ?').run(
        parentId, sequence - 1, sessionId,
      )
    }
    db.exec('COMMIT')
    return { inserted: true }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
