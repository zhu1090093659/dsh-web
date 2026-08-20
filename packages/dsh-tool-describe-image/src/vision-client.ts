/**
 * Vision HTTP client for the describe-image tool: loads one image (local path,
 * http(s) URL, or a stored attachment reference), builds the endpoint request that
 * matches the configured protocol style (chat-completions or responses), and reads
 * back the single text answer — with a short-lifetime, capacity-capped semantic
 * cache so repeat calls for the same image and prompt avoid a second round trip.
 * Response bodies and error excerpts are capped before any bytes are trusted.
 * @module @linxin666/dsh-tool-describe-image/vision
 */

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { ATTACHMENT_REF_GUIDANCE, parseImageAttachmentRef, parseMarkdownAttachmentReference } from './attachment-reference.ts'
import { attachmentRefById } from './attach-routes.ts'
import { DEFAULT_MAX_BYTES, isImageMimeType, sniffMimeType, type ImageMimeType } from './media.ts'
import type { ApiStyle, ResolvedConfig } from './config-resolve.ts'

export { parseImageAttachmentRef } from './attachment-reference.ts'

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: ImageMimeType
}

/** Promise rejection helper shared by both response-shape extractors. */
function unexpectedShape(): never {
  throw new Error('describe-image: vision endpoint returned an unexpected response shape')
}

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Whether `error` carries the attachment store not-found marker. */
function isAttachmentNotFound(error: unknown): boolean {
  return asRecord(error)?.['code'] === 'ATTACHMENT_NOT_FOUND'
}

/**
 * Validate a model-supplied attachment reference and read its verified bytes.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param raw - the raw JSON the model copied from an `[image attachment …]` note.
 * @param signal - caller cancellation.
 * @returns the verified stored bytes.
 */
export async function readAttachment(ctx: Context, raw: string, signal: AbortSignal): Promise<Buffer> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('describe-image: no attachment service is mounted; pass a file path or URL instead')
  }
  const ref = parseImageAttachmentRef(raw)
  try {
    const stored = await attachments.readImage(ref, signal)
    return Buffer.from(stored.data)
  } catch (error) {
    if (isAttachmentNotFound(error)) {
      throw new Error(`describe-image: attachment ${JSON.stringify(ref.attachmentId)} is no longer available`)
    }
    throw error
  }
}

/** Sniff the media type and reject empty or unsupported inputs. */
function toImage(bytes: Buffer, source: string): LoadedImage {
  if (bytes.length === 0) throw new Error(`describe-image: image is empty: ${source}`)
  const mimeType = sniffMimeType(bytes)
  if (mimeType === undefined) {
    throw new Error(`describe-image: unsupported image type (expected PNG, JPEG, GIF, or WebP): ${source}`)
  }
  return { bytes, mimeType }
}

/** Bound-check then sniff one loaded buffer — the shared tail of every input branch. */
function finishLoad(bytes: Buffer, source: string, maxBytes: number): LoadedImage {
  if (bytes.length > maxBytes) {
    throw new Error(`describe-image: image is ${bytes.length} bytes, above the ${maxBytes}-byte bound`)
  }
  return toImage(bytes, source)
}

/**
 * Load one image from a local absolute path, an http(s) URL, a complete durable attachment
 * reference, or the plugin's self-contained Markdown attachment reference, enforcing the byte
 * bound before any bytes reach the vision model. Non-http(s) URL schemes are rejected.
 * @param ctx - registrant context; supplies the optional attachment service.
 * @param input - the model-supplied image reference.
 * @param signal - caller cancellation.
 * @param maxBytes - image byte bound.
 * @returns the loaded bytes and sniffed media type.
 */
