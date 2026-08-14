/**
 * Model-facing image understanding for text-only models. Each call loads one image — a local file
 * path or an http(s) URL — and asks a vision-language model at an OpenAI-compatible endpoint to
 * describe it; only the returned text crosses into the conversation, so the image never enters the
 * session log. The API key resolves per call (inline config value, then the credential seam, then
 * the launch environment), and the HTTP client refuses redirects so a bearer credential can never
 * be forwarded off the configured endpoint.
 *
 * Ported from deepseek-harness packages/vision/tool-describe-image (mirrored at
 * whitelonng/dsh-plugin-describe-image). Family adaptation: the plugin may be mounted without
 * configuration (the dsh-web-ui-all aggregate does this), so endpoint/model validation happens per
 * call — or eagerly at load when a composition entry actually configures it. The "Image
 * understanding" settings section can fill the fields live from Settings → 插件配置.
 * @module @linxin666/dsh-tool-describe-image
 */

import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { attachmentRefById, registerAttachRoute } from './attach-routes.ts'
import { DEFAULT_MAX_BYTES, sniffMimeType, type ImageMimeType } from './media.ts'

export const name = 'describe-image'
export const inject = ['tools', 'webServer']

/** Environment-variable name the API key resolves through when no inline key is configured. */
export const DEFAULT_API_KEY_ENV = 'VISION_API_KEY'
/** Per-call output-token cap sent to the vision model. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024
/** Per-call vision request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 60_000
/** Instruction sent when the model does not pass its own prompt. */
export const DEFAULT_PROMPT =
  'Analyze this image: describe what is visible factually, transcribe legible text verbatim, and call out layout, notable details, or anything anomalous.'

export { DEFAULT_MAX_BYTES, sniffMimeType } from './media.ts'
export type { ImageMimeType } from './media.ts'

/**
 * Deployment configuration for the describe-image tool. The interface keeps every field optional so
 * programmatic construction is re-judged by {@link resolveConfig}; the schema requires `baseURL` and
 * `model` for composition entries.
 */
export interface Config {
  /** Root of the OpenAI-compatible endpoint, e.g. `https://api.openai.com/v1`; trailing slashes are stripped. */
  baseURL?: string
  /** Vision model id for the configured endpoint. */
  model?: string
  /** Inline API key; prefer `apiKeyEnv` with the credential seam. Feed from the environment via `!!js process.env.VISION_API_KEY`. */
  apiKey?: string
  /** Credential reference (environment-variable name) for the API key; defaults to `VISION_API_KEY`. */
  apiKeyEnv?: string
  /** Instruction used when a call omits its `prompt`; defaults to a concise factual description. */
  defaultPrompt?: string
  /** Image byte bound; defaults to {@link DEFAULT_MAX_BYTES}. */
  maxBytes?: number
  /** Output-token cap sent to the vision model; defaults to {@link DEFAULT_MAX_OUTPUT_TOKENS}. */
  maxOutputTokens?: number
  /** Per-call request timeout; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number
}

/** Schemastery configuration for the describe-image tool; doubles as the `describe-image` settings-section schema. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
  model: z.string(),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  defaultPrompt: z.string().default(DEFAULT_PROMPT),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_TOKENS),
  timeoutMs: z.number().min(1).default(DEFAULT_TIMEOUT_MS),
})

/** Settings namespace carrying the endpoint, model, and key reference the Plugins card edits. */
export const DESCRIBE_IMAGE_SETTINGS_NAMESPACE = settingsNamespace('describe-image')

/** One resolved, validated configuration snapshot; defaults and beyond-schema constraints applied. */
export interface ResolvedConfig {
  baseURL: string
  model: string
  apiKey: string | undefined
  apiKeyEnv: CredentialRef | undefined
  defaultPrompt: string
  maxBytes: number
  maxOutputTokens: number
  timeoutMs: number
}

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: ImageMimeType
}

