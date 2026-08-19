/** Keyless local HTTP fixture: one address the tests point the vision endpoint (and image URLs) at. */

import { createServer } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'

/**
 * A no-op webServer service for tests: the plugin declares `webServer` in
 * its inject list (cordis activates the plugin only once the service is
 * available, which is how the attach route registers in production), so
 * every boot that applies the plugin must mount one.
 */
export class FakeWebServer extends Service {
  readonly routes: Array<{ kind: string; path: string }> = []
  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }
  register(route: { kind: string; path: string }): () => void {
    this.routes.push(route)
    return () => {
      const at = this.routes.indexOf(route)
      if (at !== -1) this.routes.splice(at, 1)
    }
  }
  registerUpgrade(): () => void { return () => {} }
  registerFallback(): () => void { return () => {} }
  tapIndex(): () => void { return () => {} }
}
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One request the fixture recorded: path, auth headers, and parsed (or raw) body. */
export interface RecordedRequest {
  path: string
  authorization: string | undefined
  xApiKey: string | undefined
  anthropicVersion: string | undefined
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
      const request: RecordedRequest = {
        path: req.url ?? '',
        authorization: req.headers.authorization,
        xApiKey: Array.isArray(req.headers['x-api-key']) ? req.headers['x-api-key'][0] : req.headers['x-api-key'],
        anthropicVersion: Array.isArray(req.headers['anthropic-version']) ? req.headers['anthropic-version'][0] : req.headers['anthropic-version'],
        body,
      }
      requests.push(request)
      handler(request, res)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      // Idempotent: one case closes early to stage an unreachable endpoint,
      // then the teardown sweep closes every server again.
      let closed: Promise<void> | undefined
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        request: (index: number): RecordedRequest => {
          const found = requests[index]
          if (found === undefined) throw new Error(`mock server recorded no request at index ${index}`)
          return found
        },
        close: () => {
          if (closed === undefined) {
            closed = new Promise<void>((ok, fail) => {
              server.close((error) => {
                if (error) fail(error)
                else ok()
              })
            })
          }
          return closed
        },
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

/** An OpenAI Responses payload whose first output item is an assistant message answering `content`. */
export function responsesReply(content: unknown): unknown {
  return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: content }] }] }
}

/** An Anthropic Messages payload answering `content` as a top-level text block, with a leading thinking block. */
export function anthropicReply(content: unknown): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'vision-1',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: 'reasoning the model keeps private' },
      { type: 'text', text: content },
    ],
  }
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

/** The request body the Responses style is expected to send: `input[0].content` as the model-visible array. */
export function sentInputContent(request: RecordedRequest): unknown {
  const body = request.body as { input?: Array<{ content?: unknown }> }
  return body?.input?.[0]?.content
}

/** The request body the Anthropic Messages style is expected to send: `messages[0].content` as the model-visible array. */
export function sentAnthropicContent(request: RecordedRequest): unknown {
  const body = request.body as { messages?: Array<{ content?: unknown }> }
  return body?.messages?.[0]?.content
}
