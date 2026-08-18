/**
 * Config and credential facts for the describe-image tool. Holds the validated
 * ResolvedConfig snapshot (defaults, bounds, and endpoint facts), the API-key
 * resolution seams, and the schemastery section that doubles as the plugin's
 * settings card schema. Kept separate from tool registration and the vision
 * HTTP client so single purpose stays single file.
 * @module @linxin666/dsh-tool-describe-image/config
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_MAX_BYTES } from './media.ts'

/** Environment-variable name the API key resolves through when no inline key is configured. */
export const DEFAULT_API_KEY_ENV = 'VISION_API_KEY'
/** Per-call output-token cap sent to the vision model. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024
/** Thinking-level suffixes accepted after the model id: `:off` disables thinking, the rest enable it. */
export const THINKING_SUFFIXES = ['off', 'low', 'medium', 'high'] as const
/** One parsed thinking level from a model-id suffix, or undefined when the model id carries none. */
export type ThinkingMode = typeof THINKING_SUFFIXES[number]
/** Per-call vision request timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 120_000
/** Protocol styles the tool can speak to the configured endpoint. */
export const API_STYLES = ['chat-completions', 'responses', 'anthropic-messages'] as const
export type ApiStyle = typeof API_STYLES[number]
/** Protocol style used unless the configuration overrides it. */
export const DEFAULT_API_STYLE: ApiStyle = 'chat-completions'
/** Whether conversation image references upgrade into inline thumbnails unless configured otherwise. */
export const DEFAULT_RENDER_IMAGE_PREVIEW = true
/** Whether image-bearing sends are rewritten into describe-image references at submit (issue #301). */
export const DEFAULT_INTERCEPT_IMAGE_SEND = true
/** Instruction sent when the model does not pass its own prompt. */
export const DEFAULT_PROMPT =
  'Analyze this image: describe what is visible factually, transcribe legible text verbatim, and call out layout, notable details, or anything anomalous.'

/**
 * Split a model id into the id the endpoint receives and its thinking-level suffix. A trailing
 * `:off` / `:low` / `:medium` / `:high` is the plugin's shorthand for the thinking control:
 * the suffix never reaches the endpoint, and a model id without one (or with any other suffix) is
 * forwarded verbatim with no thinking control.
 * @param model - the raw configured model id.
 * @returns the cleaned id and the parsed level, if any.
 */
export function splitModelSuffix(model: string): { model: string; thinking: ThinkingMode | undefined } {
  const trimmed = model.trim()
  const match = /:(off|low|medium|high)$/.exec(trimmed)
  if (match === null) return { model: trimmed, thinking: undefined }
  return { model: trimmed.slice(0, -match[0].length), thinking: match[1] as ThinkingMode }
}

/**
 * Deployment configuration for the describe-image tool. The interface keeps every field optional so
 * programmatic construction is re-judged by {@link resolveConfig}; the schema requires `baseURL` and
 * `model` for composition entries.
 */
export interface Config {
  /** Endpoint root; Anthropic style also accepts a `/v1` root or complete `/v1/messages` endpoint. Trailing slashes are stripped. */
  baseURL?: string
  /**
   * Vision model id for the configured endpoint, optionally with a trailing thinking suffix
   * (`:off` / `:low` / `:medium` / `:high`) — see {@link splitModelSuffix}. The suffix
   * controls the thinking field the request sends and is stripped before the id reaches the endpoint.
   */
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
  /** Protocol style of the endpoint; defaults to {@link DEFAULT_API_STYLE} (`chat-completions`). */
  apiStyle?: ApiStyle
  /**
   * Whether describe-image references in the conversation upgrade in place into inline
   * thumbnails; defaults to {@link DEFAULT_RENDER_IMAGE_PREVIEW}. The web shell renders
   * user messages as plain text, so a sent reference would otherwise sit in the
   * transcript as raw markdown. Display-only: the message text, the session log, and
   * the model side are untouched. If the raw route is unreachable through the current
   * origin, the thumbnail load fails and the reference text stays as-is.
   */
  renderImagePreview?: boolean
  /**
   * Whether image-bearing sends are rewritten at submit into describe-image
   * references; defaults to {@link DEFAULT_INTERCEPT_IMAGE_SEND}. Turn off to
   * hand the raw image blocks to other vision plugins sharing the session.
   */
  interceptImageSend?: boolean
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
  apiStyle: z.union(API_STYLES).default(DEFAULT_API_STYLE),
  renderImagePreview: z.boolean().default(DEFAULT_RENDER_IMAGE_PREVIEW),
  interceptImageSend: z.boolean().default(DEFAULT_INTERCEPT_IMAGE_SEND),
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
  apiStyle: ApiStyle
  thinking: ThinkingMode | undefined
  renderImagePreview: boolean
  interceptImageSend: boolean
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
  const { model, thinking } = splitModelSuffix(config.model ?? '')
  if (model.length === 0) throw new Error('describe-image: model must be a non-empty model id before any :off/:low/:medium/:high suffix')
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
  const apiStyle = config.apiStyle ?? DEFAULT_API_STYLE
  for (const [field, value] of [['maxBytes', maxBytes], ['maxOutputTokens', maxOutputTokens], ['timeoutMs', timeoutMs]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`describe-image: ${field} must be a positive safe integer`)
    }
  }
  if (!API_STYLES.includes(apiStyle)) {
    throw new Error(`describe-image: apiStyle must be one of ${API_STYLES.map(style => JSON.stringify(style)).join(', ')}`)
  }
  return { baseURL, model, apiKey, apiKeyEnv, defaultPrompt: config.defaultPrompt ?? DEFAULT_PROMPT, maxBytes, maxOutputTokens, timeoutMs, apiStyle, thinking, renderImagePreview: config.renderImagePreview ?? DEFAULT_RENDER_IMAGE_PREVIEW, interceptImageSend: config.interceptImageSend ?? DEFAULT_INTERCEPT_IMAGE_SEND }
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
