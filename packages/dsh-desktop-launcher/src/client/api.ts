/**
 * Browser-side API client for /api/dsh-desktop-launcher — plain same-origin
 * fetch, the only data path the settings card uses.
 */
import { LAUNCHER_API, type CreateResult } from '../protocol.ts'

/** Error carrying the route's JSON error message. */
export class DesktopLauncherApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopLauncherApiError'
  }
}

/** Create (or refresh) the desktop icon. */
export async function createDesktopShortcut(): Promise<CreateResult> {
  const response = await fetch(LAUNCHER_API.create, { method: 'POST' })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DesktopLauncherApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new DesktopLauncherApiError(message)
  }
  const result = (body as { result?: unknown }).result
  if (typeof result !== 'object' || result === null || (result as CreateResult).ok !== true) {
    throw new DesktopLauncherApiError('desktop shortcut creation returned an invalid result')
  }
  return result as CreateResult
}
