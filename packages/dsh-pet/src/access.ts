/**
 * Pet trust fence: loopback (the desktop) always passes; a live paired-device
 * cookie is an additional allow path when remote-web-ui is loaded. The pet
 * never depends on that plugin — without the service the fence stays
 * loopback-only (same pattern as skill-explorer / aionui-panel).
 */
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { isLoopbackRequest } from './loopback.ts'

/** Structural pairing lookup (no package dependency on remote-web-ui). */
interface PairingAccess {
  isPairedDevice(request: IncomingMessage): boolean
}

/** ctx.get is optional on the test harness; production Context always has it. */
type LookupCtx = Context & {
  get?(name: string, strict?: boolean): unknown
  remoteWebUiPairing?: PairingAccess
}

/**
 * Whether this request may enter any /api/pet or /pet asset route.
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param request - the incoming HTTP request.
 * @returns true for loopback, or a live paired-device cookie.
 */
export function isPetAllowed(ctx: Context, request: IncomingMessage): boolean {
  if (isLoopbackRequest(request)) return true
  const bag = ctx as LookupCtx
  const fromGet = typeof bag.get === 'function' ? bag.get('remoteWebUiPairing', false) : undefined
  const pairing = (isPairingAccess(fromGet) ? fromGet : bag.remoteWebUiPairing)
  return pairing?.isPairedDevice(request) === true
}

function isPairingAccess(value: unknown): value is PairingAccess {
  return value !== undefined
    && value !== null
    && typeof (value as PairingAccess).isPairedDevice === 'function'
}
