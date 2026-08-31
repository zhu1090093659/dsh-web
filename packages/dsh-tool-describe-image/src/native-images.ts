/**
 * Native-image-request configuration for the DeepSeek adapter (rc.8 feature).
 *
 * The DeepSeek chat-completions adapter accepts image blocks in user
 * messages when the catalogued model's `inputModalities` includes
 * "image"; the official model settings UI does not expose that field, so
 * this plugin (the family's image seam) hosts a loopback route pair that
 * reports the current agent-default route's image-input state and toggles
 * the `llm-deepseek` settings namespace's `models[]` entry for the
 * current model. Writes ride the official settings seam (schema validation,
 * revision fencing, persistence and event emission stay with the host) and
 * are guarded by the same loopback + same-origin fence as the attach
 * routes; the browser never sees or supplies credentials.
 *
 * Fail-closed: a host without the `llm-deepseek` namespace (adapter not
 * mounted), a missing settings seam, or a missing agentDefaultModel service
 * answers `supported: false` and rejects every write.
 * @module @linxin666/dsh-tool-describe-image/native-images
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { isLoopbackRequest } from './loopback.ts'
import { readJsonBody, writeJson } from './http.ts'
import { optionalService, UNKNOWN_CAPABILITY, type InvalidatableRouteResolver, type ModelImageCapability, type RouteCapabilityResolver } from './model-capability.ts'

/** The DeepSeek adapter's settings namespace. */
export const LLM_DEEPSEEK_SETTINGS_NAMESPACE = 'llm-deepseek' as SettingsNamespace

/** Native-image wire state for the browser half. */
export interface NativeImageState {
  /** The route the toggle operates on (absent when no default selection exists). */
  provider?: string
  model?: string
  /** Resolved image-input verdict for the route (same resolver as the send hook). */
  capability: ModelImageCapability
  /** The catalogued model's inputModalities; absent when not catalogued. */
  inputModalities?: readonly string[]
  /** The adapter namespace is registered and the settings seam is writable. */
  supported: boolean
}

/** Minimal face of the agentDefaultModel service. */
interface DefaultModelFace {
  currentSelection(): { provider?: string; model?: string }
}

/** One catalogued model entry inside the adapter settings value. */
interface CatalogModelEntry {
  id?: unknown
  inputModalities?: unknown
}

/** Minimal face of the host settings seam this route writes through. */
interface SettingsFace {
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: unknown; value?: unknown; revision?: number }>
  mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
  writable?: boolean
}

/** One descriptor of the adapter namespace, resolved from the settings seam. */
interface AdapterDescriptor {
  value?: unknown
  revision?: number
}

/** Resolve the adapter settings namespace for one route. */
function adapterNamespaceForRoute(route: { provider: string; model: string } | undefined): SettingsNamespace {
  if (route && route.provider) {
    return `llm-${route.provider}` as SettingsNamespace
  }
  return LLM_DEEPSEEK_SETTINGS_NAMESPACE
}

/** Resolve the adapter namespace descriptor (undefined when unregistered). */
function adapterDescriptor(settings: SettingsFace | undefined, preferredNs?: SettingsNamespace): { descriptor?: AdapterDescriptor; ns: SettingsNamespace } {
  const targetNs = preferredNs ?? LLM_DEEPSEEK_SETTINGS_NAMESPACE
  if (settings === undefined) return { ns: targetNs }
  const descriptors = settings.describe({ redactSecrets: true })
  let match = descriptors.find((candidate) => String(candidate.ns) === String(targetNs))
  let effectiveNs = targetNs
  if (match === undefined && targetNs !== LLM_DEEPSEEK_SETTINGS_NAMESPACE) {
    match = descriptors.find((candidate) => String(candidate.ns) === String(LLM_DEEPSEEK_SETTINGS_NAMESPACE))
    if (match !== undefined) effectiveNs = LLM_DEEPSEEK_SETTINGS_NAMESPACE
  }
  if (match === undefined || settings.writable === false) return { ns: effectiveNs }
  return { descriptor: { value: match.value, revision: match.revision }, ns: effectiveNs }
}

/** The catalogued modalities of one model, or undefined when absent. */
function cataloguedModalities(descriptor: AdapterDescriptor | undefined, model: string): readonly string[] | undefined {
  const value = descriptor?.value as { models?: unknown } | null | undefined
  const models = Array.isArray(value?.models) ? value.models as CatalogModelEntry[] : []
  const entry = models.find((candidate) => candidate.id === model)
  if (entry === undefined || !Array.isArray(entry.inputModalities)) return undefined
  return entry.inputModalities.filter((item): item is string => typeof item === 'string')
}

/** The current agent-default route (absent when no selection exists). */
function currentRoute(ctx: Context): { provider: string; model: string } | undefined {
  const selection = optionalService<DefaultModelFace>(ctx, 'agentDefaultModel')?.currentSelection()
  if (typeof selection?.provider !== 'string' || selection.provider === '' || typeof selection.model !== 'string' || selection.model === '') {
    return undefined
  }
  return { provider: selection.provider, model: selection.model }
}

