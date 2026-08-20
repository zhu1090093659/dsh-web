// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CustomThemeController,
  type CustomThemeConfig,
} from '../src/client/custom-theme-controller.ts'
import { DEFAULT_CUSTOM_THEME } from '../src/client/custom-theme.ts'

function fakeScope(initial: Partial<CustomThemeConfig> = {}): {
  scope: SettingsScope<CustomThemeConfig>
  value: CustomThemeConfig
} {
  let value = { ...initial } as CustomThemeConfig
  const listeners = new Set<() => void>()
  const scope: SettingsScope<CustomThemeConfig> = {
    getSnapshot: (): SettingsScopeSnapshot<CustomThemeConfig> => ({
      status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host',
    }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: async (field, next) => {
      value = { ...value, [field]: next as never }
      for (const listener of listeners) listener()
    },
    unset: async field => {
      const next = { ...value }
      delete next[field as keyof CustomThemeConfig]
      value = next
      for (const listener of listeners) listener()
    },
  }
  return { scope, get value() { return value } }
}

describe('custom theme controller', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>'
    localStorage.removeItem('dsh-skin-custom-theme:v1')
  })

  it('resets only the currently selected scheme', async () => {
    const fake = fakeScope({ lightAccent: '#abcdef', darkAccent: '#123456' })
    const controller = new CustomThemeController(fake.scope, document)

    controller.setScheme('dark')
    controller.resetCurrent()
    await Promise.resolve()

    expect(fake.value.darkAccent).toBe(DEFAULT_CUSTOM_THEME.dark.accent)
    expect(fake.value.lightAccent).toBe('#abcdef')
    controller.dispose()
  })

  it('mounts custom CSS for official base and hides it for a third-party preview', () => {
    const fake = fakeScope({ applied: true })
    const controller = new CustomThemeController(fake.scope, document)

    controller.setBaseSkinState({ active: null, trying: null, previewing: false })
    expect(document.querySelector('style[data-dsh-custom-theme]')?.textContent).toContain('--dsw-alias-brand-primary')

    controller.setBaseSkinState({ active: 'mint', trying: 'mint', previewing: true })
    expect(document.querySelector('style[data-dsh-custom-theme]')?.textContent).toBe('')
    expect(document.documentElement.hasAttribute('data-dsh-custom-theme')).toBe(false)
    controller.dispose()
  })

  it('keeps a temporary try-on separate from applied state', async () => {
    const fake = fakeScope()
    const controller = new CustomThemeController(fake.scope, document)
    controller.tryOn()
    expect(controller.getState().previewing).toBe(true)
    expect(fake.value.applied).not.toBe(true)
    controller.exitTryOn()
    expect(controller.getState().previewing).toBe(false)
    expect(fake.value.applied).not.toBe(true)
    controller.dispose()
  })

  it('hides an applied custom theme while the official card is being previewed', () => {
    const fake = fakeScope({ applied: true })
    const controller = new CustomThemeController(fake.scope, document)
    expect(document.querySelector('style[data-dsh-custom-theme]')?.textContent).toContain('--dsw-alias-brand-primary')
    controller.setBaseSkinState({ active: null, trying: null, previewing: true })
    expect(document.querySelector('style[data-dsh-custom-theme]')?.textContent).toBe('')
    controller.setBaseSkinState({ active: null, trying: null, previewing: false })
    expect(document.querySelector('style[data-dsh-custom-theme]')?.textContent).toContain('--dsw-alias-brand-primary')
    controller.dispose()
  })

  it('restores an applied profile from its browser fallback when the host scope has no user layer', async () => {
    const initial = new CustomThemeController(fakeScope().scope, document)
    initial.setScheme('dark')
    initial.set('accent', '#123456')
    initial.apply()
    await Promise.resolve()
    initial.dispose()

    const restarted = new CustomThemeController(fakeScope().scope, document)
    restarted.setScheme('dark')
    expect(restarted.getState().applied).toBe(true)
    expect(restarted.getState().visible).toBe(true)
    expect(restarted.profile().accent).toBe('#123456')
    expect(document.querySelector('style[data-dsh-custom-theme]')?.textContent).toContain('--dsw-alias-brand-primary: #123456')
    restarted.dispose()
  })
})
