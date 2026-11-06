/**
 * Skill-center trust fence: loopback (the desktop) always passes; a live
 * paired-device cookie is an additional allow path when remote-web-ui is
 * loaded; requests admitted by the host connection service (trusted-host / proxy)
 * pass directly. The plugin never depends on that plugin — without the service
 * the fence stays loopback-only. The decision logic lives in the generated
 * pair-access.ts copy (shared by pet / skill-explorer).
 */
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { isPairedOrLoopbackAllowed } from './pair-access.ts'

/** Structural lookup of the host connection service. */
interface HostConnectionService {
  requestRejection?: (request: IncomingMessage) => unknown
}

/**
 * Resolve the optional host `connection` service without requiring injection.
 * @param ctx - host context that may expose `connection`.
 * @returns the service when present and shaped, or undefined.
 */
function resolveConnection(ctx: Context): HostConnectionService | undefined {
  try {
    const candidate = typeof ctx.get === 'function'
      ? (ctx.get('connection', false) ?? ctx.get('connection'))
      : (ctx as { connection?: HostConnectionService }).connection
    return candidate !== undefined && candidate !== null && typeof candidate.requestRejection === 'function'
      ? candidate
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether this request may enter any /api/dsh-skill-explorer route.
 * @param ctx - host context; may expose remoteWebUiPairing or connection.
 * @param request - the incoming HTTP request.
 * @returns true for loopback, a live paired-device cookie, or an admitted host connection.
 */
export function isSkillExplorerAllowed(ctx: Context, request: IncomingMessage): boolean {
  const connection = resolveConnection(ctx)
  if (connection !== undefined && connection.requestRejection?.(request) === undefined) {
    return true
  }
  return isPairedOrLoopbackAllowed(ctx, request)
}
