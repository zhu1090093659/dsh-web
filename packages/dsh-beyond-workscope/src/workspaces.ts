/**
 * Workspace ledger — the "second workspace" surface of the plugin.
 *
 * A workspace registration turns a user-confirmed directory into a durable
 * host workspace (`ctx.workspaceRegistry`): it appears in the GUI workspace
 * switcher, and any new conversation created there runs with that directory
 * as its sandbox workspace root — full tool coverage with NO full-access
 * grant. This is the plugin's core purpose: an extra workspace beyond the
 * session's own, without widening the global sandbox mode.
 *
 * Semantics (deliberately different from grants):
 *  - grants  = temporary borrowing: per-session, auto-revoked on session end.
 *  - workspaces = persistent: they survive the registering session and are
 *    removed only by an explicit `workscope_unworkspace` (or the UI remove
 *    button). The ledger keeps an audit-facing per-session record of which
 *    session registered each workspace.
 *
 * The ledger itself is pure (no service calls) for unit testing; the
 * side-effectful helpers (`registerWorkspace` / `removeWorkspaces`) take the
 * host `WorkspaceRegistry` as a parameter.
 */

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { GrantError, canonicalPath } from './grants.ts'
import type { WorkspaceView } from './protocol.ts'

/** One plugin-managed workspace registration. */
export interface WorkspaceRecord {
  /** Ledger record id (uuid). */
  readonly id: string
  /** Durable workspace id in the host workspace registry. */
  readonly workspaceId: string
  /** Canonical directory path. */
  readonly path: string
  readonly title: string
  /** Session that registered it. */
  readonly sessionId: string
  /** ISO-8601 registration instant. */
  readonly createdAt: string
  readonly status: 'active' | 'removed'
}

/** Ledger options. */
export interface WorkspaceLedgerOptions {
  /** Max registrations per session (defends against registry spam). */
  readonly maxPerSession: number
}

const DEFAULT_OPTIONS: WorkspaceLedgerOptions = { maxPerSession: 8 }

/** Per-session workspace records with validation. */
export class WorkspaceLedger {
  private readonly records = new Map<string, WorkspaceRecord>()
  private readonly options: WorkspaceLedgerOptions

  constructor(options: Partial<WorkspaceLedgerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Active records of one session (or all sessions when omitted). */
  list(sessionId?: string): WorkspaceRecord[] {
    const all = [...this.records.values()].filter(r => r.status === 'active')
    return sessionId === undefined ? all : all.filter(r => r.sessionId === sessionId)
  }

  /** Canonicalize a registration target and enforce per-session caps. */
  async prepareRegistration(sessionId: string, raw: string): Promise<string> {
    const canonical = await canonicalPath(raw)
    if (this.list(sessionId).some(r => r.path === canonical)) {
      throw new GrantError(`该目录已经是本会话注册的工作区：${canonical}`)
    }
    if (this.list(sessionId).length >= this.options.maxPerSession) {
      throw new GrantError(`本会话注册的工作区已达上限（${this.options.maxPerSession}），请先移除部分工作区`)
    }
    return canonical
  }

  /** Record a successful registration (after the host registry accepted it). */
  register(sessionId: string, path: string, workspaceId: string, title?: string): WorkspaceRecord {
    const record: WorkspaceRecord = {
      id: randomUUID(),
      workspaceId,
      path,
      title: title === undefined || title.trim() === '' ? basename(path) : title.trim(),
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'active',
    }
    this.records.set(record.id, record)
    return record
  }

  /** Find active records by ledger id, workspace id, or canonical path. */
  find(target: string): WorkspaceRecord[] {
    const normalized = target.trim()
    return this.list().filter(r => r.id === normalized || r.workspaceId === normalized || r.path === normalized)
  }

  /** Mark records removed (idempotent). */
  remove(records: WorkspaceRecord[]): WorkspaceRecord[] {
    const removed: WorkspaceRecord[] = []
    for (const record of records) {
      if (record.status !== 'active') continue
      this.records.set(record.id, { ...record, status: 'removed' })
      removed.push({ ...record, status: 'removed' })
    }
    return removed
  }
}

/** Result of a side-effectful workspace operation. */
export type WorkspaceActionResult =
  | { ok: true; record: WorkspaceRecord; alreadyExisted?: boolean }
  | { ok: false; error: string }

/** Host workspace-registry seam (keeps helpers testable without the service). */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<{ id: string }>
  delete(id: string): Promise<boolean>
  /** Look up a workspace by canonical path (used by the removal fallback). */
  resolveByPath?(path: string): Promise<{ id: string; path: string; title: string } | undefined>
}

/**
 * Register a directory as a durable host workspace. Idempotent: when the
 * host registry already owns the path, the existing workspace id is reused
 * (the create() contract returns the existing record for a known path).
 */
export async function registerWorkspace(
  ledger: WorkspaceLedger,
  registry: WorkspaceRegistryLike,
  sessionId: string,
  rawPath: string,
  title?: string,
): Promise<WorkspaceActionResult> {
  try {
    const canonical = await ledger.prepareRegistration(sessionId, rawPath)
    const workspace = await registry.create(canonical, title)
    const record = ledger.register(sessionId, canonical, workspace.id, title)
    return { ok: true, record }
  } catch (error) {
    const message = error instanceof GrantError ? error.message : error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * Remove plugin-managed workspace registrations by ledger id, host workspace
 * id, or path. Non-destructive: the directory and every session log created
 * there stay untouched (the host delete() contract).
 *
 * Ledger misses fall back to the durable host registry: after a plugin
 * restart the in-memory ledger is empty, but the registrations it created
 * survive — a path resolves through `resolveByPath`, a bare id deletes
 * directly (idempotent no-op when unknown). Fallback records carry an empty
 * sessionId (ownership unknown after restart); callers skip auditing them.
 */
export async function removeWorkspaces(
  ledger: WorkspaceLedger,
  registry: WorkspaceRegistryLike,
  target: string,
): Promise<WorkspaceRecord[]> {
  const records = ledger.find(target)
  if (records.length > 0) {
    for (const record of records) {
      try {
        await registry.delete(record.workspaceId)
      } catch {
        // Host record already gone — still drop the ledger row below.
      }
    }
    return ledger.remove(records)
  }

  // Ledger miss: reconcile against the durable host registry.
  const trimmed = target.trim()
  const isPath = trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)
  if (isPath) {
    const existing = await registry.resolveByPath?.(trimmed)
    if (existing !== undefined) {
      await registry.delete(existing.id)
      return [{
        id: existing.id,
        workspaceId: existing.id,
        path: existing.path,
        title: existing.title,
        sessionId: '',
        createdAt: '',
        status: 'removed',
      }]
    }
    return []
  }
  // Bare id: direct host delete (idempotent no-op when unknown).
  const deleted = await registry.delete(trimmed)
  if (deleted) {
    return [{ id: trimmed, workspaceId: trimmed, path: '', title: trimmed, sessionId: '', createdAt: '', status: 'removed' }]
  }
  return []
}

/** Workspace records shaped for the wire. */
export function toWorkspaceViews(records: readonly WorkspaceRecord[]): WorkspaceView[] {
  return records.map(r => ({
    id: r.id,
    workspaceId: r.workspaceId,
    path: r.path,
    title: r.title,
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    status: r.status,
  }))
}
