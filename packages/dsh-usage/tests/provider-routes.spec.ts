import { describe, expect, it } from 'vitest'
import { foldAliasRoutes } from '../src/core/provider-routes.ts'

/**
 * Alias folding is the pure rule behind one-row-per-account rendering: the
 * host enumerates the runtime's live routes plus the configurable directory's
 * catalog entries, and this decides which route of one adapter family
 * survives.
 */

describe('adapter-family alias folding', () => {
  it('user with a configured DeepSeek route sees the live row, not the catalog alias', () => {
    // Given the runtime serves deepseek-official while the catalog still lists deepseek
    const routes = [
      { id: 'deepseek-official', displayName: 'DeepSeek', live: true },
      { id: 'deepseek', displayName: 'deepseek', live: false },
    ]

    // When the enumerated routes are folded
    const folded = foldAliasRoutes(routes)

    // Then only the live route survives, keeping its human display name
    expect(folded).toEqual([{ id: 'deepseek-official', displayName: 'DeepSeek', live: true }])
  })

  it('user with two configured routes of one family keeps both accounts', () => {
    // Given two live routes that share the GLM adapter family
    const routes = [
      { id: 'zai', displayName: 'zai', live: true },
      { id: 'zai-coding', displayName: 'zai-coding', live: true },
    ]

    // When the enumerated routes are folded
    const folded = foldAliasRoutes(routes)

    // Then neither configured account is mistaken for an alias
    expect(folded.map((route) => route.id)).toEqual(['zai', 'zai-coding'])
  })

  it('user with only catalog entries keeps them when no live route shadows the family', () => {
    // Given catalog-only entries for two adapter families the runtime serves nothing on
    const routes = [
      { id: 'deepseek', displayName: 'deepseek', live: false },
      { id: 'kimi-coding', displayName: 'kimi-coding', live: false },
    ]

    // When the enumerated routes are folded
    const folded = foldAliasRoutes(routes)

    // Then every route stays, because no live route of either family exists yet
    expect(folded.map((route) => route.id)).toEqual(['deepseek', 'kimi-coding'])
  })

  it('user with a live route of one family keeps unrelated catalog aliases', () => {
    // Given a live Kimi route beside a catalog-only DeepSeek entry
    const routes = [
      { id: 'kimi-coding', displayName: 'Kimi For Coding', live: true },
      { id: 'deepseek', displayName: 'deepseek', live: false },
    ]

    // When the enumerated routes are folded
    const folded = foldAliasRoutes(routes)

    // Then folding is family-scoped and leaves the other family's entry alone
    expect(folded.map((route) => route.id)).toEqual(['kimi-coding', 'deepseek'])
  })

  it('user with runtime routes outside the adapter directory keeps all of them', () => {
    // Given live routes no adapter serves (relay and local runtimes)
    const routes = [
      { id: 'ollama', displayName: 'ollama pro', live: true },
      { id: 'jiyuan', displayName: '基元', live: false },
    ]

    // When the enumerated routes are folded
    const folded = foldAliasRoutes(routes)

    // Then adapter-less routes pass through untouched regardless of liveness
    expect(folded.map((route) => route.id)).toEqual(['ollama', 'jiyuan'])
  })
})
