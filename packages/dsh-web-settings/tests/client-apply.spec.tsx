// @vitest-environment jsdom
/**
 * Client-half registration test for the web-ui-settings browser bundle:
 * asserts that apply() contributes the Web Plugins group as a first-level
 * settings section ("settings.section", a list slot keyed by id) rather than
 * as a plugin-configuration card ("settings.plugin.item", a keyed slot).
 *
 * Regression guard for issue #513: DSH 0.1.0-rc.6+ rejects keyed-slot
 * registrations without options.key, and the pre-0.1.18 bundles registered
 * the group card into "settings.plugin.item" with an id - which made the web
 * GUI fail to boot with "Failed to load plugins".
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/compat-settings-scope.ts', () => ({
  WebUiSettingsBinder: class {
    constructor(_ctx: unknown) {}
  },
}))

import { apply } from '../src/client/index.ts'

describe('web-ui-settings client registration', () => {
  it('registers into settings.section with an id, not the keyed settings.plugin.item slot', () => {
    const injected: string[] = []
    const registered: Array<Record<string, unknown>> = []
    const fakeCtx = {
      effect: (fn: () => unknown) => {
        fn()
        return () => {}
      },
      locale: {
        register: () => {},
        bind: () => (key: string) => key,
      },
      get: () => undefined,
      slots: {
        inject: (name: string, fn: () => unknown) => {
          injected.push(name)
          fn()
          return () => {}
        },
        register: (options: Record<string, unknown>) => {
          registered.push(options)
          return () => {}
        },
      },
    }

    apply(fakeCtx as never)

    expect(injected).toEqual(['settings.section'])
    expect(injected).not.toContain('settings.plugin.item')

    const section = registered.find((entry) => entry.name === 'settings.section')
    expect(section).toBeDefined()
    expect(section?.id).toBe('web-ui-plugins')
    expect(section?.children).toEqual({ 'web-ui.plugin.item': { kind: 'list', scope: 'root' } })

    // The keyed slot must stay untouched: the host rejects entries without
    // options.key and the group has no reason to contribute one there.
    expect(registered.some((entry) => entry.name === 'settings.plugin.item')).toBe(false)
  })
})
