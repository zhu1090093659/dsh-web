/**
 * Alias folding for the enumerated provider routes. Kept in core because the
 * rule is pure — the host enumerates routes and this decides which of two
 * routes serving one adapter family survives.
 * @module @linxin666/dsh-usage/core/provider-routes
 */

import { adapterFor } from './adapters.ts'

/** The facts alias folding needs about one enumerated provider route. */
export interface FoldableRoute {
  /** Provider route key (`deepseek`, `deepseek-official`, custom routes, ...). */
  id: string
  /** Whether the LLM runtime serves requests on this route; a catalog-only entry is dormant. */
  live: boolean
}

/**
 * Drop dormant catalog aliases that shadow a live route of the same adapter
 * family. The pi-ai catalog ships route keys the runtime serves nothing on
 * until a profile declares them: for DeepSeek the catalog entry `deepseek`
 * sits beside the llm-deepseek runtime route `deepseek-official`, and both
 * resolve the same credential (the family's `apiKeyEnv` fallback), so probing
 * and rendering both turns one account into two identical balance rows.
 *
 * A family keeps every live route it has — two configured profiles are two
 * real accounts, not aliases. A route with no adapter, or one whose family
 * has no live route at all, is returned untouched.
 */
export function foldAliasRoutes<T extends FoldableRoute>(routes: readonly T[]): T[] {
  return routes.filter((route) => {
    if (route.live) return true
    const family = adapterFor(route.id)
    if (family === undefined) return true
    return !routes.some((other) => other.live && adapterFor(other.id) === family)
  })
}