/**
 * Resolve raw config into validated connection facts. Programmatic construction may bypass
 * Schemastery normalization, so every default and bound is re-judged here; a non-empty composition
 * entry is validated at load so misconfiguration fails loud (an unconfigured family mount only
 * hits it per call, inside {@link apply}).
 * @param config - raw plugin config.
 * @returns validated facts.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const baseURL = (config.baseURL ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseURL)) {
    throw new Error('describe-image: baseURL must be an absolute http(s) URL')
  }
  const model = (config.model ?? '').trim()
  if (model.length === 0) throw new Error('describe-image: model must be a non-empty model id')
  const apiKey = config.apiKey
  if (apiKey !== undefined && apiKey.length === 0) {
    throw new Error('describe-image: apiKey must be non-empty when set')
  }
  let apiKeyEnv: CredentialRef | undefined
  const rawEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  if (rawEnv.length > 0) {
    try {
      apiKeyEnv = credentialRef(rawEnv)
    } catch {
      throw new Error(`describe-image: apiKeyEnv ${JSON.stringify(rawEnv)} is not a valid environment-variable name`)
    }
  }
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  for (const [field, value] of [['maxBytes', maxBytes], ['maxOutputTokens', maxOutputTokens], ['timeoutMs', timeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`describe-image: ${field} must be a positive safe integer`)
    }
  }
  return { baseURL, model, apiKey, apiKeyEnv, defaultPrompt: config.defaultPrompt ?? DEFAULT_PROMPT, maxBytes, maxOutputTokens, timeoutMs }
}

/**
 * Resolve the API key for one call: an explicit inline key wins; otherwise the credential seam (which owns
 * environment and managed-store layers) resolves the reference; without the seam the launch environment is
 * the whole credential plane.
 * @param ctx - registrant context.
 * @param spec - validated configuration.
 * @returns the resolved key.
 */
export async function resolveApiKey(ctx: Context, spec: ResolvedConfig): Promise<string> {
  if (spec.apiKey !== undefined) return spec.apiKey
  if (spec.apiKeyEnv !== undefined) {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(spec.apiKeyEnv)
      if (hit !== undefined) return hit.value
    } else {
      const ambient = launchEnvironmentOf(ctx).get(spec.apiKeyEnv)
      if (ambient !== undefined && ambient.value.length > 0) return ambient.value
    }
  }
  throw new Error(
    `describe-image: no API key; set apiKey, store ${spec.apiKeyEnv ?? DEFAULT_API_KEY_ENV} through the credentials service,`
    + ' or export it in the launching environment',
  )
}

/**
 * Read a response body up to a byte cap, rejecting the whole response beyond it.
 * @param response - the response to drain.
 * @param cap - the byte bound.
 * @returns the accumulated body bytes.
 */
export async function readBoundedBody(response: Response, cap: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > cap) throw new Error(`describe-image: response exceeds the ${cap}-byte bound`)
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

/**
 * Read a response body as text, truncated to a character cap (error excerpts only).
 * @param response - the response to drain.
 * @param cap - the character cap.
 * @returns the decoded text, never longer than `cap` characters.
 */
export async function readBoundedText(response: Response, cap: number): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length > cap) return text.slice(0, cap)
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return text.length > cap ? text.slice(0, cap) : text
}

/**
 * Load one image from a local absolute path, an http(s) URL, or a durable attachment reference
 * (the JSON an `[image attachment …]` note carries), enforcing the byte bound before any bytes
 * reach the vision model. Non-http(s) URL schemes are rejected.
 * @param ctx - registrant context; supplies the optional attachment service.
 * @param input - the model-supplied image reference.
 * @param signal - caller cancellation.
 * @param maxBytes - image byte bound.
 * @returns the loaded bytes and sniffed media type.
 */
