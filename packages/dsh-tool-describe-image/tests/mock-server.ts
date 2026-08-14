/** Keyless local HTTP fixture: one address the tests point the vision endpoint (and image URLs) at. */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One request the fixture recorded: path, bearer authorization, and parsed (or raw) body. */
export interface RecordedRequest {
  path: string
  authorization: string | undefined
  body: unknown
}

/** The running fixture: its base URL, every recorded request, and a close handle. */
export interface MockServer {
  url: string
  requests: RecordedRequest[]
  /** The request at `index`, throwing when none was recorded — tests assert presence, not absence-of-error. */
  request: (index: number) => RecordedRequest
  close: () => Promise<void>
}

/**
 * Start a local HTTP server whose handler answers every request. Requests are recorded before the
 * handler runs, so a handler that never responds still leaves an observable record.
 * @param handler - receives the recorded request and the raw response.
 * @returns the fixture.
 */
export function startMockServer(handler: (request: RecordedRequest, response: ServerResponse) => void): Promise<MockServer> {
  const requests: RecordedRequest[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown
      try {
        body = raw.length > 0 ? JSON.parse(raw) : undefined
      } catch {
        body = raw
      }
      const request: RecordedRequest = { path: req.url ?? '', authorization: req.headers.authorization, body }
      requests.push(request)
      handler(request, res)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        request: (index: number): RecordedRequest => {
          const found = requests[index]
          if (found === undefined) throw new Error(`mock server recorded no request at index ${index}`)
          return found
        },
        close: () => new Promise<void>((ok, fail) => {
          server.close((error) => {
            if (error) fail(error)
            else ok()
          })
        }),
      })
    })
  })
}

/** Respond with a JSON body. */
export function jsonReply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

/** Respond with a raw body and explicit content type. */
export function rawReply(response: ServerResponse, status: number, body: string | Buffer, contentType = 'application/octet-stream'): void {
  response.writeHead(status, { 'content-type': contentType, 'content-length': String(Buffer.byteLength(body)) })
  response.end(body)
}

/** An OpenAI-compatible chat-completions payload answering "a red square". */
export function chatReply(content: unknown): unknown {
  return { choices: [{ message: { content } }] }
}

/** The smallest PNG this suite uses as a valid image (1x1 transparent pixel). */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** The request body the tool is expected to send: `messages[0].content` as the model-visible array. */
export function sentContent(request: RecordedRequest): unknown {
  const body = request.body as { messages?: Array<{ content?: unknown }> }
  return body?.messages?.[0]?.content
}
