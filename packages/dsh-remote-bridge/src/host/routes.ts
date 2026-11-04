/**
 * The bootstrap token endpoint an operator reaches from the Host itself.
 *
 * It is a named route on the host web server at one exact path, and it is the
 * only place a bootstrap token is ever minted. Admission is the two-condition
 * loopback gate in `core/loopback.ts` (socket address AND Host header); the
 * token itself is one-shot with a 30 s lifetime, and the same link is printed
 * to the Host log so an operator can open it from the machine.
 * @module dsh-remote-bridge/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { loopbackDenialOf } from '../core/loopback.ts'
import { PAIR_TOKEN_PATH, WS_PATH } from '../core/protocol.ts'
import type { PairingService } from '../core/pairing.ts'
import { discoverPairOrigin, type PairOriginFacts } from './pair-origin.ts'

export interface PairTokenRouteDeps {
  readonly pairing: PairingService
  readonly log: (message: string) => void
  /**
   * 桥自己此刻的公网入口（relay 租约的 hostname 或隧道的 running URL），由接线方
   * 注入：本模块不认识隧道与租约，只按顺序问地址。返回实时快照，不缓存。
   */
  readonly realtime?: () => string | undefined
  /** 无公网时的局域网兜底：本机地址与 webServer 端口。 */
  readonly lan?: () => { address: string; port: number } | undefined
  /** Origin discovery seam; defaults to {@link discoverPairOrigin} over the two seams above. */
  readonly pairOrigin?: () => PairOriginFacts | undefined
  /**
   * 桌面端打开配对面板（或本机请求一次性令牌）时的钩子：尚未配对任何设备且未开隧道的
   * 宿主在此时按需触发一次租约申领，避免无人使用远程功能时后台空转。
   */
  readonly onPairTokenIssued?: () => void
}

/** Write one JSON response. The family's shared reader/writer is not copied into this package. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(text)
}

/** The schemes one discovered origin can carry, and the socket scheme it dials. */
const DIAL_SCHEME: Readonly<Record<string, string>> = { 'https://': 'wss://', 'http://': 'ws://' }

/**
 * The WebSocket URL a phone dials for one one-shot ticket.
 *
 * `origin` names where this host is reachable (`https://<id>.dsh-market.com`,
 * `http://192.168.1.5:3080`), but the handshake this URL opens is a WebSocket
 * one: the scheme follows the transport, so https becomes wss and http becomes
 * ws. Keeping the origin's own scheme would hand the client an HTTP URL and ask
 * it to dial a socket with it.
 * @param origin - the discovered origin, with or without the scheme.
 * @param token - the one-shot ticket to carry in the query.
 * @returns the URL the pairing QR encodes.
 */
export function pairingDialUrlOf(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '')
  let dial = base
  for (const [scheme, socket] of Object.entries(DIAL_SCHEME)) {
    if (base.startsWith(scheme)) {
      dial = socket + base.slice(scheme.length)
      break
    }
  }
  return dial + WS_PATH + '?token=' + token
}

/**
 * Build the handler for `GET /remote-bridge/pair/token`.
 * @param deps - the pairing service that mints the token, plus the Host log.
 * @returns the handler; the caller owns route registration.
 */
export function makePairTokenHandler(deps: PairTokenRouteDeps): WebRoute['handler'] {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const denial = loopbackDenialOf(req)
    if (denial !== undefined) {
      writeJson(res, 403, { ok: false, error: 'forbidden', reason: denial })
      return
    }
    if ((req.method ?? 'GET') !== 'GET') {
      res.writeHead(405, { allow: 'GET' })
      res.end()
      return
    }
    try {
      deps.onPairTokenIssued?.()
    } catch {
      // 触发后台租约申领失败绝不能影响本机取配对码。
    }
    const ticket = deps.pairing.issueToken()
    // The link a client ON THIS MACHINE can open directly. The token rides the
    // query because a WebSocket handshake started from a share sheet cannot set
    // a header; the connection it opens is UNPAIRED, which is exactly what
    // `pair.begin` needs.
    const host = req.headers.host ?? '127.0.0.1'
    const url = `ws://${host}${WS_PATH}?token=${ticket.value}`
    // The link the PHONE should dial, when this machine knows its own public
    // origin. `pairingUrl` is what a QR should carry: the iOS client parses
    // `{token, url}` and adopts the origin from `url`, so one scan sets both.
    //
    // The origin comes from the live-first discovery order (pair-origin.ts): this
    // bridge's own relay lease or running tunnel first, then the configured base,
    // then the LAN forwarder while it is listening. The response shape and the
    // field names are unchanged.
    const discovered = (deps.pairOrigin ?? (() => discoverPairOrigin({
      ...(deps.realtime === undefined ? {} : { realtime: deps.realtime }),
      ...(deps.lan === undefined ? {} : { lan: deps.lan }),
    })))()
    const pairingUrl = discovered === undefined
      ? undefined
      : pairingDialUrlOf(discovered.origin, ticket.value)
    // The log names the machine-local link and, when there is one, only the KIND
    // of phone-facing address. The public hostname is a durable fact that a log
    // line is likely to be pasted with, and the phone reads the address off the
    // QR anyway; the LAN literal is left out for the same reason, because the
    // panel already states it where the operator can see the code.
    const phone = discovered === undefined
      ? ''
      : ` (phone: ${discovered.source === 'lan' ? 'lan' : 'public'})`
    deps.log(`pair a device with ${url}${phone}`)
    writeJson(res, 200, {
      token: ticket.value,
      expiresAt: ticket.expiresAt,
      url,
      ...(discovered === undefined ? {} : { origin: discovered.origin, originSource: discovered.source }),
      ...(pairingUrl === undefined ? {} : { pairingUrl }),
    })
  }
}

/** The route as the host web server takes it: one exact path, no trailing slash. */
export function makePairTokenRoute(deps: PairTokenRouteDeps): WebRoute {
  return { kind: 'exact', path: PAIR_TOKEN_PATH, handler: makePairTokenHandler(deps) }
}
