/**
 * Browser-side wire helper for the /api/dsh-shutdown surface. Plain fetch
 * over same-origin /api; the host half enforces the loopback-only fence and
 * owns the bounded exit request.
 */

import { SHUTDOWN_PATH } from '../core/shutdown.ts'

/**
 * Ask the host process to exit. Resolves when the host acknowledges; the
 * process tears down shortly afterwards.
 * @returns settlement after the acknowledgement.
 */
export async function requestShutdown(): Promise<void> {
  const response = await fetch(SHUTDOWN_PATH, { method: 'POST' })
  if (!response.ok) throw new Error('shutdown request failed (HTTP ' + String(response.status) + ')')
}
