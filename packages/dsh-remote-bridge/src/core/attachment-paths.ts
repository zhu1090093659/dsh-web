/**
 * The image paths one session's own durable transcript whitelists, and the file
 * decisions `session.attachment.path` takes on the one path it is handed.
 *
 * This module IS that method's authorization. The bridge serves bytes only for a
 * path the session itself named, so the whitelist is computed here from that
 * session's store and from nothing else: never a path a client chose, never a
 * directory listing, never a second session.
 *
 * Two sources and no others:
 *   - an offload placeholder in a message body, `<path>…</path>` immediately
 *     followed by `<type>image</type>` — the envelope the harness writes when
 *     it keeps image bytes out of a durable message, and the one a phone already
 *     reads with `OffloadedImages.segments(of:)`;
 *   - the image reference of a durable tool result — `meta.path`, what
 *     `read_image` publishes through its `output.presentationMeta`, or a
 *     text block that is itself a JSON image reference, which is how a
 *     `run_code` program's own return value is persisted — and what a client
 *     draws as `ToolBlock.image(ImageRef(path:))`.
 *
 * A path either source names is kept only when it is a host absolute path: the
 * request side admits nothing else, so a name that could never be asked for —
 * a plugin's own namespace, a relative path — is not a whitelist entry.
 *
 * Records are the ones `session/page` answers and `turnsOfRecords`
 * projects: `{event: {type, seq, time, data}}`.
 * @module dsh-remote-bridge/core/attachment-paths
 */

import { isAbsolute } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { FRAME_TOO_LARGE, MAX_FRAME_BYTES } from './envelope.ts'
import { CODE_ATTACHMENT_NOT_FOUND, CODE_NOT_AN_IMAGE, CODE_PATH_NOT_IN_SESSION } from './protocol.ts'

/** One image a session's transcript names: the reference a client already drew. */
export interface AttachmentFacts {
  /** The absolute path, byte for byte as the transcript wrote it. */
  readonly path: string
  readonly mediaType?: string
  readonly bytes?: number
  readonly width?: number
  readonly height?: number
}

/**
 * `<path>…</path>` immediately followed by `<type>image</type>`, plus
 * the facts the `<content>` body beside them states when it states any.
 */
const OFFLOAD_PLACEHOLDER = /<path>([^<]*)<\/path>\s*<type>image<\/type>\s*(?:<content>\s*([^<]*?)\s*<\/content>)?/gu

/** One envelope body: `image/jpeg image, 1600x1000 px, 93031 bytes`. */
const ENVELOPE_FACTS = /^(\S+)\s+image,\s*(\d+)x(\d+)\s+px,\s*(\d+)\s+bytes/u

/** The four heads a durable image may declare, byte for byte. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const GIF_SIGNATURES = [Buffer.from('GIF87a', 'ascii'), Buffer.from('GIF89a', 'ascii')]
const RIFF_SIGNATURE = Buffer.from('RIFF', 'ascii')
const WEBP_SIGNATURE = Buffer.from('WEBP', 'ascii')

/** One whitelisted path's bytes, or the code that refused them. */
export type AttachmentRead =
  | { readonly ok: true; readonly image: AttachmentFacts; readonly data: string }
  | { readonly ok: false; readonly code: string; readonly msg: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One durable record's `type` and `data`, or undefined when it is not one. */
function entryOf(record: unknown): { readonly type: string; readonly data: unknown } | undefined {
  const event = isRecord(record) ? record.event : undefined
  if (!isRecord(event) || typeof event.type !== 'string') return undefined
  return { type: event.type, data: event.data }
}

/**
 * The oldest entry seq one store page carries.
 *
 * A page read walks backwards by this number, so the walk has to read it off the
 * page itself: the store's own `hasMore` says that older entries exist,
 * never where they end.
 * @param records - one `session/page` answer's records.
 * @returns the smallest `event.seq` they carry, or undefined when they carry none.
 */
export function oldestSeqOf(records: readonly unknown[]): number | undefined {
  let oldest: number | undefined
  for (const record of records) {
    const seq = isRecord(record) && isRecord(record.event) ? record.event.seq : undefined
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq)) continue
    if (oldest === undefined || seq < oldest) oldest = seq
  }
  return oldest
}