export async function loadImage(ctx: Context, input: string, signal: AbortSignal, maxBytes: number): Promise<LoadedImage> {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new Error('describe-image: image must be a non-empty path, URL, or attachment reference')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error('describe-image: only http(s) URLs, local file paths, and attachment references are supported')
  }
  if (trimmed.startsWith('{')) {
    const bytes = await readAttachment(ctx, trimmed, signal)
    if (bytes.length > maxBytes) {
      throw new Error(`describe-image: image is ${bytes.length} bytes, above the ${maxBytes}-byte bound`)
    }
    return toImage(bytes, trimmed.slice(0, 96))
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
    return toImage(bytes, trimmed)
  }
  // A bare attachment id — the `sha256:…` string text models tend to copy out of
  // an `[image attachment …]` note instead of the whole JSON. Resolve it through
  // the attach-route registry (the store's digest verification still runs).
  const registered = attachmentRefById(trimmed)
  if (registered !== undefined) {
    const bytes = await readAttachment(ctx, JSON.stringify(registered), signal)
    if (bytes.length > maxBytes) {
      throw new Error(`describe-image: image is ${bytes.length} bytes, above the ${maxBytes}-byte bound`)
    }
    return toImage(bytes, trimmed)
  }
  const info = await stat(trimmed, { bigint: false })
  if (!info.isFile()) throw new Error(`describe-image: image path is not a file: ${trimmed}`)
  if (info.size > maxBytes) {
    throw new Error(`describe-image: image is ${info.size} bytes, above the ${maxBytes}-byte bound`)
  }
  const bytes = await readFile(trimmed, { signal })
  return toImage(bytes, trimmed)
}

/** Media types the attachment reference may declare. */
const ATTACHMENT_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

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
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('describe-image: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note')
  }
  const candidate = parsed as {
    attachmentId?: unknown
    mediaType?: unknown
    bytes?: unknown
    width?: unknown
    height?: unknown
    name?: unknown
  }
  const { attachmentId, mediaType, bytes, width, height, name } = candidate
  if (typeof attachmentId !== 'string' || attachmentId.length === 0
    || typeof mediaType !== 'string' || !ATTACHMENT_MEDIA_TYPES.has(mediaType)
    || !Number.isSafeInteger(bytes) || (bytes as number) <= 0
    || !Number.isSafeInteger(width) || (width as number) <= 0
    || !Number.isSafeInteger(height) || (height as number) <= 0
    || (name !== undefined && typeof name !== 'string')) {
    throw new Error('describe-image: image is not a valid attachment reference; copy the exact JSON from the [image attachment …] note')
  }
  try {
    const stored = await attachments.readImage({
      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType: mediaType as ImageAttachmentRef['mediaType'],
      bytes: bytes as number,
      width: width as number,
      height: height as number,
      ...name === undefined ? {} : { name },
    }, signal)
    return Buffer.from(stored.data)
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ATTACHMENT_NOT_FOUND') {
      throw new Error(`describe-image: attachment ${JSON.stringify(attachmentId)} is no longer available`)
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

/** Extract the single text answer from an OpenAI-compatible chat-completions payload. */
function extractContent(payload: unknown): string {
  const root = payload as { choices?: unknown } | null
  if (typeof root !== 'object' || root === null || !Array.isArray(root.choices) || root.choices.length === 0) {
    throw new Error('describe-image: vision endpoint returned an unexpected response shape')
  }
  const content = (root.choices[0] as { message?: { content?: unknown } } | null)?.message?.content
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('describe-image: vision endpoint returned no text content')
  }
  return content
}

