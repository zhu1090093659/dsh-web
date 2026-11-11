/**
 * Which reasoning effort one execution may actually send.
 *
 * The rule lives here, in one pure place, so the launch path cannot drift from
 * what the picker promises: an effort is sent ONLY for the exact model route
 * whose adapter declares that id. An unsupported value is dropped rather than
 * passed through — the Host validates the selection against the same
 * capability (`resolveCallConfig` rejects an unsupported effort) and the whole
 * model selection would fail with it. An absent effort stays absent: the SDK
 * then materializes the model's own default, which is exactly what "inherit
 * the model" means.
 *
 * A card that pins a bare model id also gets its provider resolved here: the
 * session wire contract requires `provider` (ModelSelection), so the catalog is
 * the only place that can complete the documented `provider/model` or model-id
 * pin.
 */
import type { CatalogModel, ModelCatalogView } from './model-catalog.ts'

/** One execution route an effort resolves against: `provider/model`, or a bare model id. */
export interface ReasoningRoute {
  provider?: string
  model: string
}

/** The catalog entry a route names, once the catalog can complete it. */
export interface DeclaredReasoningRoute {
  provider: string
  model: string
  /** The adapter's reasoning metadata; absent when it exposes none. */
  reasoning?: CatalogModel['reasoning']
}

/** What one card's effort resolves to for one route. */
export interface ReasoningEffortDecision {
  /** The effort to send; absent means "send none". */
  effort?: string
  /** The card's own value when it will NOT be sent. */
  dropped?: string
}

/** Trim one optional effort: blank text means "not set", like every other pinned target. */
export function normalizeReasoningEffort(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Complete one route through the host catalog: a qualified route must match its
 * provider group, and a bare model id matches the first group carrying it —
 * which is the provider the request then names.
 * @param catalog - the host model catalog, when this deployment serves one.
 * @param route - the route as the card pins it.
 * @returns the completed route with its reasoning metadata, or undefined when
 *   the catalog declares no such model.
 */
export function declaredRoute(
  catalog: ModelCatalogView | undefined,
  route: ReasoningRoute,
): DeclaredReasoningRoute | undefined {
  const groups = catalog?.groups ?? []
  const matched = route.provider === undefined || route.provider === ''
    ? groups.find(group => group.models.some(model => model.id === route.model))
    : groups.find(group => group.id === route.provider)
  const model = matched?.models.find(candidate => candidate.id === route.model)
  if (matched === undefined || model === undefined) return undefined
  return {
    provider: matched.id,
    model: model.id,
    ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
  }
}

/**
 * Resolve the effort one execution sends.
 * @param requested - the card's stored effort (absent or blank = inherit).
 * @param catalog - the host model catalog, when this deployment serves one.
 * @param route - the route the execution will actually run at.
 * @returns the effort to send, or the dropped value that will not be sent.
 */
export function resolveReasoningEffort(
  requested: string | undefined,
  catalog: ModelCatalogView | undefined,
  route: ReasoningRoute | undefined,
): ReasoningEffortDecision {
  const effort = normalizeReasoningEffort(requested)
  if (effort === undefined) return {}
  if (route === undefined) return { dropped: effort }
  const declared = declaredRoute(catalog, route)
  const supported = declared?.reasoning?.efforts.some(option => option.id === effort) === true
  return supported ? { effort } : { dropped: effort }
}
