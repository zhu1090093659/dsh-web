/**
 * Shared JSON body/response helpers for the host route families: one strict
 * bounded body reader, one lenient bounded body reader, one JSON object
 * narrow, and one JSON writer. Previously these were copy-pasted across the
 * package route files (routes.ts, update-routes.ts, mobile-api.ts, and each
 * family's route module) with drifting contracts: body caps ranging 4 KiB to
 * 1 MiB and four distinct overflow behaviors (reject, undefined, null, throw).
 *
 * Packages receive this file as a generated copy via scripts/sync-shared.mjs;
 * edit this shared source and re-run the sync instead of editing a copy.
 * Consumer code is migrated onto it in follow-up waves; no call site changes
 * belong in the same change as its introduction.
 * @module dsh-web-shared/host/http
 */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'

/** Default body cap for readJsonBody: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024

/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
} satisfies OutgoingHttpHeaders

/**
 * Strict bounded body reader: parse a request body of at most maxBytes as
 * JSON.
 * @throws 'body too large' past the cap, or the JSON.parse error for an
 *   invalid or empty payload.
 */
export async function readBoundedJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) throw new Error('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Lenient bounded body reader: parse a request body as JSON, or null on an
 * empty body, invalid JSON, or a body past maxBytes (default 64 KiB).
 * Overflow destroys the request instead of draining the remainder (no drain
 * call, matching the current repo-wide behavior); callers must not keep
 * reading the request afterwards. With objectOnly, non-JSON-object payloads
 * also yield null.
 */
export async function readJsonBody(
  req: IncomingMessage,
  opts: { maxBytes?: number; objectOnly?: boolean } = {},
): Promise<unknown | null> {
  const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (opts.objectOnly && !isJsonObject(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** Whether a value is a JSON object: typeof object, not null, not an array. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a value to a JSON object, or undefined when it is not one. */
export function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  return isJsonObject(value) ? value : undefined
}

/**
 * Write one JSON response. Default headers are the family defaults
 * (content-type and referrer-policy); caller headers are appended or
 * override them.
 */
export function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { ...JSON_HEADERS, ...headers })
  res.end(payload)
}
