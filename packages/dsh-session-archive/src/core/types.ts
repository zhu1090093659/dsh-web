/**
 * Wire and view types shared by the host half and the browser half of
 * dsh-session-archive. Pure data — no runtime imports on either side.
 * @module @linxin666/dsh-session-archive/core/types
 */

/** Result status of one session inside a batch operation. */
export type OpStatus = 'ok' | 'skipped' | 'failed'

/**
 * Stable machine reason codes for skip/fail results. The client localizes
 * these; `detail` carries unlocalized context (an OS error, a path) when present.
 */
export type OpReason =
  | 'running'
  | 'attached'
  | 'current'
  | 'in-flight'
  | 'not-found'
  | 'already-archived'
  | 'not-archived'
  | 'family-protected'
  | 'unreadable'
  | 'missing-seam'
  | 'busy'
  | 'error'

/** One per-session result inside a batch operation response. */
export interface OpResult {
  readonly id: string
  readonly status: OpStatus
  readonly reason?: OpReason
  readonly detail?: string
}

/** Aggregate counters for one executed batch or automatic cycle. */
export interface RunStats {
  readonly at: number
  readonly total: number
  readonly ok: number
  readonly skipped: number
  readonly failed: number
  /** Failed and skipped entries with reasons, most recent first, capped. */
  readonly entries: readonly OpResult[]
}

/** Why a row is flagged in the quick "needs attention" filter. */
export type ArchiveIssueCode = 'no-title' | 'no-archive-time' | 'unreadable' | 'no-data'

/** One manageable session as rendered in the list. */
export interface ArchiveSessionRow {
  readonly id: string
  /** Absent means the title could not be determined. */
  readonly title?: string
  readonly createdAt?: number
  readonly cwd?: string
  /** Workspace records containing the session, empty when workspace-less. */
  readonly workspaceIds: readonly string[]
  readonly archived: boolean
  /** Present only when a reliable archive time exists (this plugin recorded it). */
  readonly archivedAt?: number
  /**
   * Where {@link archivedAt} came from; present only together with it.
   * `observed` marks a backfilled entry: the session was already archived when
   * this plugin first saw it, so the time is the observation moment, not the
   * real archive moment.
   */
  readonly archivedAtSource?: 'manual' | 'auto' | 'observed'
  /** Last activity from the authoritative session feed; absent when unknown. */
  readonly lastActivityAt?: number
  /** False when last activity could not be determined reliably. */
  readonly lastActivityReliable: boolean
  readonly sizeBytes?: number
  readonly running: boolean
  /**
   * Host-side protection fact the browser half cannot observe on its own:
   * `attached` (the running harness process holds the session open) or
   * `in-flight` (a mutating operation currently owns it). Absent when the host
   * protects the row for no reason of its own, and absent on an older host that
   * does not report these facts at all — the browser half then degrades to what
   * it can observe itself (`running`, the current session).
   */
  readonly hostProtectedReason?: 'attached' | 'in-flight'
  readonly blank: boolean
  readonly origin?: 'subagent'
  readonly parentId?: string
  readonly childIds: readonly string[]
  readonly childCount: number
  readonly issues: readonly ArchiveIssueCode[]
}

/** One workspace projection for filter chips and per-workspace selection. */
export interface WorkspaceView {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** Full inventory document served to the browser half. */
export interface InventoryView {
  readonly generatedAt: number
  readonly rows: readonly ArchiveSessionRow[]
  readonly workspaces: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly string[]
  /** Host-side current-session id when the feed exposes one. */
  readonly auto: AutoStateView
}

/** Automatic policy run status persisted across restarts. */
export interface AutoStateView {
  readonly lastArchiveRun?: RunStats
  readonly lastDeleteRun?: RunStats
  readonly nextCheckAt?: number
  readonly cycleRunning: boolean
}

/** Candidate preview for the automatic policies (no data modified). */
export interface AutoPreviewView {
  readonly archiveCandidates: readonly { id: string; lastActivityAt: number }[]
  readonly deleteCandidates: readonly { id: string; archivedAt: number; sizeBytes?: number }[]
  readonly deleteBytes: number
}

/** Delete plan preview: the confirm-dialog contract. */
export interface DeletePlanView {
  /** Ids the caller targeted directly. */
  readonly direct: readonly string[]
  /** Descendants pulled in by family cascade. */
  readonly descendants: readonly string[]
  /** Members (direct or descendant) skipped because they are protected, with reasons. */
  readonly skipped: readonly OpResult[]
  /** Final sessions the plan will delete. */
  readonly targets: readonly string[]
  readonly totalBytes: number
}

/** Request body for the batch routes. */
export interface BatchRequestBody {
  readonly ids: readonly string[]
  /** Client-declared current session; the host protects it defensively too. */
  readonly currentSessionId?: string
  /**
   * Client-computed expected delete total (direct + descendants). When the
   * host plan disagrees the route answers 409 with the host plan so the UI
   * can re-confirm.
   */
  readonly expectedTotal?: number
}

/** Batch route response. */
export interface BatchResponse {
  readonly results: readonly OpResult[]
  readonly freedBytes: number
}

/** Request body for the manual auto-cycle run route. */
export interface AutoRunBody {
  readonly kind: 'archive' | 'delete'
  readonly currentSessionId?: string
}

/** Session preview payload (basic info + content excerpt). */
export interface SessionPreviewView {
  readonly id: string
  readonly title?: string
  readonly createdAt?: number
  readonly cwd?: string
  readonly sizeBytes?: number
  readonly messageCount: number
  /** First messages, each truncated; role is 'user' | 'assistant'. */
  readonly excerpt: readonly { role: string; text: string }[]
}

/** Error body for plan mismatch (HTTP 409). */
export interface PlanMismatchBody {
  readonly error: 'plan-mismatch'
  readonly plan: DeletePlanView
}
