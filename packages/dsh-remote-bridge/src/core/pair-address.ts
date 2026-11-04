/**
 * Which kind of address a located pairing origin is, decided in one place
 * because two halves answer with the same word: the panel states the kind to the
 * operator, and the Host log names it beside the machine-local link.
 *
 * The host's own answer comes first, and the literal decides when it did not: a
 * configured base can name a private address — the package README calls
 * `DSH_REMOTE_PUBLIC_BASE_URL` a public or LAN origin — and a surface that
 * called such an address public would promise a phone something it cannot reach
 * from outside. The pattern is anchored to the whole hostname on purpose: a
 * public name that merely starts like a private literal (`10.example.com`) is
 * not one, and printing it is the one thing the address line must never do.
 * Every value this module cannot place reads as public, which is the direction
 * that prints nothing.
 * @module dsh-remote-bridge/core/pair-address
 */

/** Where the host's own answer says a located origin came from. */
export type PairOriginSource = 'realtime' | 'env' | 'lan'

/**
 * Hosts a phone can only reach from the same network: the private IPv4 ranges,
 * the unspecified address, and the IPv6 loopback, unique-local and link-local
 * prefixes. IPv4-mapped IPv6 and anything else this does not place stays public,
 * because the failure this predicate may never have is printing a name the host
 * did not vouch for.
 */
const LAN_HOST_RE = /^(?:localhost|0\.0\.0\.0|(?:(?:10|127)(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2})|\[(?:::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)[0-9a-f:]*\])$/i

/** The hostname a URL carries, or null when the value is not a URL at all. */
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}

/**
 * Whether a located origin answers only inside this network.
 * @param origin - the located origin, or null when there is none.
 * @param source - where the host said that origin came from.
 * @returns true when a phone must be on the same network to dial it.
 */
export function isLanOrigin(origin: string | null, source: PairOriginSource | null): boolean {
  if (source === 'lan') return true
  if (origin === null) return false
  const host = hostnameOf(origin)
  return host !== null && LAN_HOST_RE.test(host)
}
