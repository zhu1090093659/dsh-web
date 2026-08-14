/**
 * Operation ledger — reversible beyond-workspace operations.
 *
 * Every mutating tool call (write / move / copy / delete) records one
 * operation and, where needed, keeps a rollback artifact in the plugin's
 * private rollback area (`~/.dsh/dsh-beyond-workscope/rollback/<session>/<op>`).
 * `workscope_ops` lists the session's operations; `workscope_rollback`
 * reverses one:
 *   - write   : original file content snapshotted; rollback restores it
 *               (or removes the file when it was newly created);
 *   - delete  : the file/dir is MOVED into the rollback area (not destroyed);
 *               rollback moves it back to its original path;
 *   - move    : src/dest recorded; rollback moves back;
 *   - copy    : nothing snapshotted; rollback removes the copied target.
 *
 * Lifecycle: the ledger and the rollback area are session-scoped — released
 * (and the area deleted) when the session ends, same as grants and
 * sub-workspaces. Rollback only ever restores into paths the session still
 * holds (sub-workspace or grant), so a revoked session cannot resurrect
 * access through the back door.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { invariant } from './invariant.ts'
import type { OpView } from './protocol.ts'

/** What kind of operation a record describes. */
export type OpKind = 'write' | 'move' | 'copy' | 'delete'

/** One reversible operation. */
export interface OpRecord {
  /** Opaque operation id (also the rollback artifact directory name). */
  readonly id: string
  /** Owning session (operations never cross sessions). */
  readonly sessionId: string
  readonly kind: OpKind
  /** Primary path (write/delete target; move/copy source). */
  readonly path: string
  /** move/copy destination. */
  readonly dest?: string
  /** Bytes involved (file size; 0 when unknown). */
  readonly size: number
  /** ISO-8601 instant. */
  readonly createdAt: string
  readonly status: 'done' | 'rolled-back'
}

/** Ledger options. */
export interface OperationLedgerOptions {
  /** Max recorded operations per session (memory-bounded). */
  readonly maxPerSession: number
}

const DEFAULT_OPTIONS: OperationLedgerOptions = { maxPerSession: 100 }

/** The plugin's private rollback root under DSH_HOME. */
export function rollbackRoot(): string {
  return join(process.env.DSH_HOME ?? `${process.env.HOME ?? ''}/.dsh`, 'dsh-beyond-workscope', 'rollback')
}

/** Per-session in-memory operation records plus rollback-area management. */
export class OperationLedger {
  private readonly records = new Map<string, OpRecord>()
  private readonly options: OperationLedgerOptions