export async function loadImage(ctx: Context, input: string, signal: AbortSignal, maxBytes: number): Promise<LoadedImage> {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('describe-image: image must be a non-empty path, URL, or attachment reference')
  const markdownReference = parseMarkdownAttachmentReference(trimmed)
  if (markdownReference !== undefined) {
    const ref = markdownReference.ref ?? attachmentRefById(markdownReference.attachmentId)
    if (ref === undefined) throw new Error(ATTACHMENT_REF_GUIDANCE)
    const bytes = await readAttachment(ctx, JSON.stringify(ref), signal)
    return finishLoad(bytes, trimmed.slice(0, 96), maxBytes)
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('describe-image: only http(s) URLs, local file paths, and attachment references are supported')
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[image attachment ')) {
    const bytes = await readAttachment(ctx, trimmed, signal)
    return finishLoad(bytes, trimmed.slice(0, 96), maxBytes)
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed, { signal, redirect: 'error' })
    if (!response.ok) {
      throw new Error(`describe-image: image fetch returned HTTP ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      throw new Error(`describe-image: image is ${declared} bytes, above the ${maxBytes}-byte bound`)
    }
    const bytes = await readBoundedBody(response, maxBytes)
    return finishLoad(bytes, trimmed, maxBytes)
  }
  // A bare attachment id — the `sha256:…` string text models tend to copy out of
  // an `[image attachment …]` note instead of the whole JSON. Resolve it through
  // the attach-route registry (the store's digest verification still runs).
  const registered = attachmentRefById(trimmed)
  if (registered !== undefined) {
    const bytes = await readAttachment(ctx, JSON.stringify(registered), signal)
    return finishLoad(bytes, trimmed, maxBytes)
  }
  const info = await stat(trimmed, { bigint: false })
  if (!info.isFile()) throw new Error(`describe-image: image path is not a file: ${trimmed}`)
  if (info.size > maxBytes) {
    throw new Error(`describe-image: image is ${info.size} bytes, above the ${maxBytes}-byte bound`)
  }
  const bytes = await readFile(trimmed, { signal })
  return finishLoad(bytes, trimmed, maxBytes)
}

/**
 * Read a response body up to a byte cap, rejecting the whole response beyond it.
 * @param response - the response to drain.
 * @param cap - the byte bound.
 * @returns the accumulated body bytes.
 */
/** Drain a response body chunk by chunk, always releasing the reader lock. */
async function drainResponse(response: Response, onChunk: (value: Uint8Array) => 'stop' | undefined): Promise<void> {
  if (response.body === null) return
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (onChunk(value) === 'stop') return
    }
  } finally {
    reader.releaseLock()
  }
}

export async function readBoundedBody(response: Response, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  await drainResponse(response, (value) => {
    const chunk = Buffer.from(value)
    total += chunk.length
    if (total > cap) throw new Error(`describe-image: response exceeds the ${cap}-byte bound`)
    chunks.push(chunk)
    return undefined
  })
  return Buffer.concat(chunks)
}

/**
 * Read a response body as text, truncated to a character cap (error excerpts only).
 * @param response - the response to drain.
 * @param cap - the character cap.
 * @returns the decoded text, never longer than `cap` characters.
 */
export async function readBoundedText(response: Response, cap: number): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  let stopped = false
  await drainResponse(response, (value) => {
    text += decoder.decode(value, { stream: true })
    if (text.length > cap) {
      stopped = true
      return 'stop'
    }
    return undefined
  })
  // The final flush decode matters only for a fully-read stream; a truncated
  // read cuts mid-sequence anyway.
  if (!stopped) text += decoder.decode()
  return text.length > cap ? text.slice(0, cap) : text
}

/**
 * Extract the single text answer from an OpenAI-compatible chat-completions
 * payload. Reasoning models (Kimi K2.x and friends) can spend the whole
 * max_tokens budget on the thinking chain and leave `content` empty while the
 * answer lives in `reasoning_content` (issue #637) — fall back to it instead
 * of failing the call outright.
 */
export function extractChatCompletionsContent(payload: unknown): string {
  const root = asRecord(payload)
  const choices = root?.choices
  if (root === undefined || !Array.isArray(choices) || choices.length === 0) unexpectedShape()
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.['content']
  if (typeof content === 'string' && content.trim().length > 0) return content

  const reasoning = message?.['reasoning_content']
  if (typeof reasoning === 'string' && reasoning.trim().length > 0) return reasoning
  if (Array.isArray(reasoning)) {
    const parts = reasoning.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (parts.length > 0) return parts.join('\n')
  }
  throw new Error('describe-image: vision endpoint returned no text content (the model may have spent the whole output budget on reasoning; raise the max output tokens or disable thinking for this model)')
}

/** Extract the text answer from an OpenAI Responses payload: every `output_text` part of assistant messages. */
export function extractResponsesContent(payload: unknown): string {
  const root = asRecord(payload)
  const output = root?.output
  if (root === undefined || !Array.isArray(output)) unexpectedShape()
  const parts: string[] = []
  for (const item of output) {
    const itemRecord = asRecord(item)
    if (itemRecord === undefined) continue
    const { type, role, content } = itemRecord
    if (type !== 'message' || role !== 'assistant' || !Array.isArray(content)) continue
    for (const part of content) {
      const block = asRecord(part)
      if (block === undefined) continue
      if (block.type === 'output_text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        parts.push(block.text)
      }
    }
  }
  const text = parts.join('\n')
  if (text.trim().length === 0) {
    throw new Error('describe-image: vision endpoint returned no text content')
  }
  return text
}

/**
 * Extract the text answer from an SSE (`text/event-stream`) Responses payload.
 * Relay endpoints that wrap the Responses wire API (codex-lb style backends) always
 * stream — `codex.keepalive`, `response.output_text.delta`, `response.output_item.done`,
 * `response.completed`, then `[DONE]` — even for a non-stream request. Delta events
 * accumulate the final text; `output_item.done` carries the completed message content;
 * `response.completed` may carry the standard non-stream `output` shape on endpoints
 * that populate it. Deltas win when present so the text is never assembled twice.
 */
function extractResponsesStreamContent(payloadBytes: Buffer): string {
  const deltas: string[] = []
  const completedParts: string[] = []
  let completedOutput: unknown
  for (const line of payloadBytes.toString('utf8').split('\n')) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data.length === 0 || data === '[DONE]') continue
    let ev: unknown
    try {
      ev = JSON.parse(data)
    } catch {
      continue
    }
    const record = asRecord(ev)
    if (record === undefined) continue
    if (record.type === 'response.output_text.delta' && typeof record.delta === 'string' && record.delta.length > 0) {
      deltas.push(record.delta)
    } else if (record.type === 'response.output_item.done') {
      const item = asRecord(record.item)
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          const block = asRecord(part)
          if (block?.type === 'output_text' && typeof block.text === 'string' && block.text.trim().length > 0) {
            completedParts.push(block.text)
          }
        }
      }
    } else if (record.type === 'response.completed' && record.response !== undefined) {
      completedOutput = record.response
    }
  }
  if (deltas.length > 0) {
    const deltaText = deltas.join('')
    if (deltaText.trim().length > 0) return deltaText
  }
  if (completedParts.length > 0) return completedParts.join('\n')
  if (completedOutput !== undefined) return extractResponsesContent(completedOutput)
  throw new Error('describe-image: vision endpoint returned no text content (SSE stream)')
}

/** Extract the text answer from an Anthropic Messages payload: every `text` content block of the top-level `content` array, skipping `thinking` and other non-text blocks. */
export function extractAnthropicMessagesContent(payload: unknown): string {
  const root = asRecord(payload)
  const content = root?.content
  if (root === undefined || !Array.isArray(content)) unexpectedShape()
  const parts: string[] = []
  for (const item of content) {
    const block = asRecord(item)
    if (block === undefined) continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
      parts.push(block.text)
    }
  }
  const text = parts.join('\n')
  if (text.trim().length === 0) {
    throw new Error('describe-image: vision endpoint returned no text content')
  }
  return text
}

/**
 * Build the request the configured style sends: its path and JSON body. When the model id carried
 * a thinking suffix, Chat Completions maps it to `thinking.type` (`off` -> `disabled`, every
 * other level -> `enabled`) and Responses forwards it as `reasoning.effort` (`off` ->
 * `none`, levels pass through); without a suffix no thinking control is sent, so the endpoint
 * keeps its own default. The `anthropic-messages` style accepts a provider root, a `/v1` API root,
 * or a complete `/v1/messages` endpoint and posts an Anthropic-style body (`max_tokens`, `messages[0].content` = base64 image block + text).
 */
export function buildVisionRequest(spec: ResolvedConfig, prompt: string, image: LoadedImage): { path: string; body: string } {
  if (spec.apiStyle === 'anthropic-messages') {
    const path = spec.baseURL.endsWith('/v1/messages')
      ? spec.baseURL
      : spec.baseURL.endsWith('/v1')
        ? `${spec.baseURL}/messages`
        : `${spec.baseURL}/v1/messages`
    return {
      path,
      body: JSON.stringify({
        model: spec.model,
        max_tokens: spec.maxOutputTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.bytes.toString('base64') } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    }
  }
  const dataUrl = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`
  if (spec.apiStyle === 'responses') {
    return {
      path: `${spec.baseURL}/responses`,
      body: JSON.stringify({
        model: spec.model,
        max_output_tokens: spec.maxOutputTokens,
        ...spec.thinking === undefined ? {} : { reasoning: { effort: spec.thinking === 'off' ? 'none' : spec.thinking } },
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl },
          ],
        }],
      }),
    }
  }
  return {
    path: `${spec.baseURL}/chat/completions`,
    body: JSON.stringify({
      model: spec.model,
      max_tokens: spec.maxOutputTokens,
      ...spec.thinking === undefined ? {} : { thinking: { type: spec.thinking === 'off' ? 'disabled' : 'enabled' } },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }),
  }
}

