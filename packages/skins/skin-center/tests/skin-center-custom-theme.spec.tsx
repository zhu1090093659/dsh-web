// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

import { SkinCenter } from '../src/client/SkinCenter.tsx'
import { CustomThemeController } from '../src/client/custom-theme-controller.ts'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'
import { CUSTOM_THEME_DEFAULTS, type CustomThemeConfig } from '../src/core/custom-theme.ts'

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

const t = (key: SkinCenterKey): string => zh[key] ?? key

function customScope(
  initial: Partial<CustomThemeConfig> = CUSTOM_THEME_DEFAULTS,
  acceptWrites: boolean | ((field: string, next: unknown) => boolean) = true,
): SettingsScope<CustomThemeConfig> {
  let value = { ...initial } as CustomThemeConfig
  const listeners = new Set<() => void>()
  const snapshot: SettingsScopeSnapshot<CustomThemeConfig> = {
    status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host',
  }
  return {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field, next) => {
      const accepted = typeof acceptWrites === 'function'
        ? acceptWrites(field, next)
        : acceptWrites
      if (!accepted) throw new Error('settings write rejected')
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
    },
    unset: async () => {},
  }
}

let root: Root
let host: HTMLDivElement
let customTheme: CustomThemeController

const noDirs: string[] = []
const mint = {
  origin: 'builtin',
  warnings: [],
  manifest: {
    id: 'mint', name: 'Mint', nameEn: 'Mint', tagline: 'Mint skin',
    contributes: { stylesheet: 'skin.css' },
  },
}

async function renderSkinCenter(options: {
  active?: string | null
  switchTo?: (id: string | null, state: { active: string | null }) => Promise<string | null>
  runSkin?: (action: () => Promise<string | null>) => Promise<string | null>
  runCustomTheme?: (action: () => Promise<string | null>) => Promise<string | null>
} = {}): Promise<void> {
  const active = options.active ?? null
  const controllerState = { active, trying: null, previewing: false }
  const themeSnapshot = { active: { colorScheme: 'light' } }
  const catalog = [mint]
  const runtime = {
    controller: {
      active,
      layers: {},
      getState: () => controllerState,
      subscribe: () => () => {},
      tryOn: async () => null,
      exitTryOn: async () => null,
      switchTo: options.switchTo === undefined
        ? async id => id
        : id => options.switchTo!(id, controllerState),
      refresh: async () => null,
      shutdown: () => {},
    },
    catalog: () => catalog,
    diagnostics: () => [],
    refreshCatalog: async () => {},
    find: (id: string) => catalog.find(entry => entry.manifest.id === id) ?? null,
    subscribe: () => () => {},
    shutdown: () => {},
  }
  const wallpaper = {
    enabled: () => true, selection: () => '', mode: () => 'live', fit: () => 'cover', dim: () => 0,
    wallpaperBlur: () => 0, pauseOnHidden: () => false, sound: () => false, volume: () => 100,
    dirs: () => noDirs, addDir: () => {}, removeDir: () => {}, activeId: () => null, trying: () => false,
    subscribe: () => () => {}, setEnabled: () => {}, setMode: () => {}, setFit: () => {}, setDim: () => {},
    setBlur: () => {}, setPauseOnHidden: () => {}, setSound: () => {}, setVolume: () => {},
    applySelection: () => {}, clearSelection: () => {}, sync: () => {}, tryOn: () => {}, exitTryOn: () => {},
    recoverScenePlayer: () => {}, dispose: () => {},
  }
  await act(async () => {
    root.render(<SkinCenter
      t={t as never}
      runtime={runtime as never}
      preview={{
        runSkin: options.runSkin ?? (async action => await action()),
        runWallpaper: async action => { action() },
        runCustomTheme: options.runCustomTheme ?? (async action => await action()),
      } as never}
      customTheme={customTheme}
      theme={{
        getTheme: () => themeSnapshot as never,
        subscribe: () => () => {},
        setTheme: () => {},
      }}
      background={{
        enabled: () => true, opacity: () => 0, blurEmpty: () => 0, blurContent: () => 0,
        inputCardBlur: () => 10, subscribe: () => () => {}, setEnabled: () => {}, set: () => {},
        setBlurEmpty: () => {}, setBlurContent: () => {}, setInputCardBlur: () => {}, dispose: () => {},
      }}
      wallpaper={wallpaper as never}
    />)
  })
}

function cardNamed(name: string): HTMLElement {
  const label = Array.from(host.querySelectorAll('span')).find(node => node.textContent === name)
  const card = label?.parentElement?.parentElement
  if (!(card instanceof HTMLElement)) throw new Error(`missing ${name} card`)
  return card
}

