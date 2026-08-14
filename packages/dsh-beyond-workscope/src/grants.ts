/**
 * Grant registry — the permission surface of the plugin.
 *
 * A grant is a per-session, user-confirmed, revocable permission to operate
 * inside one directory beyond the session's workspace. The flow:
 *
 *   agent: workscope_grant {path, scope, reason}
 *     → registry.createPending() → the tool awaits the outcome
 *     → the GUI (or timeout) decides: approve → active / deny | expire
 *   agent: workscope_read / workscope_write → registry.isAllowed() gates every call
 *   agent: workscope_revoke | session end | user UI revoke → active → revoked
 *
 * The registry is deliberately a self-contained boundary: it only guards the
 * plugin's own tools (the DSH sandbox keeps guarding everything else), and it
 * fails closed — no pending entry, no decision, no expiry → no access.
 */

import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { invariant } from './invariant.ts'
import type { AuditEntry, GrantScope, GrantStatus, PendingGrantView, WorkscopeGrant } from './protocol.ts'
/** Human-readable grant failure (message is safe to show to the model/user). */
export class GrantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GrantError'
  }
}

/** Writable view of a grant for internal lifecycle mutations. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type GrantRecord = Mutable<WorkscopeGrant>

/** One pending grant awaiting a user decision. */
interface PendingEntry {
  readonly grant: GrantRecord
  /** Resolves the awaiting tool with the final status. */
  readonly settle: (status: 'active' | 'denied' | 'expired') => void
  /** Deadline timer (cleared on settle). */
  timer: NodeJS.Timeout
}

/** Outcome of a settled grant, returned to the awaiting tool. */
export interface GrantOutcome {
  readonly grantId: string
  readonly path: string
  readonly scope: GrantScope
  readonly status: 'active' | 'denied' | 'expired'
  readonly message: string
}

/** Registry options. */
export interface GrantRegistryOptions {
  /** How long a pending grant waits for the user before expiring. */
  readonly confirmTimeoutMs: number
  /** Max concurrent active grants per session (defends against grant spam). */
  readonly maxActivePerSession: number
  /** Max concurrent pending grants per session. */
  readonly maxPendingPerSession: number
  /** Audit history cap (memory-bounded). */
  readonly auditCap: number
}

const DEFAULT_OPTIONS: GrantRegistryOptions = {
  confirmTimeoutMs: 120_000,
  maxActivePerSession: 8,
  maxPendingPerSession: 3,
  auditCap: 200,
}

/** Canonicalize a path or throw a human-readable GrantError. */
export async function canonicalPath(raw: string): Promise<string> {
  if (typeof raw !== 'string' || raw.trim() === '') throw new GrantError('路径不能为空')
  let resolved: string
  try {
    resolved = await realpath(raw)
  } catch {
    throw new GrantError(`路径不存在或不可访问：${raw}`)
  }
  if (resolved === sep || /^[A-Za-z]:[\\/]?$/.test(resolved)) {
    throw new GrantError('不能授权整个文件系统根目录')
  }
  return resolved
}

/** Whether `candidate` is inside `root` (path-boundary aware, both canonical). */
export function isPathInside(root: string, candidate: string): boolean {
  if (candidate === root) return true
  return candidate.startsWith(root + sep)
}

/**
 * Canonicalize a path that may not exist yet (a write target): existing
 * entries resolve through realpath; missing entries walk up to the nearest
 * existing ancestor, realpath that, and re-attach the missing tail — so
 * symlinked parents cannot smuggle a write outside a grant, no matter how
 * deep the target is missing.
 */
export async function canonicalTargetPath(raw: string): Promise<string> {
  try {
    return await realpath(raw)
  } catch {
    // fall through to the ancestor walk
  }
  let current = raw
  const tail: string[] = []
  for (;;) {
    const parent = dirname(current)
    if (parent === current) throw new GrantError(`路径不存在或不可访问：${raw}`)
    tail.unshift(basename(current))
    current = parent
    try {
      const resolved = await realpath(current)
      return join(resolved, ...tail)
    } catch {
      // keep walking up
    }
  }
}