/** Default semantic-cache lifetime for a successful vision answer, in milliseconds. */
export const DEFAULT_CACHE_TTL_MS = 10_000
/** Default upper bound on cached vision answers. */
export const DEFAULT_CACHE_MAX_ENTRIES = 32

/** A bounded, TTL-expiring cache of successful vision answers. */
export interface VisionCache {
  /** Look up a cached answer, honoring the TTL. */
  get(key: string): string | undefined
  /** Store an answer with a fresh TTL, evicting expired and then oldest entries. */
  set(key: string, text: string): void
  /** Number of live cached answers. */
  readonly size: number
  /** Running cache hits, for observability and tests. */
  readonly hits: number
  /** Running cache misses, for observability and tests. */
  readonly misses: number
  /** Drop every entry. */
  clear(): void
}

/** Create a TTL-expiring, capacity-capped vision answer cache. */
export function createVisionCache(options?: { ttlMs?: number; maxEntries?: number }): VisionCache {
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES)
  const entries = new Map<string, { text: string; expiresAt: number }>()
  let hits = 0
  let misses = 0
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) { misses += 1; return undefined }
      if (entry.expiresAt <= Date.now()) { entries.delete(key); misses += 1; return undefined }
      hits += 1
      return entry.text
    },
    set(key, text) {
      const now = Date.now()
      for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k)
      entries.set(key, { text, expiresAt: now + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    get size() { return entries.size },
    get hits() { return hits },
    get misses() { return misses },
    clear() { entries.clear() },
  }
}

