// @vitest-environment jsdom
/**
 * Client-half registration test for the skin-center browser bundle: asserts
 * that apply() registers the Skin Center as a first-level settings section
 * (`settings.section`) rather than a plugin-configuration card
 * (`settings.plugin.item`), without mounting the whole runtime.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => ({
    getSnapshot: () => init,
    set: () => {},
    update: () => {},
    subscribe: () => () => {},
  }),
}))

describe('skin-center client registration', () => {
  it('registers into settings.section, not settings.plugin.item', () => {
    const injected: string[] = []
    const fakeCtx = {
      effect: (fn: () => unknown) => {
        fn()
        return () => {}
      },
      locale: {
        register: () => {},
        bind: () => (key: string) => key,
      },
      get: (name: string) =>
        name === 'theme'
          ? {
              getTheme: () => ({ active: { colorScheme: 'light' } }),
              subscribe: () => () => {},
              setTheme: () => {},
            }
          : undefined,
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({
            status: 'ready' as const,
            writable: false,
            value: {},
            base: {},
            user: {},
            revision: 1,
            mode: 'host' as const,
          }),
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
      on: () => () => {},
      slots: {
        inject: (name: string) => {
          injected.push(name)
          return () => {}
        },
        register: () => () => {},
      },
    }

    apply(fakeCtx as never)

    expect(injected).toContain('settings.section')
    expect(injected).not.toContain('settings.plugin.item')
  })
})
