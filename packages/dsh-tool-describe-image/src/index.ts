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

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { registerAttachRoute } from './attach-routes.ts'
import { DEFAULT_MAX_BYTES } from './media.ts'
import { Config, DESCRIBE_IMAGE_SETTINGS_NAMESPACE, resolveApiKey, resolveConfig, type ResolvedConfig } from './config-resolve.ts'
import { callVision, createVisionCache, loadImage } from './vision-client.ts'

export const name = 'describe-image'
export const inject = ['tools', 'webServer']

// Public surface re-exported unchanged from the split modules. Config and its
// schema const travel together from config-resolve; the settings namespace the
// Plugins card uses comes from the same module.

export { DEFAULT_MAX_BYTES, sniffMimeType } from './media.ts'
export type { ImageMimeType } from './media.ts'
export {
  API_STYLES,
  Config,
  DEFAULT_API_KEY_ENV,
  DEFAULT_API_STYLE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_PROMPT,
  DEFAULT_RENDER_IMAGE_PREVIEW,
  DEFAULT_TIMEOUT_MS,
  DESCRIBE_IMAGE_SETTINGS_NAMESPACE,
  resolveApiKey,
  resolveConfig,
} from './config-resolve.ts'
export type { ApiStyle, ResolvedConfig } from './config-resolve.ts'
export {
  callVision,
  createVisionCache,
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_TTL_MS,
  extractChatCompletionsContent,
  extractResponsesContent,
  loadImage,
  parseImageAttachmentRef,
  readAttachment,
  readBoundedBody,
  readBoundedText,
  semanticRequestKey,
} from './vision-client.ts'
export type { LoadedImage, VisionCache } from './vision-client.ts'

const DESCRIPTION_HEAD =
  'Inspect one image — a local absolute path, an http(s) URL, or the JSON of an image attachment '
  + 'note — and return the text the user needs. Use when the user references an image file or URL, '
  + 'or when a task needs OCR, chart or diagram reading, screenshot or UI analysis, translation of '
  + 'image text, or photo understanding. '
  + 'Always pass an explicit `prompt` with a precise instruction — e.g. "transcribe all text", '
  + '"extract the table as CSV", "diagnose the UI layout problems", "translate the text into '
  + 'Chinese" — instead of leaving it to the default description: a targeted instruction produces '
  + 'a much more useful answer. '

/** The describe_image call’s validated arguments. */
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
 * tool returns only the vision model’s text answer. The `describe-image` settings section layers
 * over the composition entry and is re-resolved per call, so the Settings → 插件配置 card's changes
 * reach the very next invocation. Repeat calls for the same image and prompt reuse a short-lived
 * semantic cache so the endpoint is not called twice in quick succession.
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
  // Short-lived semantic cache scoped to this mount: identical image + prompt
  // within the TTL reuse the prior answer instead of a second fetch.
  const visionCache = createVisionCache()
  // The webserver is optional (the loader-composition tests boot without one):
  // the attach route registers only when the service is actually mounted.
  registerAttachRoute(ctx, () => current().maxBytes ?? DEFAULT_MAX_BYTES)
  ctx.tools.register(defineTool({
    name: 'describe_image',
    description: DESCRIPTION_HEAD
      + 'The image may be a local path, an http(s) URL, the JSON object from an `[image attachment …]` '
      + "note, or — the common case when the user used this plugin's input-box image button — a "
      + 'short markdown image reference like `![图片](/describe-image/raw/sha256:abc…)` pasted into '
      + 'the conversation. In the markdown form, take the attachment id from the URL and pass that id '
      + 'as the `image` value (never the whole markdown, and never a made-up path); the tool resolves '
      + 'the id to the stored image. The image itself never enters the conversation — only the '
      + 'returned text is shown to you.',
    parameters: {
      image: {
        type: 'string',
        required: true,
        description: 'Absolute path to a local image file, an http(s) URL of the image, the JSON object from an [image attachment …] note, or the bare attachment id (e.g. sha256:abc…) taken from the markdown image reference ![图片](/describe-image/raw/<id>) that the plugin\'s input-box image button pasted into the conversation.',
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
      const text = await callVision(active, apiKey, args.prompt ?? active.defaultPrompt, image, exec.signal, visionCache)
      return { text, model: active.model, image: args.image, mimeType: image.mimeType, bytes: image.bytes.length }
    },
    presentCall: describeImageCallView,
  }))
}