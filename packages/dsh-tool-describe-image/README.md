# dsh-tool-describe-image — Image Understanding Tool Plugin

English | [中文](README.zh.md)

Model-facing `describe_image` tool: gives **text-only models** (DeepSeek V4 etc.) image understanding.
Each call loads one image — a local file path, an http(s) URL, or a session attachment reference —
and asks a vision endpoint (Qwen-VL, GLM-4V, GPT-4o, Claude-style endpoints such as OpenCode Go,
a local Ollama endpoint…) to answer over the Chat Completions, Responses, or Anthropic Messages
protocol; **only the returned text enters the conversation, the image itself never enters the session log**.

Ported from deepseek-harness `packages/vision/tool-describe-image` (mirrored at
[whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)),
adapted to the dsh-web-ui family conventions: official NPM SDK only, host-side plugin with a
browser half, live settings, no dsh source changes.

## Capabilities

| Capability | Description |
| --- | --- |
| Three inputs | Local absolute path, http(s) URL (redirects refused), an `[image attachment …]` JSON note, or the short markdown reference a drag/paste produces (`![图片](/describe-image/raw/sha256:…)` — the model passes the id from the URL; the in-process attach registry resolves it and the store's digest verification still runs) |
| Direct image send | Dragged or pasted images use DSH's native multimodal path first. Only when the host explicitly rejects image input for the current model does the plugin upload them and retry with describe-image references (`![图片](/describe-image/raw/sha256:…)`) for tool-based analysis |
| Custom instructions | The `prompt` argument carries your precise instruction (OCR, chart reading, UI diagnosis, translation…); the `defaultPrompt` config sets the fallback when the model passes none |
| Live config card | Settings → Plugin config → Web UI Plugins → "Image understanding" card edits `baseURL` / `apiStyle` / `model` / API key / default instruction / bounds (through the settings seam); effective immediately, no restart |
| Protocol styles | `apiStyle: chat-completions` (default) posts to `baseURL/chat/completions`; `apiStyle: responses` posts to `baseURL/responses` with `input` / `max_output_tokens` and reads `output_text`; `apiStyle: anthropic-messages` posts to `baseURL/v1/messages` with `x-api-key` auth (Claude-style endpoints such as OpenCode Go, Zhipu GLM, Moonshot Kimi) and reads `content[].text` |
| Thinking control | The model id carries an optional suffix: `model:off` disables thinking, `model:low` / `model:medium` / `model:high` enable it, and a bare `model` sends no control so the endpoint default applies (MiMo-V2.5 and DeepSeek V4 think by default) |
| Raw image route | `GET /describe-image/raw/<id>` serves the stored bytes (loopback-only, content-addressed id) so the pasted reference renders in the conversation |
| Capability route | `GET /describe-image/capability?session=<id>` answers whether the session's model declares image input (the effective route is taken from the live agent/request record, then agent options, then the default-model service; modalities resolve through `resolveModelInfo`). Every unknown and failure answers false, preserving the rewrite behavior |
| Per-call key resolution | Inline `apiKey` → credential seam (`apiKeyEnv`, default `VISION_API_KEY`) → launch environment, tiered fallback |
| Safety and bounds | All requests refuse redirects; `maxBytes` / `maxOutputTokens` / `timeoutMs` caps; magic-byte type gate; bounded error excerpts (200 chars); keys never logged |
| Canonical return | `{ text, model, image, mimeType, bytes }` — the model only sees `text` |

## Security model

- Vision requests and image downloads both refuse HTTP redirects (`redirect: 'error'`); bearer credentials
  and image bytes never reach a source other than the configured deployment.
- The request body carries the base64 image but no key; request headers and resolved credentials are not logged.
- Only `http(s)` URLs and local paths are accepted; every other URL scheme is rejected.
- The attach route validates base64, magic bytes, and the byte bound before the attachment store
  persists anything; only the reference JSON (text) crosses into the conversation.
- Response bodies are truncated at the cap (`maxOutputTokens * 8 + 64 KiB`) before parsing.

## Installation

Install the family aggregate `@linxin666/dsh-web-ui-all` (all plugins and skins in one package), or this plugin alone:

```sh
# Recommended: install directly from npm
dsh plugin --profile web add @linxin666/dsh-tool-describe-image
```

The aggregate mounts this plugin **without configuration**: loading is unaffected, and the first call
fails with a clear error (`describe-image: baseURL must be an absolute http(s) URL`) until configured.
Fill in the endpoint and model on the "Image understanding" card under Settings → Plugin config to
start immediately, no restart needed. (Difference from upstream: upstream validates eagerly at load;
the family aggregate has no config entry, so validation is eager only when a composition entry
actually configures it and per-call otherwise.)

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `baseURL` | — (required) | Endpoint root; the style appends its path (`/chat/completions`, `/responses`, or `/v1/messages`). OpenAI-compatible examples use e.g. `https://dashscope.aliyuncs.com/compatible-mode/v1`; Anthropic style accepts a provider root such as `https://opencode.ai/zen/go`, a conventional `/v1` API root, or a complete `/v1/messages` endpoint. Trailing slashes stripped |
| `apiStyle` | `chat-completions` | Protocol style: `chat-completions` appends `/chat/completions`; `responses` appends `/responses` (OpenAI Responses API `input` / `max_output_tokens` / `output_text` shapes); `anthropic-messages` normalizes the root to one `/v1/messages` endpoint (Claude-style `messages` / `max_tokens` / `content[].text`, `x-api-key` + `anthropic-version` headers) |
| `model` | — (required) | Vision model id, optionally with a thinking suffix (`:off` / `:low` / `:medium` / `:high`). The suffix is stripped before the id reaches the endpoint: `:off` maps to `thinking.type: disabled` (`chat-completions`) or `reasoning.effort: none` (`responses`); every other level maps to `enabled` or is forwarded as the `reasoning.effort` value. No suffix means no thinking control field. The `anthropic-messages` style sends no thinking field and keeps the endpoint's own default |
| `apiKey` | — | Inline key for local debugging; prefer `!!js process.env.VISION_API_KEY` over a hardcoded secret |
| `apiKeyEnv` | `VISION_API_KEY` | Credential reference (environment-variable name); empty string disables reference resolution |
| `defaultPrompt` | see source | The instruction used when a call omits its `prompt` — tune it to your workload (OCR, UI review, translation…) |
| `maxBytes` | `10485760` | Image byte bound (local files and downloads alike) |
| `maxOutputTokens` | `1024` | Output-token cap: `max_tokens` under `chat-completions` and `anthropic-messages`, `max_output_tokens` under `responses` |
| `timeoutMs` | `120000` | Per-call vision request timeout |
| `renderImagePreview` | `true` | Upgrade image references in the conversation into inline thumbnails (click for full size); `false` keeps the raw reference text. Display-only — message text and model-side analysis are unchanged |
| `interceptImageSend` | `true` | Send images through DSH's native model path first, then fall back to describe-image references only when the host explicitly reports that the current model does not support image input; `false` disables this fallback and leaves native sends and errors untouched |

Configured mount example (profile `cordis.patch.yml` / composition file):

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen-vl-max
    apiKey: !!js process.env.VISION_API_KEY
```

Endpoints exposing only the Responses API set `apiStyle: responses`:

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://api.openai.com/v1
    apiStyle: responses
    model: gpt-4o-mini
    apiKey: !!js process.env.VISION_API_KEY
```

Endpoints whose models enable extended thinking by default (MiMo-V2.5, DeepSeek V4) can turn it off per call so reasoning tokens do not consume the output budget:

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://api.xiaomimimo.com/v1
    model: mimo-v2.5:off
    apiKey: !!js process.env.VISION_API_KEY
```

Claude-style endpoints (e.g. OpenCode Go, which serves Qwen3.7 Plus and other vision models only
through the Messages API) set `apiStyle: anthropic-messages`; a bare provider root is the simplest `baseURL` form:

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://opencode.ai/zen/go
    apiStyle: anthropic-messages
    model: qwen3.7-plus
    apiKey: !!js process.env.OPENCODE_GO_API_KEY
```

The provider path is preserved: this example sends the request to `https://opencode.ai/zen/go/v1/messages`.

## Usage

### Custom instructions

The tool takes a `prompt` argument: tell the vision model exactly what you need — "transcribe all
text", "extract the table as CSV", "diagnose the UI layout problems", "translate the text into
Chinese". A targeted instruction beats a generic description; the tool description steers the
text model toward passing one. Calls without a `prompt` fall back to `defaultPrompt`.

### Sending images directly

Drag or paste an image into the composer as usual. With `interceptImageSend` enabled, the plugin first leaves the original image blocks intact and sends them through DSH's native multimodal path. If that succeeds, no image is uploaded to describe-image and no external vision endpoint is called. If the DSH host explicitly reports that the current model does not support image input, the plugin uploads the bytes through `/describe-image/attach` (validated for size and magic bytes, then persisted in the attachment store) and retries with describe-image references (`![图片](/describe-image/raw/sha256:…)`); only the reference text enters the fallback session prompt. Attachment corruption, summary mismatches, network failures, and other non-capability errors remain unchanged.

The web shell renders user messages as plain text, so a fallback reference would sit in the transcript as raw markdown; with `renderImagePreview` on (the card's "Render image preview in chat" toggle, on by default) the client upgrades each reference in place into an inline thumbnail — click it for a full-size overlay. If the raw route is unreachable through the current origin (for example behind a proxy that does not forward it), the thumbnail load fails and the reference text stays as-is.

The fallback is a live switch: the settings card's "Fall back to describe-image for unsupported models" toggle (`interceptImageSend`, on by default). Turn it off to bypass describe-image fallback completely; image sends and any native-path errors then pass through untouched.

## Known limitations

- Only the magic-byte gate checks the type; the image is not decoded, so a header-valid but corrupt
  file fails only at the vision endpoint.
- One image per answer: no multi-image input, no follow-up on the previous image, no structured
  output (coordinates / boxes).
- Extracting text still costs one VLM call: OCR-only deployments can point `baseURL` at a cheaper OCR model.
- Three protocol styles: Chat Completions (`/chat/completions`), Responses (`/responses`), and
  Anthropic Messages (`/v1/messages`, `x-api-key` auth) — for vendors with other request/response
  shapes, add another adapter.
- The model thinking suffix is a plugin shorthand that adds provider-specific fields
  (`thinking.type` / `reasoning.effort`) to the request; endpoints that do not accept them (for
  example plain OpenAI vision models) should use a bare model id. Chat Completions has no effort
  levels, so `:low` / `:medium` / `:high` all map to `thinking.type: enabled` there. Only the four
  known suffixes are stripped — ids that end in other colon variants (for example OpenRouter
  `:free`) are forwarded verbatim.

## Source and copyright

- **Source**: ported from [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)
  (deepseek-harness `packages/vision/tool-describe-image`), moved in 2026-08; tests ported with the source
  (`pnpm --filter @linxin666/dsh-tool-describe-image test`).
- **Copyright**: the original code belongs to its authors (deepseek-ai / whitelonng); this repository
  only hosts and maintains it and claims no copyright; the ported contribution is licensed by its
  contributor under the family license.
- **License**: the family is licensed under [Apache-2.0](../../LICENSE) (repository root LICENSE); this
  package's `license` field is `Apache-2.0`.