/** Call the configured vision endpoint and return its text answer. */
async function callVision(spec: ResolvedConfig, apiKey: string, prompt: string, image: LoadedImage, signal: AbortSignal): Promise<string> {
  const dataUrl = `data:${image.mimeType};base64,${image.bytes.toString('base64')}`
  const body = JSON.stringify({
    model: spec.model,
    max_tokens: spec.maxOutputTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  })
  const response = await fetch(`${spec.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
  })
  if (!response.ok) {
    const excerpt = await readBoundedText(response, 200)
    throw new Error(`describe-image: vision endpoint returned HTTP ${response.status}: ${excerpt}`)
  }
  const payloadBytes = await readBoundedBody(response, spec.maxOutputTokens * 8 + 64 * 1024)
  let payload: unknown
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    throw new Error('describe-image: vision endpoint returned invalid JSON')
  }
  return extractContent(payload)
}

const DESCRIPTION_HEAD =
  'Inspect one image — a local absolute path, an http(s) URL, or the JSON of an image attachment '
  + 'note — and return the text the user needs. Use when the user references an image file or URL, '
  + 'or when a task needs OCR, chart or diagram reading, screenshot or UI analysis, translation of '
  + 'image text, or photo understanding. '
  + 'Always pass an explicit `prompt` with a precise instruction — e.g. "transcribe all text", '
  + '"extract the table as CSV", "diagnose the UI layout problems", "translate the text into '
  + 'Chinese" — instead of leaving it to the default description: a targeted instruction produces '
  + 'a much more useful answer. '

/** The describe_image call's validated arguments. */
export interface DescribeImageArgs {
  image: string
  prompt?: string
}

/**
 * Pure call view: a generic read card, with a file location for local paths.
 * @param args - the validated call arguments.
 * @returns the pending-state card for one describe_image call.
 */
export function describeImageCallView(args: DescribeImageArgs): GenericCallView {
  return {
    card: 'generic',
    title: 'Describe image',
    kind: 'read',
    rawInput: args,
    .../^https?:\/\//i.test(args.image) ? {} : { locations: [{ path: args.image }] },
  }
}

/**
 * Register the `describe_image` tool on `ctx.tools`. The image never enters the conversation: the
 * tool returns only the vision model's text answer. The `describe-image` settings section layers
 * over the composition entry and is re-resolved per call, so the Settings → 插件配置 card's changes
 * reach the very next invocation.
 *
 * Family adaptation: the aggregate mounts this plugin without configuration, so endpoint/model
 * validation is lazy — an empty composition entry loads fine and the first call fails with a clear
 * "unconfigured" message; a non-empty entry is still validated eagerly at load and fails loud.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // The loader fills schema defaults before apply, so an unconfigured entry
  // still arrives with default fields set. Only a config that actually names
  // the endpoint/model is validated eagerly — the family aggregate mounts
  // without configuration and must load silently.
  if (config.baseURL !== undefined || config.model !== undefined) {
    resolveConfig(config)
  }
  let current: () => Config = () => config
  installSettingsSection(ctx, DESCRIBE_IMAGE_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
    validate: (value) => {
      if (value.baseURL !== undefined || value.model !== undefined) resolveConfig(value)
    },
  })
  const spec = (): ResolvedConfig => resolveConfig(current())
  // The webserver is optional (the loader-composition tests boot without one):
  // the attach route registers only when the service is actually mounted.
  registerAttachRoute(ctx, () => current().maxBytes ?? DEFAULT_MAX_BYTES)
  ctx.tools.register(defineTool({
    name: 'describe_image',
    description: DESCRIPTION_HEAD
      + 'The image may be a local path, an http(s) URL, or the COMPLETE JSON object from an `[image attachment …]` '
      + 'note the user pasted into the input box — copy the whole JSON including attachmentId, mediaType, '
      + 'bytes, width, and height, never only the attachmentId (the browser image button of this plugin '
      + 'shown to you — only the returned text is.',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Absolute path to a local image file, an http(s) URL of the image, or the COMPLETE JSON object from an [image attachment …] note — all fields (attachmentId, mediaType, bytes, width, height) as they appear inside the note brackets; never pass only the attachmentId value, which is not a file path.',
      },
      prompt: {
        type: 'string',
        description: 'Your precise instruction for the vision model about this image (e.g. "transcribe all text", "extract the table as CSV", "diagnose the UI problems", "translate the text"). Prefer a targeted prompt over the generic default description.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          model: { type: 'string', required: true },
          image: { type: 'string', required: true },
          mimeType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const active = spec()
      const apiKey = await resolveApiKey(ctx, active)
      const image = await loadImage(ctx, args.image, exec.signal, active.maxBytes)
      const text = await callVision(active, apiKey, args.prompt ?? active.defaultPrompt, image, exec.signal)
      return { text, model: active.model, image: args.image, mimeType: image.mimeType, bytes: image.bytes.length }
    },
    presentCall: describeImageCallView,
  }))
}
