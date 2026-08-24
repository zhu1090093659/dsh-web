/**
 * Model-controlled URL fence for the describe-image tool. The image URL is supplied by the
 * model, so it must never name the host the plugin runs on, its private networks, its
 * link-local range (cloud metadata, e.g. 169.254.169.254), or the reserved loopback
 * addresses. Literal IPs are judged from the parsed URL — the WHATWG parser already
 * normalizes legacy decimal/hex/octal IPv4 forms — and domain names are resolved first so
 * /etc/hosts entries and private answers are refused too; an unresolvable domain fails
 * closed. Rejections carry one generic wording and never response statuses or other
 * host-internal facts.
 * @module @linxin666/dsh-tool-describe-image/url-guard
 */

import { lookup } from 'node:dns/promises'
import { isLoopbackHostname } from './loopback.ts'

/** One blocked CIDR entry: the network base as an integer and its prefix length. */
interface CidrMask {
  base: bigint
  bits: number
}

const BLOCKED_V4: readonly CidrMask[] = [
  // 0.0.0.0/8 "this network"; 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 RFC 1918 private;
  // 127.0.0.0/8 loopback; 169.254.0.0/16 link-local (cloud metadata).
  { base: ipv4ToInt('0.0.0.0')!, bits: 8 },
  { base: ipv4ToInt('10.0.0.0')!, bits: 8 },
  { base: ipv4ToInt('127.0.0.0')!, bits: 8 },
  { base: ipv4ToInt('169.254.0.0')!, bits: 16 },
  { base: ipv4ToInt('172.16.0.0')!, bits: 12 },
  { base: ipv4ToInt('192.168.0.0')!, bits: 16 },
]

const BLOCKED_V6: readonly CidrMask[] = [
  // :: (unspecified), ::1 (loopback), fc00::/7 (ULA), fe80::/10 (link-local).
  { base: 0n, bits: 128 },
  { base: 1n, bits: 128 },
  { base: ipv6ToInt('fc00::')!, bits: 7 },
  { base: ipv6ToInt('fe80::')!, bits: 10 },
]

/** Parse a dotted-quad IPv4 literal into its 32-bit integer; undefined when not a literal. */
export function ipv4ToInt(ip: string): bigint | undefined {
  const parts = ip.split('.')
  if (parts.length !== 4) return undefined
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    value = (value << 8n) | BigInt(octet)
  }
  return value
}

/** Parse one 16-bit IPv6 group from its hex text; undefined when malformed. */
function ipv6GroupToInt(group: string): bigint | undefined {
  if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined
  return BigInt(`0x${group}`)
}

/**
 * Parse a bare IPv6 literal (no brackets, optional %zone tail and dotted-quad tail) into
 * its 128-bit integer; undefined when malformed. The WHATWG URL host keeps brackets, so the
 * caller strips them before this parse.
 */
export function ipv6ToInt(ip: string): bigint | undefined {
  let input = ip.trim().toLowerCase()
  const zone = input.indexOf('%')
  if (zone !== -1) input = input.slice(0, zone)
  // A dotted-quad tail (legacy IPv4-mapped/embedded forms) counts as two groups.
  let v4Tail: bigint | undefined
  const lastColon = input.lastIndexOf(':')
  const tail = lastColon === -1 ? input : input.slice(lastColon + 1)
  if (tail.includes('.')) {
    const parsed = ipv4ToInt(tail)
    if (parsed === undefined) return undefined
    v4Tail = parsed
    input = lastColon === -1 ? '' : input.slice(0, lastColon)
  }
  const pieces = input.split(':')
  const hasDouble = pieces.includes('')
  const hex = pieces.filter((piece) => piece !== '')
  const tailGroups = v4Tail === undefined ? 0 : 2
  if (hex.length + tailGroups > 8) return undefined
  let value = 0n
  if (hasDouble) {
    const before: string[] = []
    const after: string[] = []
    let sawDouble = false
    for (const piece of pieces) {
      if (piece === '') {
        sawDouble = true
        continue
      }
      ;(sawDouble ? after : before).push(piece)
    }
    const beforeValues = before.map(ipv6GroupToInt)
    const afterValues = after.map(ipv6GroupToInt)
    if (beforeValues.includes(undefined) || afterValues.includes(undefined)) return undefined
    const expansion = 8 - beforeValues.length - afterValues.length - tailGroups
    if (expansion < 0) return undefined
    for (const group of beforeValues) value = (value << 16n) | group!
    for (let index = 0; index < expansion; index += 1) value <<= 16n
    for (const group of afterValues) value = (value << 16n) | group!
  } else {
    if (pieces.length + tailGroups !== 8) return undefined
    for (const piece of pieces) {
      const group = ipv6GroupToInt(piece)
      if (group === undefined) return undefined
      value = (value << 16n) | group
    }
  }
  if (v4Tail !== undefined) value = (value << 32n) | v4Tail
  return value
}

