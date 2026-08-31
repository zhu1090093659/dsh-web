// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

import { CustomThemeCard } from '../src/client/CustomThemePanel.tsx'
import { CustomThemeController } from '../src/client/custom-theme-controller.ts'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'
import { CUSTOM_THEME_DEFAULTS, type CustomThemeConfig } from '../src/core/custom-theme.ts'

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

const t = (key: SkinCenterKey): string => zh[key] ?? key

function fakeScope(): SettingsScope<CustomThemeConfig> {
  let value = { ...CUSTOM_THEME_DEFAULTS } as CustomThemeConfig
  const listeners = new Set<() => void>()
  const snapshot: SettingsScopeSnapshot<CustomThemeConfig> = {
    status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host',
  }
  return {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, next) => {
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
    },
    unset: async field => {
      value = { ...value }
      delete value[field]
      for (const listener of listeners) listener()
    },
  }
}

let host: HTMLDivElement
let root: Root
let controller: CustomThemeController

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  host = document.getElementById('root') as HTMLDivElement
  root = createRoot(host)
  controller = new CustomThemeController(fakeScope(), { doc: document })
})

afterEach(() => {
  act(() => { root.unmount() })
  controller.dispose()
})

function render(scheme: 'light' | 'dark' = 'light'): void {
  act(() => {
    root.render(<CustomThemeCard
      t={t as never}
      customTheme={controller}
      scheme={scheme}
      setScheme={() => {}}
      isActive={false}
      isTrying={false}
      busy={false}
      disabled={false}
      onTryOn={() => {}}
      onExitTryOn={() => {}}
      onApply={() => {}}
    />)
  })
}

describe('CustomThemeCard', () => {
  it('keeps the editor collapsed until the edit button is pressed', () => {
    render()
    expect(host.textContent).toContain('自定义主题')
    expect(host.querySelector('input')).toBeNull()

    const edit = [...host.querySelectorAll('button')].find(button => button.textContent === '编辑')
    act(() => { edit?.click() })

    expect(host.querySelectorAll('input[type="color"]')).toHaveLength(3)
    expect(host.querySelectorAll('input[type="text"]')).toHaveLength(3)
    expect(host.querySelector('input[type="range"]')?.getAttribute('max')).toBe('100')
    expect(host.textContent).toContain('恢复当前模式默认')
  })

  it('keeps the color picker valid while a partial hex value is being typed', () => {
    render()
    const edit = [...host.querySelectorAll('button')].find(button => button.textContent === '编辑')
    act(() => { edit?.click() })
    const text = host.querySelector<HTMLInputElement>('input[aria-label="强调色 hex"]')!
    const picker = host.querySelector<HTMLInputElement>('input[aria-label="强调色"]')!

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(text, '#1')
      text.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(text.value).toBe('#1')
    expect(picker.value).toBe(CUSTOM_THEME_DEFAULTS.light.accent)
    expect(controller.profile('light').accent).toBe(CUSTOM_THEME_DEFAULTS.light.accent)
  })

  it('routes try-on, apply and exit through the supplied actions', () => {
    const onTryOn = vi.fn()
    const onApply = vi.fn()
    act(() => {
      root.render(<CustomThemeCard
        t={t as never}
        customTheme={controller}
        scheme="light"
        setScheme={() => {}}
        isActive={false}
        isTrying={false}
        busy={false}
        disabled={false}
        onTryOn={onTryOn}
        onExitTryOn={() => {}}
        onApply={onApply}
      />)
    })

    const buttons = [...host.querySelectorAll('button')]
    act(() => { buttons.find(button => button.textContent === '试穿')?.click() })
    act(() => { buttons.find(button => button.textContent === '应用')?.click() })
    expect(onTryOn).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