/** The semantic identity of one vision request: endpoint fields plus the same image bytes and prompt. */
export function semanticRequestKey(spec: ResolvedConfig, prompt: string, image: LoadedImage): string {
  // Key by a digest of the bytes, not the base64 text itself: the full
  // encoding is ~1.33x a multi-MB image and every cached entry would pin
  // that string for the TTL, while a digest is 64 chars.
  const digest = createHash('sha256').update(image.bytes).digest('hex')
  return JSON.stringify([
    spec.baseURL, spec.model, spec.maxOutputTokens, spec.apiStyle, spec.thinking,
    digest, image.mimeType, prompt,
  ])
}

/** Call the configured vision endpoint and return its text answer, with short-lifetime caching for repeats. */
export async function callVision(
  spec: ResolvedConfig,
  apiKey: string,
  prompt: string,
  image: LoadedImage,
  signal: AbortSignal,
  cache?: VisionCache,
): Promise<string> {
  if (cache !== undefined) {
    const cached = cache.get(semanticRequestKey(spec, prompt, image))
    if (cached !== undefined) return cached
  }
  const { path, body } = buildVisionRequest(spec, prompt, image)
  const headers: Record<string, string> = spec.apiStyle === 'anthropic-messages'
    ? { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
  const response = await fetch(path, {
    method: 'POST',
    headers,
    body,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  })
  if (!response.ok) {
    const excerpt = await readBoundedText(response, 200)
    throw new Error(`describe-image: vision endpoint returned HTTP ${response.status}: ${excerpt}`)
  }
  // SSE relay streams carry event-framing overhead plus reasoning traces; give the
  // responses style a wider body bound than the JSON styles.
  const bodyCap = spec.apiStyle === 'responses'
    ? spec.maxOutputTokens * 16 + 256 * 1024
    : spec.maxOutputTokens * 8 + 64 * 1024
  const payloadBytes = await readBoundedBody(response, bodyCap)
  let payload: unknown
  let useStream = false
  const contentType = response.headers.get('content-type') ?? ''
  if (spec.apiStyle === 'responses' && contentType.includes('text/event-stream')) {
    useStream = true
  } else {
    try {
      payload = JSON.parse(payloadBytes.toString('utf8'))
    } catch {
      // Some relay endpoints always stream SSE regardless of the content-type or
      // stream flag; fall back to stream parsing for the responses style.
      if (spec.apiStyle === 'responses') {
        useStream = true
      } else {
        throw new Error('describe-image: vision endpoint returned invalid JSON')
      }
    }
  }
  const text = useStream
    ? extractResponsesStreamContent(payloadBytes)
    : spec.apiStyle === 'responses'
      ? extractResponsesContent(payload)
      : spec.apiStyle === 'anthropic-messages'
        ? extractAnthropicMessagesContent(payload)
        : extractChatCompletionsContent(payload)
  if (cache !== undefined) cache.set(semanticRequestKey(spec, prompt, image), text)
  return text
}
