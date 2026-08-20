// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { CustomThemeController, type CustomThemeScope } from '../src/client/custom-theme-controller.ts'
import { CustomThemePanel } from '../src/client/CustomThemePanel.tsx'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

function scope(): CustomThemeScope {
  let value = {}
  const listeners = new Set<() => void>()
  const result: SettingsScope<Record<string, never>> = {
    getSnapshot: (): SettingsScopeSnapshot<Record<string, never>> => ({ status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    set: async (key, next) => { value = { ...value, [key]: next }; for (const listener of listeners) listener() },
    unset: async key => { const next = { ...value }; delete next[key as string]; value = next; for (const listener of listeners) listener() },
  }
  return result as unknown as CustomThemeScope
}

describe('custom theme card', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let customTheme: CustomThemeController
  const tryOn = vi.fn(async () => null)
  const switchTo = vi.fn(async () => null)
  const runtimeState = { active: null, trying: null, previewing: false }
  const runtime = {
    controller: {
      tryOn,
      switchTo,
      exitTryOn: vi.fn(async () => null),
      getState: () => runtimeState,
    },
    subscribe: (listener: () => void) => { return () => listener },
  }
  const t = (key: SkinCenterKey): string => zh[key]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    customTheme = new CustomThemeController(scope(), document)
    act(() => {
      root.render(<CustomThemePanel t={t} runtime={runtime as never} theme={{ getTheme: () => ({ active: { colorScheme: 'light' } }) as never }} customTheme={customTheme} />)
    })
  })

  afterEach(() => {
    act(() => { root.unmount() })
    customTheme.dispose()
    host.remove()
    tryOn.mockClear()
    switchTo.mockClear()
  })

  it('renders an editor without a background-image control', () => {
    const edit = [...host.querySelectorAll('button')].find(button => button.textContent === zh.editTheme)
    expect(edit).toBeTruthy()
    act(() => { edit?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(host.querySelector('[data-custom-theme-editor="true"]')).not.toBeNull()
    expect(host.textContent).not.toContain('背景图片')
    expect(host.textContent).toContain(zh.customThemeReset)
  })

  it('uses the existing runtime try-on and apply methods', async () => {
    const buttons = [...host.querySelectorAll('button')]
    const tryButton = buttons.find(button => button.textContent === zh.tryOn)
    const applyButton = buttons.find(button => button.textContent === zh.apply)
    await act(async () => { tryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(tryOn).toHaveBeenCalledWith(null, null)
    expect(switchTo).toHaveBeenCalledWith(null, null)
  })

  it('allows a hex field to be edited character by character before blur commits it', async () => {
    const edit = [...host.querySelectorAll('button')].find(button => button.textContent === zh.editTheme)
    act(() => { edit?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const field = [...host.querySelectorAll('input[type="text"]')].find(input => input.getAttribute('aria-label') === `${zh.customThemeAccent} hex`) as HTMLInputElement
    expect(field).toBeTruthy()
    act(() => {
      field.value = '#1'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.value = '#12'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.value = '#123456'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('blur', { bubbles: true }))
    })
    expect(customTheme.profile().accent).toBe('#123456')
  })
})
