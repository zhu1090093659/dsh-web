/**
 * Shared wire contract for dsh-beyond-workscope — types and constants only
 * (no node imports, no runtime identity), so the browser half can import this
 * module safely. The host half and the client half both spell the API prefix
 * from here.
 */

/** Route family root served by the host half. */
export const API_PREFIX = '/api/dsh-beyond-workscope'

/** What a grant permits inside the granted directory. */
export type GrantScope = 'read' | 'write'

/** Lifecycle of one grant. */
export type GrantStatus = 'pending' | 'active' | 'denied' | 'revoked' | 'expired'

/** Who decided a grant. */
export type GrantDecidedBy = 'user' | 'timeout' | 'auto'

/** One grant record (host view). */
export interface WorkscopeGrant {
  /** Opaque grant id. */
  readonly id: string
  /** Session that owns the grant (grants never cross sessions). */
  readonly sessionId: string
  /** Canonical (realpath-normalized) granted directory. */
  readonly path: string
  /** Allowed scope inside the grant. */
  readonly scope: GrantScope
  /** Human-readable reason the agent gave. */
  readonly reason: string
  /** Lifecycle status. */
  readonly status: GrantStatus
  /** ISO-8601 request instant. */
  readonly requestedAt: string
  /** ISO-8601 decision instant, when decided. */
  readonly decidedAt?: string
  /** Who decided. */
  readonly decidedBy?: GrantDecidedBy
  /** Session cwd at request time (informational). */
  readonly sessionCwd?: string
  /** Tool that requested the grant (presentation). */
  readonly toolName?: string
  /** Agent display name, when known. */
  readonly agentName?: string
}

/** The pending-grant view the confirmation UI needs. */
export interface PendingGrantView {
  readonly id: string
  readonly path: string
  readonly scope: GrantScope
  readonly reason: string
  /** Tool that requested the grant (presentation). */
  readonly toolName: string
  /** Agent display name, when known. */
  readonly agentName?: string
  /** ISO-8601 request instant. */
  readonly requestedAt: string
  /** ISO-8601 deadline; after this the grant expires automatically. */
  readonly expiresAt: string
  /** Milliseconds until the deadline (UI countdown). */
  readonly expiresInMs: number
}

/** Active-grant view for management surfaces. */
export interface ActiveGrantView {
  readonly id: string
  readonly path: string
  readonly scope: GrantScope
  readonly reason: string
  readonly sessionId: string
  readonly requestedAt: string
}

/** One audit entry (append-only, capped in memory). */
export interface AuditEntry {
  readonly id: string
  readonly at: string
  readonly sessionId: string
  readonly kind: 'grant_requested' | 'grant_approved' | 'grant_denied' | 'grant_revoked' | 'grant_expired' | 'session_released'
  readonly detail: string
}

/** One recent-file entry from the perception report. */
export interface RecentFileEntry {
  readonly path: string
  readonly name: string
  readonly kind: 'file' | 'dir' | 'project'
  /** Milliseconds since epoch (mtime). */
  readonly mtime: number
  /** Bytes; undefined for directories. */
  readonly size?: number
}

/** One process entry from the perception report. */
export interface ProcessEntry {
  readonly pid: number
  readonly name: string
  readonly args: string
}

/**
 * The perception report. `sourceTrust` is ALWAYS 'untrusted': perception
 * observes the user's machine, so its content must never be treated as an
 * instruction source or persisted into long-term memory.
 */
export interface PerceptionReport {
  readonly sourceTrust: 'untrusted'
  /** ISO-8601 scan instant. */
  readonly scannedAt: string
  /** Roots actually scanned (missing roots are skipped, with a warning). */
  readonly roots: string[]
  readonly recentFiles: RecentFileEntry[]
  readonly processes: ProcessEntry[]
  /** Non-fatal problems (missing root, ps unavailable, …). */
  readonly warnings: string[]
}

/** Route payloads (client ⇄ host). The webServer matches exact paths only,
 * so action targets travel in the JSON body (the dsh-ssh convention). */
export interface ApprovePendingPayload {
  /** The pending grant id to approve. */
  readonly id: string
  /** Optional scope override (the user may tighten a write grant to read). */
  readonly scope?: GrantScope
}

/** Deny one pending grant. */
export interface DenyPendingPayload {
  readonly id: string
}

/** Revoke one active grant. */
export interface RevokeGrantPayload {
  readonly id: string
}

export interface PendingListResponse {
  readonly pending: PendingGrantView[]
}

export interface GrantsListResponse {
  readonly grants: ActiveGrantView[]
}

export interface AuditResponse {
  readonly entries: AuditEntry[]
}

export interface SimpleActionResponse {
  readonly ok: boolean
  readonly error?: string
}
