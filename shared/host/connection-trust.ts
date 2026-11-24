/**
 * Optional bridge to the Host connection trust decision (`admit(request)`). A
 * missing or throwing bridge is not an admission: callers must retain their
 * existing loopback or pairing fence.
 */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** Structural host connection face (`admit(request)` on DSH 0.2.3-alpha.2+). */
export interface HostConnectionService {
  admit?: (request: IncomingMessage) => { readonly peer?: unknown; readonly rejection?: unknown }
}

/** Lazily read the service captured in the plugin's dependency scope. */
export type HostConnectionReader = () => HostConnectionService | undefined

function resolveConnection(ctx: Context): HostConnectionService | undefined {
  try {
    const candidate = typeof ctx.get === 'function'
      ? (ctx.get('connection', false) ?? ctx.get('connection'))
      : (ctx as { connection?: HostConnectionService }).connection
    return candidate !== undefined && candidate !== null && typeof candidate.admit === 'function'
      ? candidate
      : undefined
  } catch {
    return undefined
  }
}

/** Whether the Host's own authenticated/trusted-host decision admits a request. */
export function connectionAdmits(connection: HostConnectionService | undefined, request: IncomingMessage): boolean {
  if (connection === undefined || typeof connection.admit !== 'function') return false
  try {
    const admission = connection.admit(request)
    return admission.rejection === undefined && 'peer' in admission && admission.peer !== undefined
  } catch {
    return false
  }
}

/**
 * Capture connection in a scope that also injects connection.authentication:
 * admit(request) resolves that service through the calling fiber. The returned
 * reader falls back to a bare optional lookup on cohorts without that service.
 */
export function captureConnection(ctx: Context, effectName: string): HostConnectionReader {
  let captured: HostConnectionService | undefined
  const inject = (ctx as { inject?: (names: readonly string[], callback: (scoped: Context) => unknown) => unknown }).inject
  if (typeof inject === 'function') {
    inject.call(ctx, ['connection', 'connection.authentication'], (scoped: Context) => {
      scoped.effect(() => {
        captured = resolveConnection(scoped)
        return () => {
          captured = undefined
        }
      }, effectName)
    })
  }
  return () => captured ?? resolveConnection(ctx)
}
