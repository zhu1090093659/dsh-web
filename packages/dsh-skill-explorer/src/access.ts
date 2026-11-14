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

/** Structural lookup of the host connection service across SDK cohorts. */
export interface HostConnectionService {
  requestRejection?: (request: IncomingMessage) => unknown
  admit?: (request: IncomingMessage) => { readonly peer?: unknown; readonly rejection?: unknown }
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
    return candidate !== undefined && candidate !== null && (
      typeof candidate.admit === 'function' || typeof candidate.requestRejection === 'function'
    )
      ? candidate
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the host connection service admits this request.
 *
 * Post-#8266 hosts answer through `admit(request)`, which reads
 * `connection.authentication` through the CALLING context: a context that
 * injected only `connection` throws "cannot get property
 * \"connection.authentication\" without inject" out of the request handler.
 * A bridge that cannot answer is not an admission — it keeps the paired or
 * loopback fence below instead of failing the route.
 * @param connection - the resolved host connection service.
 * @param request - the incoming HTTP request.
 * @returns true when the service admitted the request as a live Peer.
 */
function connectionAdmits(connection: HostConnectionService, request: IncomingMessage): boolean {
  try {
    if (typeof connection.admit === 'function') {
      const admission = connection.admit(request)
      return admission.rejection === undefined && 'peer' in admission && admission.peer !== undefined
    }
    if (typeof connection.requestRejection === 'function') return connection.requestRejection(request) === undefined
    return false
  } catch {
    return false
  }
}

/**
 * Whether this request may enter any /api/dsh-skill-explorer route.
 * @param ctx - host context; may expose remoteWebUiPairing or connection.
 * @param request - the incoming HTTP request.
 * @returns true for loopback, a live paired-device cookie, or an admitted host connection.
 */
export function isSkillExplorerAllowed(
  ctx: Context,
  request: IncomingMessage,
  connection: HostConnectionService | undefined = resolveConnection(ctx),
): boolean {
  if (connection !== undefined && connectionAdmits(connection, request)) return true
  return isPairedOrLoopbackAllowed(ctx, request)
}

/**
 * Capture the host connection service in a scope that injects BOTH
 * `connection` and `connection.authentication`, the two services its
 * `admit(request)` bridge reads. The row's own `inject` list stays unchanged
 * (the service stays optional), and a cohort whose connection has no
 * authentication sub-service never activates this scope, so the reader keeps
 * returning whatever a bare lookup finds.
 * @param ctx - the plugin context.
 * @returns a reader of the captured service, undefined before it activates.
 */
export function captureConnection(ctx: Context): () => HostConnectionService | undefined {
  let captured: HostConnectionService | undefined
  const inject = (ctx as { inject?: (names: readonly string[], callback: (scoped: Context) => unknown) => unknown }).inject
  if (typeof inject === 'function') {
    inject.call(ctx, ['connection', 'connection.authentication'], (scoped: Context) => {
      scoped.effect(() => {
        captured = resolveConnection(scoped)
        return () => {
          captured = undefined
        }
      }, 'skill-explorer: connection trust')
    })
  }
  return () => captured ?? resolveConnection(ctx)
}