function buttonNamed(card: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(card.querySelectorAll('button')).find(node => node.textContent === name)
  if (button === undefined) throw new Error(`missing ${name} button`)
  return button
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  host = document.getElementById('root') as HTMLDivElement
  root = createRoot(host)
  customTheme = new CustomThemeController(customScope(), { doc: document })
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, installDir: null, total: 0, portableCount: 0, wallpapers: [] }),
  })))
})

afterEach(() => {
  act(() => { root.unmount() })
  customTheme.dispose()
  vi.unstubAllGlobals()
})

describe('SkinCenter custom theme placement', () => {
  it('renders the custom theme after every catalog skin', async () => {
    await renderSkinCenter()

    const customCard = host.querySelector('[data-dsh-custom-theme-card]')
    expect(customCard).not.toBeNull()
    expect(customCard?.parentElement?.lastElementChild).toBe(customCard)
    expect(customCard?.previousElementSibling?.textContent).toContain('Mint')
  })
})

describe('SkinCenter custom theme transactions', () => {
  it('keeps the custom theme applied when a third-party skin fails to activate', async () => {
    await customTheme.apply()
    const switchTo = vi.fn(async () => null)
    await renderSkinCenter({ switchTo })

    await click(buttonNamed(cardNamed('Mint'), t('apply')))

    expect(customTheme.getState().applied).toBe(true)
    expect(host.textContent).toContain(t('applyFailed'))
  })

  it('rolls back a third-party switch when custom-theme deactivation fails', async () => {
    customTheme.dispose()
    customTheme = new CustomThemeController(
      customScope({ ...CUSTOM_THEME_DEFAULTS, applied: true }, (field, next) => field !== 'applied' || next === true),
      { doc: document },
    )
    const calls: Array<string | null> = []
    await renderSkinCenter({ switchTo: async (id, state) => {
      calls.push(id)
      state.active = id
      return id
    } })

    await click(buttonNamed(cardNamed('Mint'), t('apply')))

    expect(calls).toEqual(['mint', null])
    expect(customTheme.getState().applied).toBe(true)
    expect(host.textContent).toContain(t('applyFailed'))
  })

  it('rolls back the stock switch when custom-theme deactivation fails', async () => {
    customTheme.dispose()
    customTheme = new CustomThemeController(
      customScope({ ...CUSTOM_THEME_DEFAULTS, applied: true }, (field, next) => field !== 'applied' || next === true),
      { doc: document },
    )
    const calls: Array<string | null> = []
    await renderSkinCenter({ active: 'mint', switchTo: async (id, state) => {
      calls.push(id)
      state.active = id
      return id
    } })

    await click(buttonNamed(cardNamed('官方默认'), t('restore')))

    expect(calls).toEqual([null, 'mint'])
    expect(customTheme.getState().applied).toBe(true)
    expect(host.textContent).toContain(t('applyFailed'))
  })

  it('does not leave the current skin when custom-theme persistence is rejected', async () => {
    customTheme.dispose()
    customTheme = new CustomThemeController(customScope(CUSTOM_THEME_DEFAULTS, false), { doc: document })
    const switchTo = vi.fn(async () => null)
    await renderSkinCenter({ active: 'mint', switchTo })

    const customCard = host.querySelector('[data-dsh-custom-theme-card]')
    if (customCard === null) throw new Error('missing custom theme card')
    await click(buttonNamed(customCard, t('apply')))

    expect(switchTo).not.toHaveBeenCalled()
    expect(host.textContent).toContain(t('applyFailed'))
  })

  it('rolls back the custom marker when the stock skin fails to activate', async () => {
    let appliedWhenSwitching = false
    const switchTo = vi.fn(async () => {
      appliedWhenSwitching = customTheme.getState().applied
      return 'mint'
    })
    await renderSkinCenter({ active: 'mint', switchTo })

    const customCard = host.querySelector('[data-dsh-custom-theme-card]')
    if (customCard === null) throw new Error('missing custom theme card')
    await click(buttonNamed(customCard, t('apply')))

    expect(appliedWhenSwitching).toBe(true)
    expect(customTheme.getState().applied).toBe(false)
    expect(host.textContent).toContain(t('applyFailed'))
  })

  it('disables the custom-theme entry while another theme transaction is pending', async () => {
    let release!: () => void
    const transaction = new Promise<string | null>(resolve => { release = () => { resolve(null) } })
    const runSkin = vi.fn(async () => await transaction)
    await renderSkinCenter({ runSkin })

    const customCard = host.querySelector('[data-dsh-custom-theme-card]')
    if (customCard === null) throw new Error('missing custom theme card')
    const apply = buttonNamed(customCard, t('apply'))

    const mintCard = cardNamed('Mint')
    await act(async () => {
      buttonNamed(mintCard, t('apply')).click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(apply.disabled).toBe(true)

    await act(async () => { apply.click() })
    expect(runSkin).toHaveBeenCalledTimes(1)
    release()
    await act(async () => { await transaction })
  })
})