/**
 * Grant registry keyed by session. All mutations are synchronous after the
 * async path canonicalization that happens at request time.
 */
export class GrantRegistry {
  private readonly pending = new Map<string, PendingEntry>()
  private readonly grants = new Map<string, GrantRecord>()
  private readonly audit: AuditEntry[] = []
  private readonly options: GrantRegistryOptions

  constructor(options: Partial<GrantRegistryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /* ---- request ------------------------------------------------------- */

  /**
   * Create a pending grant and return the outcome promise the tool awaits.
   * The caller owns the deadline (the promise settles by then at the latest).
   * @throws GrantError for invalid input or per-session limits.
   */
  async requestGrant(
    sessionId: string,
    path: string,
    scope: GrantScope,
    reason: string,
    context: { toolName?: string; agentName?: string; sessionCwd?: string } = {},
  ): Promise<GrantOutcome> {
    if (scope !== 'read' && scope !== 'write') throw new GrantError('scope 必须是 read 或 write')
    const canonical = await canonicalPath(path)
    if (this.pendingCount(sessionId) >= this.options.maxPendingPerSession) {
      throw new GrantError('该会话待确认的授权过多，请先处理已有请求')
    }
    if (this.activeCount(sessionId) >= this.options.maxActivePerSession) {
      throw new GrantError('该会话的活跃授权已达上限，请先撤销部分授权')
    }

    const id = randomUUID()
    const now = new Date()
    const grant: GrantRecord = {
      id,
      sessionId,
      path: canonical,
      scope,
      reason: reason.trim() === '' ? '（未说明原因）' : reason.trim(),
      status: 'pending',
      requestedAt: now.toISOString(),
      sessionCwd: context.sessionCwd,
      toolName: context.toolName,
      agentName: context.agentName,
    }

    const outcome = new Promise<GrantOutcome>((resolveSettle) => {
      const settle = (status: 'active' | 'denied' | 'expired'): void => {
        const entry = this.pending.get(id)
        if (entry === undefined) return // already settled
        clearTimeout(entry.timer)
        this.pending.delete(id)
        if (status === 'active') {
          grant.status = 'active'
          grant.decidedAt = new Date().toISOString()
          grant.decidedBy = 'user'
          this.grants.set(id, grant)
          this.appendAudit(sessionId, 'grant_approved', `${grant.path}（${grant.scope}）`)
        } else {
          grant.status = status
          grant.decidedAt = new Date().toISOString()
          grant.decidedBy = status === 'denied' ? 'user' : 'timeout'
          this.appendAudit(
            sessionId,
            status === 'denied' ? 'grant_denied' : 'grant_expired',
            `${grant.path}（${grant.scope}）`,
          )
        }
        resolveSettle({
          grantId: id,
          path: grant.path,
          scope: grant.scope,
          status: grant.status,
          message: status === 'active'
            ? `授权已确认：可在 ${grant.path} 内执行 ${grant.scope} 操作`
            : status === 'denied'
              ? '用户拒绝了该授权请求'
              : '授权请求超时未确认，已自动拒绝',
        })
      }
      const timer = setTimeout(() => settle('expired'), this.options.confirmTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { grant, settle, timer })
    })

    this.appendAudit(sessionId, 'grant_requested', `${canonical}（${scope}）：${grant.reason}`)
    return outcome
  }

  /**
   * Request a workspace registration confirmation. Same pending/confirm
   * pipeline as grants, but the confirmed action is the route layer's
   * workspace-registration hook (the registry itself stays side-effect free).
   * @throws GrantError for invalid input or per-session limits.
   */
  async requestWorkspace(
    sessionId: string,
    path: string,
    title: string,
    reason: string,
    context: { toolName?: string; agentName?: string; sessionCwd?: string } = {},
  ): Promise<GrantOutcome> {
    const canonical = await canonicalPath(path)
    if (this.pendingCount(sessionId) >= this.options.maxPendingPerSession) {
      throw new GrantError('该会话待确认的请求过多，请先处理已有请求')
    }

    const id = randomUUID()
    const now = new Date()
    const grant: GrantRecord = {
      id,
      sessionId,
      path: canonical,
      scope: 'write',
      reason: reason.trim() === '' ? '（未说明原因）' : reason.trim(),
      status: 'pending',
      requestedAt: now.toISOString(),
      sessionCwd: context.sessionCwd,
      toolName: context.toolName,
      agentName: context.agentName,
      kind: 'workspace',
      title: title.trim() === '' ? basename(canonical) : title.trim(),
    }

    const outcome = new Promise<GrantOutcome>((resolveSettle) => {
      const settle = (status: 'active' | 'denied' | 'expired'): void => {
        const entry = this.pending.get(id)
        if (entry === undefined) return // already settled
        clearTimeout(entry.timer)
        this.pending.delete(id)
        grant.status = status
        grant.decidedAt = new Date().toISOString()
        grant.decidedBy = status === 'denied' ? 'user' : status === 'expired' ? 'timeout' : 'user'
        this.appendAudit(
          sessionId,
          status === 'active' ? 'workspace_registered' : status === 'denied' ? 'workspace_denied' : 'workspace_expired',
          `${grant.title}（${grant.path}）`,
        )
        resolveSettle({
          grantId: id,
          path: grant.path,
          scope: grant.scope,
          status: grant.status,
          message: status === 'active'
            ? `已登记为本会话的子工作区：${grant.title}（${grant.path}）。在「会话信息」选项卡中管理；存续期间该目录内 read/write 自动放行。`
            : status === 'denied'
              ? '用户拒绝了该子工作区登记请求'
              : '子工作区登记请求超时未确认，已自动取消',
        })
      }
      const timer = setTimeout(() => settle('expired'), this.options.confirmTimeoutMs)
      timer.unref?.()
      this.pending.set(id, { grant, settle, timer })
    })

    this.appendAudit(sessionId, 'workspace_requested', `${grant.title}（${canonical}）：${grant.reason}`)
    return outcome
  }

  /** Read-only info about one pending entry (route-layer orchestration). */
  pendingInfo(id: string): { kind: 'grant' | 'workspace'; path: string; title?: string; sessionId: string } | undefined {
    const entry = this.pending.get(id)
    if (entry === undefined) return undefined
    return {
      kind: entry.grant.kind ?? 'grant',
      path: entry.grant.path,
      title: entry.grant.title,
      sessionId: entry.grant.sessionId,
    }
  }

  /* ---- decisions ------------------------------------------------------ */

  /**
   * Approve a pending grant (optional scope tightening). Returns a
   * human-readable result; unknown/already-settled ids return an error string.
   */
  approve(id: string, scope?: GrantScope): string | undefined {
    const entry = this.pending.get(id)
    if (entry === undefined) return '该授权请求不存在或已处理'
    if (scope === 'read' && entry.grant.scope === 'write') entry.grant.scope = 'read'
    entry.settle('active')
    return undefined
  }

  /** Deny a pending grant. */
  deny(id: string): string | undefined {
    const entry = this.pending.get(id)
    if (entry === undefined) return '该授权请求不存在或已处理'
    entry.settle('denied')
    return undefined
  }

  /**
   * Revoke an active grant by id (or by path — revokes every active grant
   * whose directory is inside the given path). Returns revoked grants.
   */
  async revoke(idOrPath: string): Promise<WorkscopeGrant[]> {
    const revoked: WorkscopeGrant[] = []
    if (this.grants.has(idOrPath)) {
      const grant = this.grants.get(idOrPath)!
      this.grants.delete(idOrPath)
      grant.status = 'revoked'
      grant.decidedAt = new Date().toISOString()
      grant.decidedBy = 'user'
      this.appendAudit(grant.sessionId, 'grant_revoked', grant.path)
      revoked.push(grant)
      return revoked
    }
    // Path form: canonicalize (may throw for missing paths — caller shows it).
    const canonical = await canonicalPath(idOrPath)
    for (const grant of [...this.grants.values()]) {
      if (isPathInside(canonical, grant.path)) {
        this.grants.delete(grant.id)
        grant.status = 'revoked'
        grant.decidedAt = new Date().toISOString()
        grant.decidedBy = 'user'
        this.appendAudit(grant.sessionId, 'grant_revoked', grant.path)
        revoked.push(grant)
      }
    }
    return revoked
  }

  /** Release everything a session holds (auto-revoke on session end). */
  releaseSession(sessionId: string): void {
    for (const [id, entry] of [...this.pending]) {
      if (entry.grant.sessionId !== sessionId) continue
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.settle('denied')
    }
    for (const grant of [...this.grants.values()]) {
      if (grant.sessionId !== sessionId) continue
      this.grants.delete(grant.id)
      grant.status = 'revoked'
      grant.decidedAt = new Date().toISOString()
      grant.decidedBy = 'auto'
      this.appendAudit(sessionId, 'session_released', `会话结束，自动撤销：${grant.path}`)
    }
  }

  /** Drop all state (plugin teardown). */
  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.settle('denied')
    }
    this.pending.clear()
    this.grants.clear()
    this.audit.length = 0
  }

  /* ---- queries -------------------------------------------------------- */

  /** Whether `path` (any absolute path) may be accessed with `scope`. */
  async isAllowed(sessionId: string, path: string, scope: GrantScope): Promise<boolean> {
    // Path-based boundary (existence not required): the write-target
    // canonicalization also covers read targets, so a symlinked parent can
    // never smuggle a path outside a grant.
    let canonical: string
    try {
      canonical = await canonicalTargetPath(path)
    } catch {
      return false
    }
    for (const grant of this.grants.values()) {
      if (grant.sessionId !== sessionId || grant.status !== 'active') continue
      if (grant.scope === 'read' && scope === 'write') continue
      if (isPathInside(grant.path, canonical)) return true
    }
    return false
  }

  /** Active grants of one session (or all sessions when omitted). */
  activeGrants(sessionId?: string): WorkscopeGrant[] {
    const all = [...this.grants.values()].filter(g => g.status === 'active')
    return sessionId === undefined ? all : all.filter(g => g.sessionId === sessionId)
  }

  /** Pending grants of one session (or all sessions when omitted). */
  pendingGrants(sessionId?: string): WorkscopeGrant[] {
    const all = [...this.pending.values()].map(entry => entry.grant)
    return sessionId === undefined ? all : all.filter(g => g.sessionId === sessionId)
  }

  /** Pending grants shaped for the confirmation UI (with deadline). */
  pendingViews(): PendingGrantView[] {
    const now = Date.now()
    return [...this.pending.values()].map(entry => {
      const grant = entry.grant
      const expiresAt = new Date(new Date(grant.requestedAt).getTime() + this.options.confirmTimeoutMs)
      return {
        id: grant.id,
        kind: grant.kind ?? 'grant',
        path: grant.path,
        scope: grant.scope,
        reason: grant.reason,
        ...(grant.kind === 'workspace' ? { title: grant.title } : {}),
        toolName: grant.toolName ?? 'workscope_grant',
        agentName: grant.agentName,
        requestedAt: grant.requestedAt,
        expiresAt: expiresAt.toISOString(),
        // The UI shows a live countdown; expose whether it is already past due.
        expiresInMs: Math.max(0, expiresAt.getTime() - now),
      }
    })
  }

  /** Recent audit entries. */
  auditEntries(limit = 50): AuditEntry[] {
    return this.audit.slice(-limit).reverse()
  }

  /* ---- internals ------------------------------------------------------ */

  private pendingCount(sessionId: string): number {
    let count = 0
    for (const entry of this.pending.values()) if (entry.grant.sessionId === sessionId) count++
    return count
  }

  private activeCount(sessionId: string): number {
    let count = 0
    for (const grant of this.grants.values()) if (grant.sessionId === sessionId) count++
    return count
  }

  /** Append one audit entry (public so the workspace layer audits through the same list). */
  appendAudit(sessionId: string, kind: AuditEntry['kind'], detail: string): void {
    this.audit.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      sessionId,
      kind,
      detail,
    })
    if (this.audit.length > this.options.auditCap) {
      this.audit.splice(0, this.audit.length - this.options.auditCap)
    }
    invariant(this.audit.length <= this.options.auditCap, 'audit cap violated')
  }
}
