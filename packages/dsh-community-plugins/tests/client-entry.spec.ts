import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'
import type { CommunityPluginsSettings } from '../src/client/CommunityPluginsCard.tsx'

vi.mock('../src/client/CommunityPluginsCard.tsx', () => ({
  CommunityPluginsCardController: class {
    inject() { return {} }
    dispose() {}
  },
  CommunityPluginsSection: () => null,
}))

function scope(): SettingsScope<CommunityPluginsSettings> {
  const snapshot: SettingsScopeSnapshot<CommunityPluginsSettings> = {
    status: 'unavailable',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  }
}

describe('community plugin client entry', () => {
  it('replaces the fallback settings section when its compatibility service arrives', () => {
    const officialBind = vi.fn(() => scope())
    const compatBind = vi.fn(() => scope())
    const registrations: Array<{ id?: string; priority?: number }> = []
    const activePriorities = new Set<number>()
    let injectCompat: ((ctx: unknown) => unknown) | undefined
    let compat: { bind: typeof compatBind } | undefined
    const ctx = {
      effect(callback: () => unknown) {
        callback()
        return () => {}
      },
      locale: {
        register: vi.fn(() => () => {}),
        bind: vi.fn(() => () => 'Community Plugins'),
      },
      settingsScope: { bind: officialBind },
      get(name: string) {
        return name === 'webUiSettings' ? compat : undefined
      },
      slots: {
        inject: vi.fn((_key: string, callback: () => unknown) => {
          const dispose = callback()
          return typeof dispose === 'function' ? dispose : () => {}
        }),
        register: vi.fn((options: { id?: string; priority?: number }) => {
          registrations.push(options)
          if (options.priority !== undefined) activePriorities.add(options.priority)
          return () => {
            if (options.priority !== undefined) activePriorities.delete(options.priority)
          }
        }),
      },
      inject: vi.fn((_deps: string[], callback: (injected: unknown) => unknown) => {
        injectCompat = callback
        return () => {}
      }),
    }

    apply(ctx as never)

    expect(officialBind).toHaveBeenCalledWith({ namespace: 'community-plugins' })
    expect(registrations).toMatchObject([{ id: 'community-plugins', priority: 10 }])
    expect([...activePriorities]).toEqual([10])

    compat = { bind: compatBind }
    const disposeCompat = injectCompat?.(ctx)

    expect(compatBind).toHaveBeenCalledWith({ namespace: 'community-plugins' })
    expect(registrations).toMatchObject([
      { id: 'community-plugins', priority: 10 },
      { id: 'community-plugins', priority: 0 },
    ])
    expect([...activePriorities]).toEqual([0])

    if (typeof disposeCompat === 'function') disposeCompat()
    expect([...activePriorities]).toEqual([10])
  })
})
