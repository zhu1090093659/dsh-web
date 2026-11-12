// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/compat-settings-scope.ts', () => ({
  WebUiSettingsBinder: function WebUiSettingsBinder(_ctx: unknown): void {},
}))

import { apply } from '../src/client/index.ts'

describe('web-ui-settings client registration', () => {
  it('user gets the stable parent section and its Web Plugins keyed child', () => {
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
      reflect: { provide: () => {} },
      slots: {
        inject: (name: string, fn: () => unknown) => {
          injected.push(name)
          fn()
          return () => {}
        },
        spec: () => ({ kind: 'keyed', scope: 'root' }),
        subscribe: () => () => {},
        entries: () => [],
        register: (options: Record<string, unknown>) => {
          registered.push(options)
          return () => {}
        },
      },
    }

    apply(fakeCtx as never)

    expect(injected).toEqual(['settings.section'])
    expect(injected).not.toContain('plugins.bundle.config')

    const section = registered.find((entry) => entry.name === 'settings.section')
    expect(section).toMatchObject({
      id: 'web-ui-plugins',
      order: 110,
      children: { 'web-ui.extension': { kind: 'keyed', scope: 'root' } },
    })

    const child = registered.find((entry) => entry.name === 'web-ui.extension')
    expect(child).toMatchObject({
      key: 'web-ui-plugins',
      children: { 'web-ui.plugin.item': { kind: 'list', scope: 'root' } },
    })
    expect(child).not.toHaveProperty('id')
    expect(child).not.toHaveProperty('order')
    expect(child).not.toHaveProperty('label')
    expect(registered.some((entry) => entry.name === 'plugins.bundle.config')).toBe(false)
  })
})
