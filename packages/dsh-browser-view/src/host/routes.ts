/**
 * The /api/dsh-browser-view route family: one status route and the panel
 * WebSocket.
 *
 * The socket is push-only once it is open — the host sends frames, state, and
 * action traces, and the panel sends four small commands — so the protocol is a
 * plain JSON text frame in both directions rather than a second sub-protocol.
 *
 * Two gates sit in front of every accepted command.
 *
 * Loopback. Both the route and the upgrade refuse a non-loopback request with
 * 403 and destroy the socket. This surface drives a browser on the host
 * machine, so an LAN-exposed GUI must not serve it.
 *
 * Version. The FIRST frame must declare {@link BROWSER_VIEW_API_VERSION}; a
 * mismatch closes the socket instead of accepting commands whose meaning we
 * cannot know. Later malformed frames only produce an error event, because by
 * then the panel is known-good and a close would cost it its stream.
 *
 * @module @linxin666/dsh-client-ui-browser-view/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  BROWSER_VIEW_API_VERSION,
  BROWSER_VIEW_SOCKET_PATH,
  isBrowserViewCommand,
  type BrowserViewCommand,
  type BrowserViewEvent,
} from '../core/protocol.ts'
import { isLoopbackRequest } from './loopback.ts'
import type { BrowserViewBackend, BrowserViewSink } from './service.ts'

/** Status route of the family; the panel's fallback probe when the socket fails. */
export const BROWSER_VIEW_STATE_PATH = '/api/dsh-browser-view/state'

/**
 * A route that declares its own admission policy. Post-#8266 Host versions
 * default every route to `auth: 'required'`; the field is optional here so
 * this package still compiles against the 0.2.2-rc.3 SDK types, which do not
 * declare it.
 */
type AuthAwareWebRoute = WebRoute & { readonly auth?: 'anonymous' | 'required' | 'deny' }
type AuthAwareUpgradeRoute = WebUpgradeRoute & { readonly auth?: 'anonymous' | 'required' | 'deny' }

/** Close code used when the panel speaks a contract version we do not have. */
export const PROTOCOL_MISMATCH_CLOSE_CODE = 1002

/** One noServer WebSocket server: the webserver hands us the raw upgraded socket. */
const browserViewWss = new WebSocketServer({ noServer: true })

/**
 * Send one error event to a panel.
 * @param sink - the socket adapter.
 * @param code - stable machine code.
 * @param message - human text, never a stack trace.
 */
export function sendError(sink: BrowserViewSink, code: string, message: string): void {
  const event: BrowserViewEvent = { v: 1, kind: 'error', code, message }
  sink.send(event)
}

/**
 * Decode one panel frame.
 * @param raw - the frame's text.
 * @returns the parsed value, or undefined when it is not JSON.
 */
export function decodeFrame(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/**
 * Run one inbound panel frame through the version and shape gates.
 *
 * Exported so tests can exercise the gate without a socket: the socket path and
 * the gate must not drift apart.
 * @param backend - the service that executes accepted commands.
 * @param sink - the socket adapter the frame arrived on.
 * @param raw - the frame's text.
 * @param first - whether this is the socket's first frame.
 * @returns what the caller should do next: keep the socket, or close it.
 */
export async function handleClientFrame(
  backend: BrowserViewBackend,
  sink: BrowserViewSink,
  raw: string,
  first: boolean,
): Promise<'accept' | 'close'> {
  const value = decodeFrame(raw)
  if (value === null || typeof value !== 'object') {
    sendError(sink, 'invalid-payload', 'expected a JSON object')
    return first ? 'close' : 'accept'
  }
  const version = (value as { v?: unknown }).v
  if (first && version !== BROWSER_VIEW_API_VERSION) {
    sendError(
      sink,
      'protocol-mismatch',
      `unsupported protocol version ${String(version)}; this host speaks version ${BROWSER_VIEW_API_VERSION}`,
    )
    return 'close'
  }
  if (version !== BROWSER_VIEW_API_VERSION) {
    sendError(
      sink,
      'protocol-mismatch',
      `unsupported protocol version ${String(version)}; this host speaks version ${BROWSER_VIEW_API_VERSION}`,
    )
    return 'accept'
  }
  if (!isBrowserViewCommand(value)) {
    sendError(sink, 'invalid-command', `unsupported command ${String((value as { kind?: unknown }).kind)}`)
    return 'accept'
  }
  await backend.handleCommand(sink, value as BrowserViewCommand)
  return 'accept'
}

/**
 * Adapt one accepted WebSocket to the service's sink contract.
 * @param socket - the upgraded socket.
 * @returns the sink.
 */
export function socketSink(socket: WebSocket): BrowserViewSink {
  return {
    send(event: BrowserViewEvent): void {
      // A closed socket is not an error: the panel simply navigated away.
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(event))
    },
    close(): void {
      try {
        socket.close(1000)
      } catch {
        // Already closing; nothing left to release.
      }
    },
  }
}

/** Route family dependencies. */
export interface BrowserViewRoutesDeps {
  /** The browser service (tests pass a stub). */
  backend: BrowserViewBackend
}

/**
 * Build the route family and its upgrade.
 * @param deps - the backend the socket commands reach.
 * @returns exact routes plus the socket upgrade.
 */
export function makeRoutes(deps: BrowserViewRoutesDeps): { routes: WebRoute[]; upgrade: WebUpgradeRoute } {
  // The declarations above add admission policy for hosts that enforce it; the
  // exported shape stays the SDK's own route type, which that host accepts.
  const { backend } = deps

  const routes: AuthAwareWebRoute[] = [
    {
      kind: 'exact',
      path: BROWSER_VIEW_STATE_PATH,
      // Self-fenced by isLoopbackRequest below; anonymous admission keeps the
      // route reachable on hosts that default unspecified routes to required.
      auth: 'anonymous',
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
          return
        }
        writeJson(res, 200, { state: backend.state() })
      },
    },
  ]

  const upgrade: AuthAwareUpgradeRoute = {
    path: BROWSER_VIEW_SOCKET_PATH,
    // Same loopback fence as the state route, applied to the handshake below.
    auth: 'anonymous',
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isLoopbackRequest(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      browserViewWss.handleUpgrade(req, socket, head, (accepted) => {
        const sink = socketSink(accepted)
        let first = true
        const detach = backend.attach(sink)
        accepted.on('message', (data: WebSocket.RawData) => {
          const raw = data.toString()
          void handleClientFrame(backend, sink, raw, first).then((next) => {
            first = false
            if (next === 'close') {
              try {
                accepted.close(PROTOCOL_MISMATCH_CLOSE_CODE)
              } catch {
                // The peer may have dropped already.
              }
            }
          }).catch(() => {
            sendError(sink, 'command-failed', 'the host could not run that command')
          })
        })
        accepted.on('close', () => { detach() })
        accepted.on('error', () => { detach() })
      })
    },
  }

  return { routes, upgrade }
}

/** Write one JSON response with the shared no-referrer header. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}