/**
 * Assemble the read-only state view the browser half renders.
 * @param ctx - registrant context.
 * @param resolver - shared exact-route resolver (same instance as the send hook).
 * @returns the state (async: the route verdict may probe the adapter).
 */
export async function readNativeImageState(ctx: Context, resolver: RouteCapabilityResolver): Promise<NativeImageState> {
  const route = currentRoute(ctx)
  const preferredNs = adapterNamespaceForRoute(route)
  const { descriptor } = adapterDescriptor(optionalService<SettingsFace>(ctx, 'settings'), preferredNs)
  const capability = route === undefined ? UNKNOWN_CAPABILITY : await resolver(route)
  return {
    ...(route === undefined ? {} : { provider: route.provider, model: route.model }),
    capability,
    ...(route === undefined ? {} : {
      inputModalities: cataloguedModalities(descriptor, route.model),
    }),
    supported: descriptor !== undefined && route !== undefined,
  }
}

/**
 * Toggle native image input for the current agent-default model: rewrite
 * the adapter catalog entry's `inputModalities` to ["text","image"] (or
 * back to ["text"]) through the official settings seam, fenced by the
 * descriptor's revision so a concurrent edit fails with a conflict instead
 * of clobbering it.
 * @param ctx - registrant context.
 * @param enabled - whether the model should accept image input natively.
 * @throws on an unsupported host, a missing route, or a revision conflict.
 */
export async function setNativeImageEnabled(ctx: Context, enabled: boolean, resolver?: { invalidate(route: { provider: string; model: string }): void }): Promise<void> {
  const route = currentRoute(ctx)
  if (route === undefined) throw new Error('native-images: no agent default model selection')
  const settings = optionalService<SettingsFace>(ctx, 'settings')
  if (settings === undefined) throw new Error('native-images: settings service not available')
  const preferredNs = adapterNamespaceForRoute(route)
  const { descriptor, ns } = adapterDescriptor(settings, preferredNs)
  if (descriptor === undefined) {
    throw new Error(`native-images: settings namespace '${String(ns)}' is not available`)
  }
  const value = descriptor.value as { models?: unknown } | null | undefined
  const models = Array.isArray(value?.models) ? value.models as CatalogModelEntry[] : []
  const index = models.findIndex((entry) => entry.id === route.model)
  const modalities = enabled ? ['text', 'image'] : ['text']
  const next = models.map((entry) => ({ ...entry }))
  if (index === -1) {
    next.push({ id: route.model, inputModalities: modalities })
  } else {
    next[index] = { ...next[index], inputModalities: modalities }
  }
  try {
    await settings.mutate(ns, [
      { op: 'set', path: ['models'], value: next },
    ], descriptor.revision)
  } catch (error) {
    const fresh = adapterDescriptor(settings, ns).descriptor
    if (fresh?.revision !== undefined) {
      await settings.mutate(ns, [
        { op: 'set', path: ['models'], value: next },
      ], fresh.revision)
    } else {
      throw error
    }
  }
  // Drop the cached capability verdict so the next read (and the POST
  // envelope) reflects the catalog just written.
  resolver?.invalidate(route)
}

/**
 * Register the native-image route pair. Both routes are loopback-fenced
 * with the same-origin browser markers; failures answer the official-shaped
 * envelope instead of leaking host internals.
 * @param ctx - registrant context.
 * @param resolver - shared exact-route resolver.
 * @returns the exact-path route registrations.
 */
/** Structural shape of one exact-path route (the package types the webserver seam without importing it). */
interface NativeImageRoute {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

export function registerNativeImageRoutes(ctx: Context, resolver: InvalidatableRouteResolver): NativeImageRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden', message: 'loopback only' })
      return false
    }
    return true
  }
  return [
    {
      kind: 'exact',
      path: '/describe-image/native-images',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method !== 'GET' && req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'method not allowed: ' + (req.method ?? '') })
          return
        }
        if (req.method === 'GET') {
          writeJson(res, 200, { ok: true, value: await readNativeImageState(ctx, resolver) })
          return
        }
        const body = await readJsonBody(req, { maxBytes: 4096 })
        if (body === null || typeof body !== 'object' || typeof (body as { enabled?: unknown }).enabled !== 'boolean') {
          writeJson(res, 400, { ok: false, code: 'bad-request', message: 'native-images: expected { enabled: boolean }' })
          return
        }
        try {
          await setNativeImageEnabled(ctx, (body as { enabled: boolean }).enabled, resolver)
          writeJson(res, 200, { ok: true, value: await readNativeImageState(ctx, resolver) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, /revision|conflict/i.test(message) ? 409 : 400, { ok: false, code: 'settings-rejected', message })
        }
      },
    },
  ]
}
