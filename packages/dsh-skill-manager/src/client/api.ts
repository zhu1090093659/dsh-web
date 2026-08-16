/**
 * Browser-side API client for the /api/dsh-skill-manager route family.
 * Plain same-origin fetch — the only data access path the settings section
 * uses.
 * @module @linxin666/dsh-skill-manager/client/api
 */

import { API, type ApiErrorBody, type InstallRequest, type InstallResponse, type ListRequest, type ListResponse, type ToggleRequest, type ToggleResponse, type UninstallRequest, type UninstallResponse } from '../core/protocol.ts'

/** Error carrying the route's JSON error message and machine code. */
export class SkillManagerApiError extends Error {
  /** Stable machine code from the route (undefined when absent). */
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'SkillManagerApiError'
    this.code = code
  }
}

/** Parse a JSON response or throw a SkillManagerApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new SkillManagerApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as ApiErrorBody : undefined
    const message = record?.error ?? `HTTP ${response.status}`
    throw new SkillManagerApiError(message, record?.code)
  }
  return body as T
}

/** The browser half's only data entry point. */
export class SkillManagerApi {
  /** List the skill catalog for one session. */
  async list(sessionId: string): Promise<ListResponse> {
    const request: ListRequest = { sessionId }
    const response = await fetch(API.list, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return await readJson<ListResponse>(response)
  }

  /** Toggle one skill for one session. */
  async toggle(sessionId: string, name: string, enabled: boolean): Promise<ToggleResponse> {
    const request: ToggleRequest = { sessionId, name, enabled }
    const response = await fetch(API.toggle, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return await readJson<ToggleResponse>(response)
  }

  /** Install skills for one session. */
  async install(request: InstallRequest): Promise<InstallResponse> {
    const response = await fetch(API.install, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return await readJson<InstallResponse>(response)
  }

  /** Uninstall one manager-installed skill. */
  async uninstall(sessionId: string, name: string): Promise<UninstallResponse> {
    const request: UninstallRequest = { sessionId, name }
    const response = await fetch(API.uninstall, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return await readJson<UninstallResponse>(response)
  }
}
