// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

import { CustomThemeController } from '../src/client/custom-theme-controller.ts'
import { CUSTOM_THEME_DEFAULTS, type CustomThemeConfig } from '../src/core/custom-theme.ts'

function fakeScope(initial: Partial<CustomThemeConfig> = {}, rejectWrites = false): {
  scope: SettingsScope<CustomThemeConfig>
  calls: Array<{ field: string; value: unknown }>
} {
  let value = { ...initial } as CustomThemeConfig
  const calls: Array<{ field: string; value: unknown }> = []
  const listeners = new Set<() => void>()
  const snapshot: SettingsScopeSnapshot<CustomThemeConfig> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const scope: SettingsScope<CustomThemeConfig> = {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, next) => {
      if (rejectWrites) throw new Error('settings write rejected')
      calls.push({ field, value: next })
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
    },
    unset: async field => {
      value = { ...value }
      delete value[field]
      for (const listener of listeners) listener()
    },
  }
  return { scope, calls }
}

function delayedScope(initial: Partial<CustomThemeConfig> = {}): {
  scope: SettingsScope<CustomThemeConfig>
  calls: Array<{ field: string; value: unknown }>
  resolveNext(): void
} {
  let value = { ...initial } as CustomThemeConfig
  const calls: Array<{ field: string; value: unknown }> = []
  const listeners = new Set<() => void>()
  const pending: Array<{
    field: string
    next: unknown
    resolve(): void
  }> = []
  const snapshot: SettingsScopeSnapshot<CustomThemeConfig> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const scope: SettingsScope<CustomThemeConfig> = {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, next) => {
      calls.push({ field, value: next })
      await new Promise<void>(resolve => {
        pending.push({ field, next, resolve })
      })
    },
    unset: async () => {},
  }
  return {
    scope,
    calls,
    resolveNext: () => {
      const write = pending.shift()
      if (write === undefined) throw new Error('no pending settings write')
      value = { ...value, [write.field]: write.next }
      for (const listener of listeners) listener()
      write.resolve()
    },
  }
}

function restoringScope(initial: Partial<CustomThemeConfig>): SettingsScope<CustomThemeConfig> {
  const value = { ...initial } as CustomThemeConfig
  const listeners = new Set<() => void>()
  const snapshot: SettingsScopeSnapshot<CustomThemeConfig> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  return {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => {
      for (const listener of listeners) listener()
    },
    unset: async () => {},
  }
}

