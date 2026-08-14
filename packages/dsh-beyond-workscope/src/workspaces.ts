/**
 * Sub-workspace ledger — the "second workspace" surface of the plugin.
 *
 * A sub-workspace is a SESSION-SCOPED directory registration: the user
 * confirms it (same card pipeline as grants), and while it lives, the
 * session's workscope_read / workscope_write are automatically allowed
 * inside it — a second workspace beyond the session's own, WITHOUT widening
 * the global sandbox mode and WITHOUT any host workspace registration (it
 * never appears in the GUI sidebar's workspace list, and no new session is
 * created for it).
 *
 * Semantics:
 *  - lifetime = the registering session: released automatically on session
 *    end (same as grants) — a sub-workspace belongs to its session;
 *  - management lives in the GUI's per-session "会话信息" view tab
 *    (conversation.view id `session-info`), not in the sidebar;
 *  - the ledger is pure (no service calls) for unit testing; routes and
 *    tools drive it directly.
 */

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { GrantError, canonicalPath, isPathInside } from './grants.ts'
import type { WorkspaceView } from './protocol.ts'

/** One session-scoped sub-workspace registration. */
export interface WorkspaceRecord {
  /** Ledger record id (uuid). */
  readonly id: string
  /** Canonical directory path. */
  readonly path: string
  readonly title: string
  /** Owning session (sub-workspaces never cross sessions). */
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

/** Per-session sub-workspace records with validation. */
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
      throw new GrantError(`该目录已经是本会话的子工作区：${canonical}`)
    }
    if (this.list(sessionId).length >= this.options.maxPerSession) {
      throw new GrantError(`本会话的子工作区已达上限（${this.options.maxPerSession}），请先移除部分子工作区`)
    }
    return canonical
  }

  /**
   * Record a confirmed registration. Idempotent for the same session+path:
   * a repeated approval returns the existing record instead of duplicating.
   */
  register(sessionId: string, path: string, title?: string): WorkspaceRecord {
    const existing = this.list(sessionId).find(r => r.path === path)
    if (existing !== undefined) return existing
    const record: WorkspaceRecord = {
      id: randomUUID(),
      path,
      title: title === undefined || title.trim() === '' ? basename(path) : title.trim(),
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'active',
    }
    this.records.set(record.id, record)
    return record
  }

  /** Find active records by ledger id or canonical path. */
  find(target: string): WorkspaceRecord[] {
    const normalized = target.trim()
    return this.list().filter(r => r.id === normalized || r.path === normalized)
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

  /** Remove registrations by ledger id or path. */
  removeByTarget(target: string): WorkspaceRecord[] {
    return this.remove(this.find(target))
  }

  /**
   * Whether `path` is inside an active sub-workspace of `sessionId` — the
   * automatic read/write allowance that makes a sub-workspace a real second
   * workspace (no per-file grants needed).
   */
  covers(sessionId: string, path: string): boolean {
    return this.list(sessionId).some(record => isPathInside(record.path, path))
  }

  /** Release everything a session owns (auto-cleanup on session end). */
  releaseSession(sessionId: string): void {
    this.remove(this.list(sessionId))
  }
}

/** Remove a registration (non-destructive: the directory stays untouched). */
export function removeWorkspaces(ledger: WorkspaceLedger, target: string): WorkspaceRecord[] {
  return ledger.removeByTarget(target)
}

/** Workspace records shaped for the wire. */
export function toWorkspaceViews(records: readonly WorkspaceRecord[]): WorkspaceView[] {
  return records.map(r => ({
    id: r.id,
    path: r.path,
    title: r.title,
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    status: r.status,
  }))
}