/** Whether one IPv4 address value falls in a blocked CIDR. */
export function isBlockedIpv4Value(value: bigint): boolean {
  return BLOCKED_V4.some((candidate) => (value >> BigInt(32 - candidate.bits)) === (candidate.base >> BigInt(32 - candidate.bits)))
}

/** The embedded IPv4 value of an IPv4-mapped address, or undefined otherwise. */
function ipv4MappedValue(value: bigint): bigint | undefined {
  // 80 zero bits, then 0xffff, then the 32-bit IPv4 address.
  if (value >> 48n === 0n && ((value >> 32n) & 0xffffn) === 0xffffn) return value & 0xffffffffn
  return undefined
}

/** Whether one IPv6 value falls in a blocked CIDR; IPv4-mapped addresses are judged as IPv4. */
export function isBlockedIpv6Value(value: bigint): boolean {
  const mapped = ipv4MappedValue(value)
  if (mapped !== undefined) return isBlockedIpv4Value(mapped)
  return BLOCKED_V6.some((candidate) => (value >> BigInt(128 - candidate.bits)) === (candidate.base >> BigInt(128 - candidate.bits)))
}

/** Whether a normalized (bracket- and trailing-dot-stripped) hostname is a localhost variant. */
export function isLocalhostVariant(name: string): boolean {
  return name === 'localhost' || name.endsWith('.localhost') || name === 'localhost.localdomain'
}

/** One resolved address. */
export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

/** Resolver seam: every address for one hostname (injectable for tests). */
export type AddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

const systemResolver: AddressResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true })
  return addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }))
}

/** Rejection wording for blocked hosts; never carries response statuses or internal facts. */
export const IMAGE_URL_NOT_ALLOWED = 'describe-image: image URL target is not allowed'

/** Rejection wording when a domain cannot be resolved; the guard fails closed. */
export const IMAGE_URL_UNRESOLVABLE = 'describe-image: image URL target could not be resolved'

/**
 * Assert one http(s) URL may be fetched by the tool: its host must not be a private,
 * loopback, link-local, or reserved address — as a literal IP or through DNS resolution.
 * @param rawUrl - the complete http(s) URL.
 * @param resolve - address resolver (defaults to the system resolver).
 * @throws `IMAGE_URL_NOT_ALLOWED` for blocked hosts, `IMAGE_URL_UNRESOLVABLE` when a domain
 * cannot be resolved.
 */
export async function assertImageUrlAllowed(rawUrl: string, resolve: AddressResolver = systemResolver): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(IMAGE_URL_NOT_ALLOWED)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(IMAGE_URL_NOT_ALLOWED)
  const hostname = url.hostname.toLowerCase()
  // The shared loopback fence covers `localhost`, `[::1]`, and dotted 127/8.
  if (isLoopbackHostname(hostname)) throw new Error(IMAGE_URL_NOT_ALLOWED)
  const name = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (name === '' || isLocalhostVariant(name)) throw new Error(IMAGE_URL_NOT_ALLOWED)
  const v4 = ipv4ToInt(name)
  if (v4 !== undefined) {
    if (isBlockedIpv4Value(v4)) throw new Error(IMAGE_URL_NOT_ALLOWED)
    return
  }
  if (name.includes(':')) {
    const v6 = ipv6ToInt(name)
    if (v6 === undefined || isBlockedIpv6Value(v6)) throw new Error(IMAGE_URL_NOT_ALLOWED)
    return
  }
  let addresses: readonly ResolvedAddress[]
  try {
    addresses = await resolve(name)
  } catch {
    throw new Error(IMAGE_URL_UNRESOLVABLE)
  }
  for (const entry of addresses) {
    const blocked = entry.family === 4
      ? isBlockedIpv4Value(ipv4ToInt(entry.address) ?? 0n)
      : isBlockedIpv6Value(ipv6ToInt(entry.address) ?? 0n)
    if (blocked) throw new Error(IMAGE_URL_NOT_ALLOWED)
  }
}
