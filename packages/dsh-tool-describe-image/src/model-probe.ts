/**
 * Endpoint model probe for the describe-image tool: lists the models a
 * configured vision endpoint serves, doubling as the connectivity and
 * credential check the settings card's probe button runs. A successful list
 * proves the endpoint is reachable and the key authenticates; no completion
 * call is made, so the probe never spends tokens. The key stays on the host —
 * the browser half only reads the returned id list.
 * @module @linxin666/dsh-tool-describe-image/model-probe
 */

import { readBoundedBody } from './vision-client.ts'
import { resolveConfig, type ApiStyle, type Config, type ResolvedConfig } from './config-resolve.ts'

/** Probe request timeout: model listings are light, far shorter than a vision call. */
export const PROBE_TIMEOUT_MS = 15_000

/**
 * Combine the optional caller signal with the probe timeout. AbortSignal.any
 * of an empty array yields a signal that never aborts, so the timeout must
 * stand alone when no caller signal exists — otherwise a hung upstream would
 * pin the card on "testing" forever.
 */
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** Response-body byte cap for one model listing. */
export const PROBE_MAX_BODY_BYTES = 512 * 1024

/** Model ids returned to the card; beyond this the tail of the listing is dropped. */
export const PROBE_MAX_MODELS = 256

/**
 * Placeholder model id pinned when none is configured yet: the probe lists
 * models precisely so the user can pick one, so an absent model must not
 * block it. The listing request never sends a model id anywhere (the probe
 * makes no completion call); vision calls keep the strict non-empty check.
 */
export const PROBE_MODEL_PLACEHOLDER = 'probe'

/** Narrow an unknown value to a plain, non-array object, or undefined. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * The models-listing URL one style hits. The `anthropic-messages` style
 * mirrors the completion-path rule: a provider root gains `/v1/models`, a
 * `/v1` API root gains `/models`, and a complete `/v1/messages` endpoint is
 * rewritten to its sibling. The OpenAI-compatible styles append `/models` to
 * the configured root.
 * @param baseURL - the resolved endpoint root (no trailing slash).
 * @param apiStyle - the protocol style the card is configured for.
 * @returns the absolute listing URL.
 */
export function buildModelsUrl(baseURL: string, apiStyle: ApiStyle): string {
  if (apiStyle === 'anthropic-messages') {
    if (baseURL.endsWith('/v1/messages')) return `${baseURL.slice(0, -'/messages'.length)}/models`
    if (baseURL.endsWith('/v1')) return `${baseURL}/models`
    return `${baseURL}/v1/models`
  }
  return `${baseURL}/models`
}

/**
 * Extract the model ids from one listing payload. Both the OpenAI shape
 * (`data[].id`) and the Anthropic shape (`data[].id` under a `/v1/models`
 * envelope) carry the id the same way; entries without a non-empty string id
 * are skipped rather than surfaced as blanks.
 * @param payload - the parsed listing body.
 * @returns the ids in listing order, capped at {@link PROBE_MAX_MODELS}.
 */
export function extractModelIds(payload: unknown): string[] {
  const data = asRecord(payload)?.['data']
  if (!Array.isArray(data)) {
    throw new Error('describe-image: models endpoint returned an unexpected shape')
  }
  const ids: string[] = []
  for (const entry of data) {
    const id = asRecord(entry)?.['id']
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.push(id)
      if (ids.length >= PROBE_MAX_MODELS) break
    }
  }
  return ids
}

/**
 * List the models one resolved configuration's endpoint serves. Throws with a
 * prefixed message on every failure, so the route envelopes one reason the
 * card can surface verbatim.
 * @param spec - the resolved configuration to probe.
 * @param apiKey - the credential the listing authenticates with.
 * @param signal - caller cancellation.
 * @returns the served model ids; an empty list is its own failure.
 */