  constructor(options: Partial<OperationLedgerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Recorded operations of one session (newest first). */
  list(sessionId: string): OpRecord[] {
    return [...this.records.values()]
      .filter(r => r.sessionId === sessionId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  /** One operation by id (any session). */
  get(id: string): OpRecord | undefined {
    return this.records.get(id)
  }

  /** Rollback area of one operation. */
  opRollbackDir(sessionId: string, opId: string): string {
    return join(rollbackRoot(), sessionId, opId)
  }

  /**
   * Record a new operation. The caller performs the fs work; the ledger only
   * tracks metadata. Newest-first cap drops the oldest record (its rollback
   * area is removed so the disk cannot grow unbounded).
   */
  record(sessionId: string, kind: OpKind, path: string, dest: string | undefined, size: number): OpRecord {
    const record: OpRecord = {
      id: randomUUID(),
      sessionId,
      kind,
      path,
      ...(dest === undefined ? {} : { dest }),
      size,
      createdAt: new Date().toISOString(),
      status: 'done',
    }
    this.records.set(record.id, record)
    const sessionRecords = this.list(sessionId)
    if (sessionRecords.length > this.options.maxPerSession) {
      const dropped = sessionRecords[this.options.maxPerSession - 1]
      if (dropped !== undefined) {
        this.records.delete(dropped.id)
        void rm(this.opRollbackDir(sessionId, dropped.id), { recursive: true, force: true }).catch(() => undefined)
      }
    }
    return record
  }

  /** Mark an operation rolled back. */
  markRolledBack(id: string): void {
    const record = this.records.get(id)
    if (record === undefined) return
    this.records.set(id, { ...record, status: 'rolled-back' })
  }

  /** Release a session: drop records and delete its rollback area. */
  async releaseSession(sessionId: string): Promise<void> {
    for (const record of this.list(sessionId)) this.records.delete(record.id)
    await rm(join(rollbackRoot(), sessionId), { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Views shaped for the wire. */
export function toOpViews(records: readonly OpRecord[]): OpView[] {
  return records.map(r => ({
    id: r.id,
    kind: r.kind,
    path: r.path,
    ...(r.dest === undefined ? {} : { dest: r.dest }),
    size: r.size,
    createdAt: r.createdAt,
    status: r.status,
  }))
}

/** Result of one rollback attempt. */
export type RollbackResult =
  | { ok: true; detail: string }
  | { ok: false; error: string }

/** Human-readable rollback failure (safe to show). */
export class OpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpError'
  }
}

/** Path-boundary check the rollback caller supplies (sub-workspace or grant). */
export type PathAllowed = (path: string) => Promise<boolean>

/**
 * Reverse one operation. `allowed` gates every restored path so a revoked
 * session cannot resurrect access; the ledger and the rollback area are
 * updated on success.
 */
export async function rollbackOp(
  ledger: OperationLedger,
  record: OpRecord,
  allowed: PathAllowed,
): Promise<RollbackResult> {
  // Trust the ledger's latest state over the caller-supplied record (a stale
  // reference may still read 'done' after a previous rollback).
  const latest = ledger.get(record.id) ?? record
  if (latest.status === 'rolled-back') return { ok: false, error: '该操作已回滚过' }
  try {
    const area = ledger.opRollbackDir(record.sessionId, record.id)
    if (record.kind === 'write') {
      // Restore the snapshot, or remove the file when it was newly created.
      if (!(await allowed(record.path))) throw new OpError(`目标路径已不在本会话授权范围内：${record.path}`)
      const snapshot = join(area, 'original')
      if (await exists(snapshot)) {
        await mkdir(dirname(record.path), { recursive: true })
        await copyFile(snapshot, record.path)
      } else {
        await rm(record.path, { force: true })
      }
    } else if (record.kind === 'delete') {
      // Move the artifact back to its original path.
      if (!(await allowed(record.path))) throw new OpError(`目标路径已不在本会话授权范围内：${record.path}`)
      const artifact = join(area, 'artifact')
      if (!(await exists(artifact))) throw new OpError('回滚工件缺失，无法恢复')
      await mkdir(dirname(record.path), { recursive: true })
      await rename(artifact, record.path)
    } else if (record.kind === 'move') {
      // Reverse move (dest → src).
      if (record.dest === undefined) throw new OpError('移动记录缺少目标路径')
      if (!(await allowed(record.path))) throw new OpError(`目标路径已不在本会话授权范围内：${record.path}`)
      if (!(await exists(record.dest))) throw new OpError(`移动目标已不存在：${record.dest}`)
      await mkdir(dirname(record.path), { recursive: true })
      await rename(record.dest, record.path)
    } else if (record.kind === 'copy') {
      // Remove the copied target.
      if (record.dest === undefined) throw new OpError('复制记录缺少目标路径')
      if (!(await allowed(dirname(record.dest)))) throw new OpError(`目标目录已不在本会话授权范围内：${record.dest}`)
      await rm(record.dest, { recursive: true, force: true })
    } else {
      throw new OpError(`未知操作类型：${record.kind}`)
    }
    ledger.markRolledBack(record.id)
    await rm(area, { recursive: true, force: true }).catch(() => undefined)
    return { ok: true, detail: `${record.kind} 已回滚：${record.path}${record.dest === undefined ? '' : ` -> ${record.dest}`}` }
  } catch (error) {
    const message = error instanceof OpError ? error.message : error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/** Whether a path exists (file or dir). */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Prepare the rollback area of a delete: move `path` into the area (same
 * filesystem rename — cheap and reversible), returning the area path.
 * `path` must exist; a name collision inside the area gets a numeric suffix.
 */
export async function stashForDelete(sessionId: string, opId: string, path: string): Promise<string> {
  const area = join(rollbackRoot(), sessionId, opId)
  await mkdir(area, { recursive: true })
  const base = basename(path)
  let target = join(area, 'artifact')
  if (await exists(target)) {
    let n = 1
    while (await exists(join(area, `artifact.${n}`))) n += 1
    target = join(area, `artifact.${n}`)
  }
  await rename(path, target)
  invariant(!(await exists(path)), 'delete stash must remove the source')
  return target
}

/**
 * Snapshot a file's current content into the rollback area (write rollback).
 * When the file does not exist (newly created), no snapshot is written and
 * rollback removes it instead.
 */
export async function snapshotForWrite(sessionId: string, opId: string, path: string): Promise<boolean> {
  if (!(await exists(path))) return false
  const area = join(rollbackRoot(), sessionId, opId)
  await mkdir(area, { recursive: true })
  await copyFile(path, join(area, 'original'))
  return true
}

/** Read a file's content for snapshotting via a stream-safe copy. */
