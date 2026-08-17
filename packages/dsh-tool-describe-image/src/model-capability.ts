/**
 * Model image-input capability probe. The describe-image send hook rewrites
 * image-bearing sends into attachment references for text-only models; a
 * model whose adapter declares the image input modality must receive the raw
 * image blocks instead, or its native vision is bypassed and every pasted
 * image forces a redundant describe_image call. The browser half cannot see
 * model metadata, so the host answers per session through the
 * /describe-image/capability route.
 *
 * The effective provider/model of a session is resolved from, in order: the
 * passive agent/request waterfall record (the exact config the loop
 * assembled, live model switches included), the agent's own options, then the
 * agentDefaultModel service. Modalities come from the owning adapter's exact
 * model metadata; an adapter that reports none is "unknown" and every failure
 * resolves conservative — acceptsImages false keeps the legacy rewrite, so a
 * probe failure can never strip images from a text-only model's reach.
 * @module @linxin666/dsh-tool-describe-image/model-capability
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

/** One session's image-input verdict. */
export interface ModelImageCapability {
  /** True only when the adapter positively declares image input for the route. */
  acceptsImages: boolean
  /** False when the route or its modalities could not be determined. */
  known: boolean
}

/** The conservative answer: unknown means "keep the legacy rewrite". */
export const UNKNOWN_CAPABILITY: ModelImageCapability = { acceptsImages: false, known: false }

/** Provider/model pair one session's requests run under. */
interface ModelRoute {
  provider: string
  model: string
}

/** Minimal face of the agent registry this probe reads. */
interface AgentRegistryFace {
  get(id: string): { options?: { provider?: string; model?: string } } | undefined
}

/** Minimal face of the agentDefaultModel service (official package, typed structurally). */
interface DefaultModelFace {
  currentSelection(): { provider?: string; model?: string }
}

/** Minimal face of the llm runtime's exact-model resolution. */
interface LlmFace {
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly string[] }>
}

/** Per-route metadata cache TTL: adapter model facts do not drift mid-process. */
const ROUTE_OK_TTL_MS = 10 * 60 * 1000
/** Failed resolutions retry sooner: a cold adapter may come up later. */
const ROUTE_ERR_TTL_MS = 30 * 1000
/** A hung adapter interrogation must never stall a send. */
const RESOLVE_TIMEOUT_MS = 3000

/** Read an optional, possibly untyped cordis service by name. */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  return (ctx.get as (key: string) => unknown).call(ctx, name) as T | undefined
}

/** Probe one session's image-input capability; every failure fails closed to {@link UNKNOWN_CAPABILITY}. */
export type CapabilityProbe = (sessionId: string) => Promise<ModelImageCapability>

/**
 * Create the per-mount probe. Installs a passive agent/request waterfall
 * listener that records the exact provider/model each agent's requests run
 * under — the one place live model switches surface before the next request
 * is built. The listener observes only: it always delegates and returns the
 * downstream config unchanged.
 * @param ctx - registrant context; the listener unwinds with the plugin.
 * @returns the session-id-keyed probe.
 */
export function createCapabilityProbe(ctx: Context): CapabilityProbe {
  const recorded = new Map<string, ModelRoute>()
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    recorded.set(String(payload.agent.id), { provider: resolved.provider, model: resolved.model })
    return resolved
  })

  // Exact-model metadata resolutions, cached per route: successes for ten
  // minutes, failures for thirty seconds, in-flight calls deduped.
  const routeCache = new Map<string, { at: number; cap: ModelImageCapability }>()
  const routeInflight = new Map<string, Promise<ModelImageCapability>>()

  const resolveRoute = async (route: ModelRoute): Promise<ModelImageCapability> => {
    const key = route.provider + '/' + route.model
    const hit = routeCache.get(key)
    if (hit !== undefined && Date.now() - hit.at < (hit.cap.known ? ROUTE_OK_TTL_MS : ROUTE_ERR_TTL_MS)) return hit.cap
    const pending = routeInflight.get(key)
    if (pending !== undefined) return pending
    const task = (async (): Promise<ModelImageCapability> => {
      const llm = optionalService<LlmFace>(ctx, 'llm')
      if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return UNKNOWN_CAPABILITY
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const info = await Promise.race([
          llm.resolveModelInfo(route.provider, route.model),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('resolveModelInfo timed out')), RESOLVE_TIMEOUT_MS)
          }),
        ])
        const modalities = info.inputModalities
        // Absent modalities mean the adapter disclosed nothing; only an
        // explicit 'image' entry is positive capability.
        if (modalities === undefined) return UNKNOWN_CAPABILITY
        return { acceptsImages: modalities.includes('image'), known: true }
      } catch {
        return UNKNOWN_CAPABILITY
      } finally {
        clearTimeout(timer)
      }
    })()
    routeInflight.set(key, task)
    try {
      const cap = await task
      routeCache.set(key, { at: Date.now(), cap })
      return cap
    } finally {
      routeInflight.delete(key)
    }
  }

  return async (sessionId: string): Promise<ModelImageCapability> => {
    const live = recorded.get(sessionId)
    if (live !== undefined) return resolveRoute(live)
    const agents = optionalService<AgentRegistryFace>(ctx, 'agents')
    const options = agents?.get(sessionId)?.options
    if (typeof options?.provider === 'string' && options.provider !== '' && typeof options.model === 'string' && options.model !== '') {
      return resolveRoute({ provider: options.provider, model: options.model })
    }
    const fallback = optionalService<DefaultModelFace>(ctx, 'agentDefaultModel')?.currentSelection()
    if (typeof fallback?.provider === 'string' && fallback.provider !== '' && typeof fallback.model === 'string' && fallback.model !== '') {
      return resolveRoute({ provider: fallback.provider, model: fallback.model })
    }
    return UNKNOWN_CAPABILITY
  }
}