export async function probeModels(spec: ResolvedConfig, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const headers: Record<string, string> = spec.apiStyle === 'anthropic-messages'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` }
  let response: Response
  try {
    response = await fetch(buildModelsUrl(spec.baseURL, spec.apiStyle), {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: withTimeout(signal),
    })
  } catch (error) {
    throw new Error(`describe-image: endpoint unreachable: ${(error as Error).message ?? String(error)}`)
  }
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? ' (key rejected)' : ''
    throw new Error(`describe-image: models endpoint returned HTTP ${response.status}${reason}`)
  }
  const body = await readBoundedBody(response, PROBE_MAX_BODY_BYTES)
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('describe-image: models endpoint returned invalid JSON')
  }
  const models = extractModelIds(payload)
  if (models.length === 0) {
    throw new Error('describe-image: endpoint listed no models')
  }
  return models
}

/** A caller-supplied key resolver (the route wires the credential seam). */
export type ProbeKeyResolver = (spec: ResolvedConfig) => Promise<string>

/**
 * The request one model ping sends: the style's completion path with a
 * minimal body (`max_tokens` 1, one short text message), so the round trip
 * exercises the configured model itself — not just the models listing —
 * while spending a single token of output.
 * @param spec - the resolved configuration under test.
 * @returns the absolute ping URL and its JSON body.
 */
export function buildModelPingRequest(spec: ResolvedConfig): { path: string; body: string } {
  if (spec.apiStyle === 'anthropic-messages') {
    const path = spec.baseURL.endsWith('/v1/messages')
      ? spec.baseURL
      : spec.baseURL.endsWith('/v1')
        ? `${spec.baseURL}/messages`
        : `${spec.baseURL}/v1/messages`
    return {
      path,
      body: JSON.stringify({ model: spec.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    }
  }
  if (spec.apiStyle === 'responses') {
    return {
      path: `${spec.baseURL}/responses`,
      body: JSON.stringify({ model: spec.model, max_output_tokens: 1, input: 'ping' }),
    }
  }
  return {
    path: `${spec.baseURL}/chat/completions`,
    body: JSON.stringify({ model: spec.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  }
}

/**
 * Ping the configured model once and return the round-trip milliseconds.
 * The completion reply is drained, never parsed: a 2xx proves the endpoint
 * routed the model and answered; every failure throws with a prefixed
 * message the route envelopes.
 * @param spec - the resolved configuration under test.
 * @param apiKey - the credential the ping authenticates with.
 * @param signal - caller cancellation.
 * @returns the ping's round-trip milliseconds.
 */
export async function testModelConnection(spec: ResolvedConfig, apiKey: string, signal?: AbortSignal): Promise<number> {
  const { path, body } = buildModelPingRequest(spec)
  const headers: Record<string, string> = spec.apiStyle === 'anthropic-messages'
    ? { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
  const started = Date.now()
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers,
      body,
      redirect: 'error',
      signal: withTimeout(signal),
    })
  } catch (error) {
    throw new Error(`describe-image: endpoint unreachable: ${(error as Error).message ?? String(error)}`)
  }
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403
      ? ' (key rejected)'
      : response.status === 404 ? ' (model not found)' : ''
    throw new Error(`describe-image: model ping returned HTTP ${response.status}${reason}`)
  }
  // Drain within the bound so the connection releases; the text is irrelevant.
  await readBoundedBody(response, PROBE_MAX_BODY_BYTES)
  return Math.max(1, Date.now() - started)
}

/** The model test's outcome: a round-trip latency or one envelope-ready error. */
export type ModelTestOutcome =
  | { ok: true; latencyMs: number }
  | { ok: false; error: { code: 'rejected' | 'internal'; message: string } }

/**
 * Ping the model named by the merged configuration. Unlike the listing, the
 * test requires a model: the overrides carry the card's model draft along
 * with the connection fields, and an absent model is a rejection the card
 * surfaces instead of a silent no-op.
 * @param stored - the settings currently in effect.
 * @param overrides - unsaved drafts from the card (non-string values ignored).
 * @param resolveKey - the credential resolver for the final configuration.
 * @param signal - caller cancellation.
 * @returns the latency, or the structured failure.
 */
export async function handleModelTest(
  stored: Config,
  overrides: Record<string, unknown>,
  resolveKey: ProbeKeyResolver,
  signal?: AbortSignal,
): Promise<ModelTestOutcome> {
  const candidate: Config = { ...stored }
  const baseURL = overrides['baseURL']
  const apiStyle = overrides['apiStyle']
  const draftKey = overrides['apiKey']
  const model = overrides['model']
  if (typeof baseURL === 'string' && baseURL.trim().length > 0) candidate.baseURL = baseURL
  if (typeof apiStyle === 'string' && apiStyle.trim().length > 0) candidate.apiStyle = apiStyle as ApiStyle
  if (typeof model === 'string' && model.trim().length > 0) candidate.model = model
  // An empty draft key means "keep the current key": the secret is redacted
  // from the card, so an empty field cannot distinguish "unchanged" from
  // "cleared" — leave the stored value untouched and let the resolver run
  // its normal chain.
  if (typeof draftKey === 'string' && draftKey.trim().length > 0) candidate.apiKey = draftKey
  if (typeof candidate.model !== 'string' || candidate.model.trim() === '') {
    return { ok: false, error: { code: 'rejected', message: 'describe-image: pick a model before testing connectivity' } }
  }
  let spec: ResolvedConfig
  try {
    spec = resolveConfig(candidate)
  } catch (error) {
    return { ok: false, error: { code: 'rejected', message: (error as Error).message } }
  }
  let resolvedKey: string
  try {
    resolvedKey = await resolveKey(spec)
  } catch (error) {
    return { ok: false, error: { code: 'rejected', message: (error as Error).message } }
  }
  try {
    return { ok: true, latencyMs: await testModelConnection(spec, resolvedKey, signal) }
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: (error as Error).message } }
  }
}

/** The probe handler's outcome: a model list or one envelope-ready error. */
export type ModelProbeOutcome =
  | { ok: true; models: string[] }
  | { ok: false; error: { code: 'rejected' | 'internal'; message: string } }

/**
 * Run one model probe against a candidate configuration. The overrides carry
 * the settings card's unsaved drafts so the user can verify an endpoint
 * before saving; absent fields fall back to the stored settings. An empty
 * draft key means "keep the current key": the stored inline key is dropped
 * so the credential seam re-resolves, matching how a vision call resolves
 * its key. Only the connection fields a probe can change are honored; every
 * other draft stays with the stored settings.
 * @param stored - the settings currently in effect.
 * @param overrides - unsaved drafts from the card (non-string values ignored).
 * @param resolveKey - the credential resolver for the final configuration.
 * @param signal - caller cancellation.
 * @returns the listing, or the structured failure.
 */
export async function handleModelProbe(
  stored: Config,
  overrides: Record<string, unknown>,
  resolveKey: ProbeKeyResolver,
  signal?: AbortSignal,
): Promise<ModelProbeOutcome> {
  const candidate: Config = { ...stored }
  const baseURL = overrides['baseURL']
  const apiStyle = overrides['apiStyle']
  const draftKey = overrides['apiKey']
  if (typeof baseURL === 'string' && baseURL.trim().length > 0) candidate.baseURL = baseURL
  // resolveConfig re-judges the style and rejects anything outside the union.
  if (typeof apiStyle === 'string' && apiStyle.trim().length > 0) candidate.apiStyle = apiStyle as ApiStyle
  // An empty draft key keeps the stored one (the secret is redacted from the
  // card, so an empty field reads as "unchanged", never "cleared").
  if (typeof draftKey === 'string' && draftKey.trim().length > 0) candidate.apiKey = draftKey
  // The probe runs before the user has a model to name; pin the placeholder
  // so resolveConfig's vision-call check does not block the listing.
  if (typeof candidate.model !== 'string' || candidate.model.trim() === '') {
    candidate.model = PROBE_MODEL_PLACEHOLDER
  }
  let spec: ResolvedConfig
  try {
    spec = resolveConfig(candidate)
  } catch (error) {
    return { ok: false, error: { code: 'rejected', message: (error as Error).message } }
  }
  let resolvedKey: string
  try {
    resolvedKey = await resolveKey(spec)
  } catch (error) {
    return { ok: false, error: { code: 'rejected', message: (error as Error).message } }
  }
  try {
    return { ok: true, models: await probeModels(spec, resolvedKey, signal) }
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: (error as Error).message } }
  }
}