/**
 * Every image path one session's durable records whitelist.
 * @param records - that session's own records, as `session/page` answered them.
 * @returns one entry per path; a second sighting never erases a stated fact.
 */
export function attachmentPathsOf(records: readonly unknown[]): Map<string, AttachmentFacts> {
  const found = new Map<string, AttachmentFacts>()
  for (const record of records) {
    const entry = entryOf(record)
    if (entry === undefined) continue
    // A message body. The harness writes the envelope into the INPUT message that
    // carried the image, so only `user/message` is read: an assistant message
    // is model output, and reading one would whitelist a path the model merely wrote.
    if (entry.type === 'user/message') {
      for (const facts of placeholderFacts(entry.data)) remember(found, facts)
      continue
    }
    // A durable tool result. `tool/ptc-dispatch` is the same record for a
    // tool a `run_code` program called, so both shapes of one result are read.
    if (entry.type !== 'tool/result' && entry.type !== 'tool/ptc-dispatch') continue
    const path = toolResultImagePath(entry.data)
    if (path !== undefined) remember(found, { path })
  }
  return found
}

/** The facts every offload placeholder of one message body states, in body order. */
function placeholderFacts(data: unknown): AttachmentFacts[] {
  if (!isRecord(data) || !Array.isArray(data.content)) return []
  const found: AttachmentFacts[] = []
  for (const block of data.content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue
    for (const match of block.text.matchAll(OFFLOAD_PLACEHOLDER)) {
      const path = match[1] ?? ''
      if (path === '') continue
      found.push({ path, ...envelopeFacts(match[2]) })
    }
  }
  return found
}

/** The facts one `<content>` body states, or nothing when it states none. */
function envelopeFacts(body: string | undefined): Omit<AttachmentFacts, 'path'> {
  const stated = body === undefined ? null : ENVELOPE_FACTS.exec(body.trim())
  if (stated === null) return {}
  return { mediaType: stated[1] ?? '', width: Number(stated[2]), height: Number(stated[3]), bytes: Number(stated[4]) }
}

/**
 * The image reference one durable tool result states, or undefined.
 *
 * Two readings, the first that hits wins:
 *   - `meta.path`, what `read_image` publishes through its
 *     `output.presentationMeta` — kept only when the same result carried the
 *     image block it names, because `read` publishes a `meta.path` of its
 *     own and a session must not whitelist every file it ever read as text;
 *   - a text block that IS a JSON image reference,
 *     `{path, image:{attachmentId, mediaType, bytes, width, height, name}}` —
 *     the shape a `run_code` program's own return value is persisted as.
 *
 * The JSON reading keeps its gate: the parsed object has to carry an `image`
 * object whose `mediaType` starts with `image/`. That gate is exactly what
 * separates a result that published an image from one that merely named a file —
 * measured over this host's whole store, 83 tool results carry a bare `path`
 * in the same JSON shape against 10 image references — and a path a tool named is
 * not an image this session offloaded.
 *
 * What is read is the reference the TOOL published, never the call's own argument
 * and never prose a model wrote: an argument is what the model asked for, and a
 * model's own words are not a record of anything.
 */
function toolResultImagePath(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  const content = isRecord(data.message) ? data.message.content : data.content
  return publishedImagePath(data.meta, content) ?? jsonImageReference(content)
}

/** `meta.path`, but only when the same result carried the image block it names. */
function publishedImagePath(meta: unknown, content: unknown): string | undefined {
  const path = isRecord(meta) ? meta.path : undefined
  if (typeof path !== 'string' || path === '') return undefined
  if (!Array.isArray(content) || !content.some(block => isRecord(block) && block.type === 'image')) return undefined
  return path
}

/** The path one text block states as a JSON image reference, or undefined. */
function jsonImageReference(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(block.text)
    } catch {
      continue
    }
    if (!isRecord(parsed)) continue
    const path = parsed.path
    const image = parsed.image
    if (typeof path !== 'string' || path === '') continue
    if (!isRecord(image) || typeof image.mediaType !== 'string' || !image.mediaType.startsWith('image/')) continue
    return path
  }
  return undefined
}

