/**
 * Browser-side API client for the /api/dsh-beyond-workscope route family.
 * Plain same-origin fetch; the only data access path the card uses.
 */

import { API_PREFIX, type ActiveGrantView, type ApprovePendingPayload, type AuditEntry, type PendingGrantView, type SessionInfoResponse, type SessionInfoView, type SimpleActionResponse, type WorkspaceView } from '../protocol.ts'

/** Error carrying the route's JSON error message. */
export class WorkscopeApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkscopeApiError'
  }
}

/** Parse a JSON response or throw a WorkscopeApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new WorkscopeApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new WorkscopeApiError(message)
  }
  return body as T
}

/** One route call with a JSON body. */
async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return readJson<T>(response)
}

/** The plugin's API surface. */
export class WorkscopeApi {
  /** Pending grants awaiting the user's decision. */
  getPending(): Promise<PendingGrantView[]> {
    return fetch(`${API_PREFIX}/pending`)
      .then(response => readJson<{ pending: PendingGrantView[] }>(response))
      .then(body => body.pending)
  }

  /** Approve one pending grant (optionally tightened to read). */
  approve(id: string, scope?: 'read' | 'write'): Promise<void> {
    const payload: ApprovePendingPayload = scope === undefined ? { id } : { id, scope }
    return postJson<SimpleActionResponse>(`${API_PREFIX}/pending/approve`, payload).then(() => undefined)
  }

  /** Deny one pending grant. */
  deny(id: string): Promise<void> {
    return postJson<SimpleActionResponse>(`${API_PREFIX}/pending/deny`, { id }).then(() => undefined)
  }

  /** All active grants (management view). */
  getGrants(): Promise<ActiveGrantView[]> {
    return fetch(`${API_PREFIX}/grants`)
      .then(response => readJson<{ grants: ActiveGrantView[] }>(response))
      .then(body => body.grants)
  }

  /** Revoke one active grant. */
  revoke(id: string): Promise<void> {
    return postJson<SimpleActionResponse>(`${API_PREFIX}/grants/revoke`, { id }).then(() => undefined)
  }

  /** Recent audit entries. */
  getAudit(): Promise<AuditEntry[]> {
    return fetch(`${API_PREFIX}/audit`)
      .then(response => readJson<{ entries: AuditEntry[] }>(response))
      .then(body => body.entries)
  }

  /** Session metadata for the 会话信息 tab (host-side lookup). */
  getSessionInfo(sessionId: string): Promise<SessionInfoView | undefined> {
    return fetch(`${API_PREFIX}/session-info?session=${encodeURIComponent(sessionId)}`)
      .then(response => readJson<SessionInfoResponse>(response))
      .then(body => body.session)
  }

  /** Plugin-managed sub-workspace registrations (management view). */
  getWorkspaces(): Promise<WorkspaceView[]> {
    return fetch(`${API_PREFIX}/workspaces`)
      .then(response => readJson<{ workspaces: WorkspaceView[] }>(response))
      .then(body => body.workspaces)
  }

  /** Remove one plugin-managed workspace registration (non-destructive). */
  removeWorkspace(id: string): Promise<void> {
    return postJson<SimpleActionResponse>(`${API_PREFIX}/workspaces/remove`, { id }).then(() => undefined)
  }
}
