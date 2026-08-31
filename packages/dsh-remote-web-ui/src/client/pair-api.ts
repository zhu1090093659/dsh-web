/**
 * Browser-side wire helpers for the /api/pair surface. Plain fetch over
 * same-origin /api (like the connection client); JSON bodies, string
 * responses for the error codes.
 */

/** issue() response. */
export interface IssueResult {
  ok: true
  url: string
  token: string
  expiresAt: number
  /** Every constructible LAN base address (interface order). */
  lanAddresses: string[]
  /** The configured public (tunneled) base URL, when present. */
  publicBaseUrl?: string
}

/** issue() refusal: the server is not LAN-reachable. */
export interface IssueLanRequired {
  ok: false
  code: 'lan-required'
}

/** issue() refusal: the requested LAN address is not constructible. */
export interface IssueUnknownAddress {
  ok: false
  code: 'unknown-address'
}

/** issue() refusal: the loopback-only fence rejected this origin. */
export interface IssueLoopbackRequired {
  ok: false
  code: 'forbidden'
}

export type IssueResponse = IssueResult | IssueLanRequired | IssueUnknownAddress | IssueLoopbackRequired

/** Public policy fields returned by the pairing status endpoint. */
export interface PairGatePolicy {
  requirePairingForLan: boolean
}

/** Read the host-authoritative desktop pairing policy. */
export async function readPairGatePolicy(): Promise<PairGatePolicy> {
  const response = await fetch('/api/pair/status')
  if (!response.ok) throw new Error(`remote-web-ui: status failed with ${String(response.status)}`)
  const value = await response.json() as { requirePairingForLan?: unknown }
  if (typeof value.requirePairingForLan !== 'boolean') {
    throw new Error('remote-web-ui: status omitted requirePairingForLan')
  }
  return { requirePairingForLan: value.requirePairingForLan }
}

/** accept() refusal codes. */
export type AcceptFailure = { ok: false; code: 'invalid' | 'used' | 'forbidden' }

/** One auto-tunnel status frame (absent while the feature is off). */
export interface TunnelStatusFrame {
  state: 'starting' | 'running' | 'failed'
  url?: string
  error?: string
}

/** One /api posture frame (host half probe; see src/posture.ts). */
export interface PostureFrame {
  checkedAt: number
  hosts: { host: string; exposed: boolean }[]
}

/** One /api/pair/events frame. */
export interface PairStateFrame {
  type: 'state'
  phase: 'lan-required' | 'stopped' | 'waiting' | 'connected' | 'disconnected'
  lanAvailable: boolean
  tokenId?: string
  tokenExpiresAt?: number
  deviceCount: number
  onlineCount: number
  /** Per-device roster (loopback events only). */
  devices?: DeviceFrame[]
  /** Auto-tunnel status, while the auto-tunnel feature is active. */
  tunnel?: TunnelStatusFrame
  /** Latest /api fence posture probe, once a round has completed. */
  posture?: PostureFrame
}

/** One authorized-device row from the loopback status stream. */
export interface DeviceFrame {
  id: string
  createdAt: number
  lastSeenAt: number
  online: boolean
  userAgent?: string
}

/**
 * Mint a fresh pairing token (one active token at a time — this invalidates
 * any previous link).
 * @param address - optional LAN IP literal the QR must be built from (the
 * default is the first interface); unknown literals refuse with
 * 'unknown-address'.
 * @returns the issued link, the lan-required refusal (server never bound
 * 0.0.0.0), or the forbidden refusal (the loopback-only fence rejected this
 * origin — the panel is a desktop control endpoint).
 */
export async function issuePair(address?: string): Promise<IssueResponse> {
  const response = await fetch('/api/pair/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(address !== undefined ? { address } : {}),
    }),
  })
  if (!response.ok) {
    if (response.status === 409) return { ok: false, code: 'lan-required' }
    if (response.status === 403) return { ok: false, code: 'forbidden' }
    if (response.status === 400) return { ok: false, code: 'unknown-address' }
    throw new Error(`remote-web-ui: issue failed with ${String(response.status)}`)
  }
  return await response.json() as IssueResult
}

/**
 * Accept a pairing token (the phone's first open of the QR link). Success
 * sets the device cookie; the page then reloads to boot with it.
 * @param token - the token from the URL.
 * @returns the wire result.
 */
export async function acceptPair(token: string): Promise<{ ok: true } | AcceptFailure> {
  const response = await fetch('/api/pair/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (response.ok) return { ok: true }
  if (response.status === 404) return { ok: false, code: 'invalid' }
  if (response.status === 409) return { ok: false, code: 'used' }
  return { ok: false, code: 'forbidden' }
}

/** Revoke mobile access (paired devices + the current token). */
export async function stopPair(): Promise<void> {
  const response = await fetch('/api/pair/stop', { method: 'POST' })
  if (!response.ok) throw new Error(`remote-web-ui: stop failed with ${String(response.status)}`)
}

/**
 * Revoke one paired device from the loopback panel.
 * @param deviceId - the session id of the row to drop.
 */
export async function revokePair(deviceId: string): Promise<void> {
  const response = await fetch('/api/pair/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  })
  if (response.status === 404) return
  if (!response.ok) throw new Error(`remote-web-ui: revoke failed with ${String(response.status)}`)
}

/** Presence heartbeat from a paired phone (unpaired heartbeats 401 harmlessly). */
export async function sendHeartbeat(): Promise<void> {
  await fetch('/api/pair/heartbeat', { method: 'POST' })
}

/** Whether the current page URL carries a pairing token. */
export function readPairParams(search: string): { pair?: string } {
  const params = new URLSearchParams(search)
  const pair = params.get('pair')
  return pair !== null && pair !== '' ? { pair } : {}
}

/**
 * Strip one query parameter from the current URL without reloading.
 * @param name - the parameter to remove.
 * @returns the new search string ('' when empty).
 */
export function stripParam(name: string): string {
  const url = new URL(window.location.href)
  url.searchParams.delete(name)
  return url.search
}

/** LAN-bind status frame from the loopback-only card endpoint. */
export interface LanBindFrame {
  profile: string
  /** The config toggle: true/false once flipped, null while untouched. */
  setting: boolean | null
  /** The bind default the managed patch block currently pins. */
  blockHost: string | null
  /** The live bind of the running web server. */
  bindHost: string
  port: number
  lanUrls: string[]
  firewall: { ok: boolean; managed: boolean; note?: string }
  platform: string
  /** true when the running bind has not caught up with the toggle yet. */
  pendingRestart?: boolean
}

/** Read the LAN-bind facts (loopback-only endpoint). */
export async function readLanBindStatus(): Promise<LanBindFrame> {
  const response = await fetch('/api/pair/lan-bind')
  if (!response.ok) throw new Error(`remote-web-ui: lan-bind status failed with ${String(response.status)}`)
  return await response.json() as LanBindFrame
}

/** Human-readable expiry clock, e.g. "10:35". */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Calendar + clock for last-seen timestamps, e.g. "2026-08-19 10:35". */
export function formatLastSeen(epochMs: number): string {
  const date = new Date(epochMs)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day} ${formatClock(epochMs)}`
}

/**
 * Copy text to the clipboard with a fallback for insecure contexts
 * (plain-HTTP LAN origins lack navigator.clipboard).
 * @param text - the text to copy.
 * @returns whether the copy succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the execCommand path
    }
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