/**
 * Remember one sighting, or drop it.
 *
 * A path that is not a host absolute path is not a whitelist entry at all. A
 * request has to name an absolute path, so `browser-view:screenshot/<tab>.png`
 * — the plugin-namespace name `browser_screenshot` writes into its envelope,
 * with no file behind it — could never be asked for, and a list of names no
 * request can match is not a whitelist. What an entry keeps is the reading that
 * states more: a later sighting never erases a stated fact.
 */
function remember(found: Map<string, AttachmentFacts>, facts: AttachmentFacts): void {
  if (!isAbsolute(facts.path)) return
  const previous = found.get(facts.path)
  if (previous === undefined || (facts.mediaType !== undefined && previous.mediaType === undefined)) {
    found.set(facts.path, facts)
  }
}

/**
 * The media type one head declares, or undefined when it is none of the four.
 *
 * The signatures are the harness's own four — PNG, JPEG, GIF87a/89a and
 * RIFF-WebP — because the bytes are what a client will decode.
 * @param head - the file's first bytes, as read.
 * @returns the media type, or undefined.
 */
export function mediaTypeOfSignature(head: Buffer): string | undefined {
  if (head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png'
  if (head.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'image/jpeg'
  if (GIF_SIGNATURES.some(signature => head.subarray(0, signature.length).equals(signature))) return 'image/gif'
  if (head.subarray(0, RIFF_SIGNATURE.length).equals(RIFF_SIGNATURE) && head.subarray(8, 12).equals(WEBP_SIGNATURE)) return 'image/webp'
  return undefined
}

/**
 * Read one whitelisted path, applying the three file decisions in order.
 *
 * The whitelist is the first decision and it is not this function's: a caller
 * hands over a path it already matched byte for byte. What is left is whether the
 * file at that path is still the one the session named — `realpath()` has to
 * return the same string, so a symlink pointing anywhere else is refused rather
 * than followed — whether it is a regular file at all, and whether its own first
 * bytes are one of the four image signatures. The extension is never consulted: a
 * `.png` that is not a PNG is refused, and a PNG named `.txt` is served.
 *
 * The answer's `image` is the reference the session's transcript named; this
 * read measures nothing into it. The magic decides, and the bytes are what crosses.
 * @param facts - the whitelist entry the request matched.
 * @returns the bytes as base64, or the refusal the first failing decision states.
 */
export async function readAttachment(facts: AttachmentFacts): Promise<AttachmentRead> {
  const path = facts.path
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch {
    // Gone, unreadable, or a parent that is not a directory: either way there is
    // no file at this path, which is the one thing `not-found` states.
    return { ok: false, code: CODE_ATTACHMENT_NOT_FOUND, msg: 'no file at ' + path }
  }
  if (resolved !== path) {
    return { ok: false, code: CODE_PATH_NOT_IN_SESSION, msg: path + ' resolves to ' + resolved + ', which this session never named' }
  }
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, code: CODE_ATTACHMENT_NOT_FOUND, msg: path + ' is not a regular file' }
    size = info.size
  } catch {
    return { ok: false, code: CODE_ATTACHMENT_NOT_FOUND, msg: 'no file at ' + path }
  }
  // Base64 inflates by a third, so a file at or past the frame cap cannot fit one
  // whatever the envelope costs: refused before it is read into memory.
  if (size >= MAX_FRAME_BYTES) {
    return { ok: false, code: FRAME_TOO_LARGE, msg: path + ' is ' + String(size) + ' bytes, past the ' + String(MAX_FRAME_BYTES) + ' byte frame' }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return { ok: false, code: CODE_ATTACHMENT_NOT_FOUND, msg: 'no file at ' + path }
  }
  if (mediaTypeOfSignature(bytes) === undefined) {
    return { ok: false, code: CODE_NOT_AN_IMAGE, msg: path + ' is not a PNG, JPEG, WebP or GIF' }
  }
  return { ok: true, image: facts, data: bytes.toString('base64') }
}
