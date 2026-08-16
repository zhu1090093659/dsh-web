/**
 * Browser-side API client for the /api/dsh-plugin-manager route family.
 * Plain same-origin fetch — the only data access path the Manage tab uses.
 * @module @linxin666/dsh-plugin-manager/client/api
 */

import { API, type ApiErrorBody, type ListResponse, type SetEnabledResponse } from '../protocol.ts'

/** Error carrying the route's JSON error message and machine code. */
export class PluginManagerApiError extends Error {
  /** Stable machine code from the route (undefined when absent). */
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'PluginManagerApiError'
    this.code = code
  }
}

/** Parse a JSON response or throw a PluginManagerApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new PluginManagerApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? body as ApiErrorBody : undefined
    const message = record?.error ?? `HTTP ${response.status}`
    throw new PluginManagerApiError(message, record?.code)
  }
  return body as T
}

/** The browser half's only data entry point. */
export class PluginManagerApi {
  /** List the loaded plugin entries. */
  async list(): Promise<ListResponse> {
    const response = await fetch(API.list, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    return await readJson<ListResponse>(response)
  }

  /** Enable or disable one plugin entry. */
  async setEnabled(entryId: string, enabled: boolean): Promise<SetEnabledResponse> {
    const response = await fetch(API.setEnabled, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId, enabled }),
    })
    return await readJson<SetEnabledResponse>(response)
  }
}
