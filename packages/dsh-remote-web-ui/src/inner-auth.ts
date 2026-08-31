/**
 * The inner browser credential for the remote desktop channel. The proxied
 * /api re-issues requests to 127.0.0.1, where the connection plugin's route
 * enforces the harness browser-auth cookie — an authority-bound signed cookie
 * with no loopback exemption on this cohort line, so a cookie minted for the
 * device's own authority can never satisfy the inner check. The process
 * therefore redeems its own launch token (the same one-time exchange every
 * paired device's first navigation performs) and attaches the resulting
 * cookie to inner requests. The credential is only ever exercised behind the
 * pairing gate: while requirePairingForLan is on, every proxied call already
 * carried a live paired-device cookie before this module is consulted.
 */

/** Browser-auth credential the proxy attaches to loopback-bound requests. */
export interface InnerAuth {
  /**
   * Resolve the `name=value` cookie pair for inner requests, or undefined
   * when the launch token is unavailable (the proxy then sends without a
   * credential and the inner route answers 401, exactly as before).
   */
  ready(): Promise<string | undefined>
  /** Drop the cached credential; the next ready() re-redeems. */
  invalidate(): void
}

/** The harness browser-auth cookie name prefix (see dsh-client-connection). */
const BROWSER_AUTH_COOKIE_PREFIX = 'dsh-auth-'

/**
 * Build the inner-auth handle.
 * @param launchUrl - the launch-token URL for the inner loopback authority
 *   (the connection service's authenticatedUrl of `http://127.0.0.1:<port>/`),
 *   or undefined when the connection service or port is unavailable.
 * @param fetchImpl - injectable fetch (tests).
 */
export function createInnerAuth(
  launchUrl: () => string | undefined,
  fetchImpl: typeof fetch = fetch,
): InnerAuth {
  let cached: string | undefined
  let inflight: Promise<string | undefined> | undefined

  const redeem = async (): Promise<string | undefined> => {
    const url = launchUrl()
    if (url === undefined) return undefined
    try {
      // redirect: 'manual' keeps the 303's set-cookie readable instead of
      // following it; the exchange itself is a plain GET with the token in
      // the query, exactly what a first browser visit performs.
      const response = await fetchImpl(url, { redirect: 'manual' })
      const raw = response.headers.get('set-cookie')
      if (raw === null) return undefined
      // Generated cookie values are base64url and never contain commas, so a
      // comma split followed by a prefix match finds the browser-auth entry
      // even when the exchange sets several cookies.
      const entry = raw
        .split(',')
        .map((part) => part.trim())
        .find((part) => part.startsWith(BROWSER_AUTH_COOKIE_PREFIX))
      if (entry === undefined) return undefined
      const pair = entry.split(';')[0]?.trim()
      return pair !== undefined && pair.includes('=') ? pair : undefined
    } catch {
      return undefined
    }
  }

  return {
    ready(): Promise<string | undefined> {
      if (cached !== undefined) return Promise.resolve(cached)
      inflight ??= redeem().then((value) => {
        if (value !== undefined) cached = value
        inflight = undefined
        return value
      }, () => {
        inflight = undefined
        return undefined
      })
      return inflight
    },
    invalidate(): void {
      cached = undefined
    },
  }
}
