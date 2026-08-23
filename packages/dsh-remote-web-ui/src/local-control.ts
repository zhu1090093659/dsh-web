/** Browser-trust fence shared by loopback-only control-plane routes. */

import type { IncomingMessage } from 'node:http'
import { isLoopbackClient } from './gate.ts'

export interface LocalControlFenceOptions {
  /** Require requests to target this exact HTTP origin and authority. */
  expectedOrigin?: string
  /** Require an explicit browser Origin header (recommended for POST controls). */
  requireOrigin?: boolean
}

/**
 * Accept a local control request only when both its socket and Host are
 * loopback, browser metadata does not identify it as cross-site, and any
 * supplied Origin exactly matches the addressed local HTTP origin.
 */
export function isTrustedLocalControlRequest(
  request: IncomingMessage,
  options: LocalControlFenceOptions = {},
): boolean {
  if (!isLoopbackClient(request)) return false
  // Origin is the POST authority gate. Sec-Fetch-Site is an additional veto:
  // accept it when absent for non-browser local clients, but never ignore an
  // explicit browser cross-site classification.
  if (request.headers['sec-fetch-site'] === 'cross-site') return false

  const host = request.headers.host
  if (typeof host !== 'string') return false

  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  // WHATWG parsing accepts strings that are not HTTP Host authorities (for
  // example user@127.0.0.1/path) and then normalizes their origin. Never let
  // those extra components disappear across the trust comparison.
  if (hostUrl.username !== '' || hostUrl.password !== '' || hostUrl.pathname !== '/' || hostUrl.search !== '' || hostUrl.hash !== '') {
    return false
  }
  const requestOrigin = hostUrl.origin
  if (options.expectedOrigin !== undefined && requestOrigin !== options.expectedOrigin) return false

  const origin = request.headers.origin
  if (origin === undefined) return options.requireOrigin !== true
  try {
    const originUrl = new URL(origin)
    return originUrl.username === ''
      && originUrl.password === ''
      && originUrl.pathname === '/'
      && originUrl.search === ''
      && originUrl.hash === ''
      && originUrl.origin === requestOrigin
      && origin === originUrl.origin
  } catch {
    return false
  }
}
