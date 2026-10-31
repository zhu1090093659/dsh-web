/**
 * The public origin a phone should dial, discovered rather than asked for.
 *
 * A pairing code is far better when it carries the address too: the phone then
 * needs one scan and no typing. This module is where that address comes from,
 * in the order this bridge can actually vouch for:
 *
 * 1. **This bridge's own live public face**, handed in as a seam: a relay lease
 *    plus a landed Worker registration, or a tunnel that reports it is running.
 *    It is a fact about this process right now, so it answers first.
 * 2. `DSH_REMOTE_PUBLIC_BASE_URL` — the same environment contract
 *    `dsh-remote-web-ui` reads for its own public base.
 * 3. The LAN literal — this machine's own LAN address plus the bound port. A
 *    phone on the same network can dial it, which is the whole point of the
 *    pairing code.
 *
 * There is deliberately no fourth source. A relay identity file on disk would
 * only prove that this machine once minted an id; it says nothing about whether
 * the Worker's row points at something reachable (the registration may have
 * failed, the lease may never have been claimed, the relay may be off), so
 * turning it into an origin would hand the QR a subdomain that cannot answer.
 * The live facts above already cover every state the bridge can be in, and
 * dropping the file also drops this package's last data dependency on the
 * sibling plugin's home directory.
 *
 * The live source arrives as a seam: this module stays a pure function of what
 * it is handed and never reads a socket, a timer or a file. Nothing here
 * reaches the network, and nothing here mints or spends anything.
 * @module dsh-remote-bridge/host/pair-origin
 */

/** One discovered origin and the fact that produced it. */
export interface PairOriginFacts {
  /** Origin only, no path: `wss://<id>.dsh-market.com`. */
  readonly origin: string
  /** Where the answer came from, for the panel and the log. */
  readonly source: 'realtime' | 'env' | 'lan'
}

/** This machine's LAN address and the port a peer dials it on. */
export interface PairOriginLanTarget {
  readonly address: string
  readonly port: number
}

export interface DiscoverPairOriginOptions {
  /** Environment to read; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /**
   * This bridge's own live public origin (a relay lease's hostname or a running
   * tunnel's URL); undefined while neither is up. Called at most once.
   */
  readonly realtime?: () => string | undefined
  /** The LAN literal to fall back to when no public origin is known. */
  readonly lan?: () => PairOriginLanTarget | undefined
}

/** Trim trailing slashes so the caller can append a path unconditionally. */
function originOf(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * Discover the public origin of this instance.
 * @param options - environment and the two live seams for tests.
 * @returns the origin and its source, or `undefined` when nothing is known.
 */
export function discoverPairOrigin(options: DiscoverPairOriginOptions = {}): PairOriginFacts | undefined {
  const env = options.env ?? process.env
  const realtime = options.realtime?.()
  if (realtime !== undefined && realtime.trim() !== '') {
    return { origin: originOf(realtime.trim()), source: 'realtime' }
  }

  const configured = env.DSH_REMOTE_PUBLIC_BASE_URL?.trim()
  if (configured !== undefined && configured !== '') return { origin: originOf(configured), source: 'env' }

  const lan = options.lan?.()
  if (lan !== undefined && lan.address.trim() !== '' && Number.isFinite(lan.port)) {
    return { origin: `http://${lan.address.trim()}:${String(lan.port)}`, source: 'lan' }
  }
  return undefined
}