describe('CustomThemeController', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-custom-theme')
    document.documentElement.removeAttribute('data-dsh-skin')
  })

  it('restores an applied configuration on construction', () => {
    const { scope } = fakeScope({ ...CUSTOM_THEME_DEFAULTS, applied: true })
    const controller = new CustomThemeController(scope, { doc: document })

    expect(controller.getState().applied).toBe(true)
    expect(document.documentElement.getAttribute('data-dsh-custom-theme')).toBe('true')
    expect(document.head.querySelector('style[data-dsh-custom-theme-style]')?.textContent)
      .toContain(`--dsw-alias-brand-primary: ${CUSTOM_THEME_DEFAULTS.light.accent};`)
    controller.dispose()
  })

  it('updates one profile atomically and persists the complete profile', async () => {
    const { scope, calls } = fakeScope(CUSTOM_THEME_DEFAULTS)
    const controller = new CustomThemeController(scope, { doc: document })

    controller.setProfileValue('light', 'accent', '#123456')
    controller.setProfileValue('light', 'contrast', 101)
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.profile('light')).toEqual({
      ...CUSTOM_THEME_DEFAULTS.light,
      accent: '#123456',
      contrast: 100,
    })
    expect(calls.at(-1)).toEqual({ field: 'light', value: controller.profile('light') })
    controller.dispose()
  })

  it('serializes profile writes without letting an older snapshot replace the latest edit', async () => {
    const { scope, calls, resolveNext } = delayedScope(CUSTOM_THEME_DEFAULTS)
    const controller = new CustomThemeController(scope, { doc: document })

    controller.setProfileValue('dark', 'accent', '#123456')
    controller.setProfileValue('dark', 'contrast', 80)

    expect(controller.profile('dark')).toEqual({
      ...CUSTOM_THEME_DEFAULTS.dark,
      accent: '#123456',
      contrast: 80,
    })
    expect(calls).toHaveLength(1)

    resolveNext()
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.profile('dark')).toEqual({
      ...CUSTOM_THEME_DEFAULTS.dark,
      accent: '#123456',
      contrast: 80,
    })
    expect(calls).toHaveLength(2)

    resolveNext()
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.profile('dark')).toEqual({
      ...CUSTOM_THEME_DEFAULTS.dark,
      accent: '#123456',
      contrast: 80,
    })
    controller.dispose()
  })

  it('surfaces rejected profile writes and restores the persisted value', async () => {
    const { scope } = fakeScope(CUSTOM_THEME_DEFAULTS, true)
    const controller = new CustomThemeController(scope, { doc: document })

    controller.setProfileValue('light', 'accent', '#123456')
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.profile('light').accent).toBe(CUSTOM_THEME_DEFAULTS.light.accent)
    expect(controller.getState().writeError).toBe('settings write rejected')
    controller.dispose()
  })

  it('surfaces rejected reset writes and restores the persisted profile', async () => {
    const { scope } = fakeScope({
      ...CUSTOM_THEME_DEFAULTS,
      light: { ...CUSTOM_THEME_DEFAULTS.light, accent: '#123456' },
    }, true)
    const controller = new CustomThemeController(scope, { doc: document })

    controller.reset('light')
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.profile('light').accent).toBe('#123456')
    expect(controller.getState().writeError).toBe('settings write rejected')
    controller.dispose()
  })

  it('previews without persistence and exit restores the inactive state', () => {
    const { scope, calls } = fakeScope(CUSTOM_THEME_DEFAULTS)
    const controller = new CustomThemeController(scope, { doc: document })

    controller.tryOn()
    expect(controller.getState()).toMatchObject({ applied: false, previewing: true, visible: true })
    expect(document.documentElement.hasAttribute('data-dsh-custom-theme')).toBe(true)
    expect(calls).toHaveLength(0)

    controller.exitTryOn()
    expect(controller.getState()).toMatchObject({ applied: false, previewing: false, visible: false })
    expect(document.documentElement.hasAttribute('data-dsh-custom-theme')).toBe(false)
    expect(calls).toHaveLength(0)
    controller.dispose()
  })

  it('suspends and resumes an applied theme without changing persistence', () => {
    const { scope, calls } = fakeScope({ ...CUSTOM_THEME_DEFAULTS, applied: true })
    const controller = new CustomThemeController(scope, { doc: document })

    controller.suspend()
    expect(controller.getState().visible).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-custom-theme')).toBe(false)
    controller.resume()
    expect(controller.getState().visible).toBe(true)
    expect(document.documentElement.hasAttribute('data-dsh-custom-theme')).toBe(true)
    expect(calls).toHaveLength(0)
    controller.dispose()
  })

  it('apply and deactivate persist only the active marker', async () => {
    const { scope, calls } = fakeScope(CUSTOM_THEME_DEFAULTS)
    const controller = new CustomThemeController(scope, { doc: document })

    await controller.apply()
    expect(controller.getState()).toMatchObject({ applied: true, previewing: false, visible: true })
    expect(calls.at(-1)).toEqual({ field: 'applied', value: true })

    await controller.deactivate()
    expect(controller.getState()).toMatchObject({ applied: false, previewing: false, visible: false })
    expect(calls.at(-1)).toEqual({ field: 'applied', value: false })
    controller.dispose()
  })

  it('rejects apply when the host restores the inactive snapshot', async () => {
    const controller = new CustomThemeController(restoringScope(CUSTOM_THEME_DEFAULTS), { doc: document })

    await expect(controller.apply()).rejects.toThrow()
    expect(controller.getState()).toMatchObject({ applied: false, previewing: false, visible: false })
    controller.dispose()
  })

  it('rejects deactivate when the host restores the applied snapshot', async () => {
    const controller = new CustomThemeController(restoringScope({
      ...CUSTOM_THEME_DEFAULTS,
      applied: true,
    }), { doc: document })

    await expect(controller.deactivate()).rejects.toThrow()
    expect(controller.getState()).toMatchObject({ applied: true, previewing: false, visible: true })
    controller.dispose()
  })

  it('reset changes only the requested mode', () => {
    const { scope } = fakeScope({
      ...CUSTOM_THEME_DEFAULTS,
      light: { accent: '#010203', background: '#040506', foreground: '#070809', contrast: 10 },
      dark: { accent: '#111213', background: '#141516', foreground: '#171819', contrast: 90 },
    })
    const controller = new CustomThemeController(scope, { doc: document })

    controller.reset('light')
    expect(controller.profile('light')).toEqual(CUSTOM_THEME_DEFAULTS.light)
    expect(controller.profile('dark')).toEqual({
      accent: '#111213', background: '#141516', foreground: '#171819', contrast: 90,
    })
    controller.dispose()
  })
})
