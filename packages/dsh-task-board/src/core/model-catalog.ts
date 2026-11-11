/**
 * Host model catalog: the routes this deployment serves, the reasoning metadata
 * their adapters expose, and the normalization the board reads them through.
 *
 * The board publishes the catalog (the settings card's model and level pickers
 * read it) and resolves a card's pinned reasoning effort against it, so "this
 * model declares that level" is answered from the host's own configuration
 * instead of a guess. Framework-free (no cordis, no SDK imports) because both
 * halves compile it.
 *
 * @module dsh-task-board/core/model-catalog
 */

/** One resolved `provider/model` route. */
export interface ModelRoute {
  provider: string
  model: string
  /** Reasoning level the route is configured or resolved at; absent means inherit. */
  reasoningEffort?: string
}

/** One reasoning-effort option an adapter exposes for an exact model route. */
export interface CatalogReasoningEffort {
  id: string
  name?: string
}

/** One adapter-discovered model of the host catalog. */
export interface CatalogModel {
  id: string
  name?: string
  reasoning?: { efforts: CatalogReasoningEffort[]; defaultEffort?: string }
}

/** One provider route and its models. */
export interface CatalogGroup {
  id: string
  name?: string
  models: CatalogModel[]
}

/** The host model catalog the board resolves routes and reasoning levels against. */
export interface ModelCatalogView {
  /** The route an unconfigured session starts at: the host's own configuration. */
  default?: ModelRoute
  groups: CatalogGroup[]
}

/** Split a qualified `provider/model` route; undefined when it is not one. */
export function parseModelRoute(qualified: string | undefined): { provider: string; model: string } | undefined {
  const raw = qualified?.trim() ?? ''
  if (raw === '') return undefined
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash === raw.length - 1) return undefined
  const provider = raw.slice(0, slash).trim()
  const model = raw.slice(slash + 1).trim()
  if (provider === '' || model === '') return undefined
  return { provider, model: model }
}

/**
 * Normalize the raw `session/modelCatalog` reply into the shape the board
 * reads. Everything is optional in the wire value, so every level is checked:
 * an unreadable catalog degrades to "unknown", never to a crash.
 * @param value - the raw gateway reply.
 * @returns the normalized catalog, or undefined when nothing usable arrived.
 */
export function normalizeCatalog(value: unknown): ModelCatalogView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  let fallback: ModelRoute | undefined
  const rawDefault = row.default
  if (typeof rawDefault === 'object' && rawDefault !== null) {
    const route = rawDefault as Record<string, unknown>
    if (typeof route.provider === 'string' && route.provider !== '' && typeof route.model === 'string' && route.model !== '') {
      fallback = {
        provider: route.provider,
        model: route.model,
        ...(typeof route.reasoningEffort === 'string' && route.reasoningEffort !== '' ? { reasoningEffort: route.reasoningEffort } : {}),
      }
    }
  }
  const groups: CatalogGroup[] = []
  for (const entry of Array.isArray(row.groups) ? row.groups : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const group = entry as Record<string, unknown>
    if (typeof group.id !== 'string' || group.id === '') continue
    const models: CatalogModel[] = []
    for (const item of Array.isArray(group.models) ? group.models : []) {
      if (typeof item !== 'object' || item === null) continue
      const model = item as Record<string, unknown>
      if (typeof model.id !== 'string' || model.id === '') continue
      const reasoning = typeof model.reasoning === 'object' && model.reasoning !== null
        ? model.reasoning as Record<string, unknown>
        : undefined
      const efforts: CatalogReasoningEffort[] = []
      for (const effort of Array.isArray(reasoning?.efforts) ? reasoning.efforts as unknown[] : []) {
        if (typeof effort !== 'object' || effort === null) continue
        const option = effort as Record<string, unknown>
        if (typeof option.id !== 'string' || option.id === '') continue
        efforts.push({ id: option.id, ...(typeof option.name === 'string' ? { name: option.name } : {}) })
      }
      const defaultEffort = typeof reasoning?.defaultEffort === 'string' && reasoning.defaultEffort !== '' ? reasoning.defaultEffort : undefined
      models.push({
        id: model.id,
        ...(typeof model.name === 'string' ? { name: model.name } : {}),
        ...(reasoning === undefined ? {} : { reasoning: { efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) } }),
      })
    }
    groups.push({ id: group.id, ...(typeof group.name === 'string' ? { name: group.name } : {}), models })
  }
  if (fallback === undefined && groups.length === 0) return undefined
  return { ...(fallback === undefined ? {} : { default: fallback }), groups }
}
