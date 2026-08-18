// @vitest-environment jsdom
/**
 * Regression (skin-center try-on persistence): the "trying on" badge must
 * reflect the controller's live session, not component-local state. Closing
 * and reopening the settings panel unmounts and remounts the card while the
 * controller keeps the preview live, so the reopened card must still show the
 * badge and offer "Exit try-on" — never a second "Try on" (which used to
 * reload the bundle, strip the skin CSS and leave the page looking default
 * while the badge still claimed "trying on").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { SkinCenter } from '../src/client/SkinCenter.tsx'
import { SKIN_CENTER_ENTRIES } from '../src/client/generated/skins.ts'
import { resetHotOverride, TryOnController } from '../src/client/try-on.ts'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'

vi.mock('../src/client/WallpaperPanel.tsx', () => ({ WallpaperPanel: () => null }))

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

declare global {
  interface Window {
    __ModuleLoader__?: {
      load(handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }): void
    }
    __DSH_MODULES__?: {
      import(id: string): Promise<{ apply?: (ctx: unknown) => unknown }>
      invalidate(id: string): void
    }
    __DSH_BOOT__?: { entries: Array<{ id: string }> }
  }
}

/** Minimal ClientModuleSystem stand-in (same shape as try-on.spec.ts). */
const factories = new Map<string, (require: (spec: string) => unknown) => unknown>()

/** The real bundle text of a skin, read from its committed build artifact. */
const bundleTextFor = (id: string): string => {
  const relative = `../../../skins/${id}/lib/client.js`
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const noopBackground = {
  enabled: () => true,
  opacity: () => 0,
  blurEmpty: () => 0,
  blurContent: () => 0,
  bubbleOpacity: () => 50,
  subscribe: () => () => {},
  setEnabled: () => {},
  setOpacity: () => {},
  setBlurEmpty: () => {},
  setBlurContent: () => {},
  setBubbleOpacity: () => {},
}
// Cached snapshot: useSyncExternalStore loops when getSnapshot returns a
// fresh object on every call.
const themeSnapshot = { active: { colorScheme: 'light' } }
const theme = {
  getTheme: () => themeSnapshot,
  subscribe: () => () => {},
  setTheme: () => {},
}

const t = (key: SkinCenterKey) => zh[key] ?? key

beforeEach(() => {
  factories.clear()
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  window.__ModuleLoader__ = {
    load(handoff) {
      if (factories.has(handoff.id)) throw new Error(`duplicate factory ${handoff.id}`)
      factories.set(handoff.id, handoff.factory)
    },
  }
  window.__DSH_MODULES__ = {
    async import(id) {
      const factory = factories.get(id)
      if (factory === undefined) throw new Error(`no factory for ${id}`)
      return factory((spec) => { throw new Error(`unexpected require ${spec}`) }) as never
    },
    invalidate(id) {
      factories.delete(id)
    },
  }
  // Official default active: no skin in the boot graph.
  window.__DSH_BOOT__ = { entries: [] }
  resetHotOverride()
})

let roots: Array<{ root: Root; host: HTMLDivElement }> = []
afterEach(() => {
  while (roots.length > 0) {
    const { root, host } = roots.pop()!
    act(() => { root.unmount() })
    host.remove()
  }
})

/** Mount the settings card with a given controller (fresh DOM each call). */
const renderCard = (controller: TryOnController): { root: Root; host: HTMLDivElement } => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <SkinCenter t={t} controller={controller} theme={theme as never} background={noopBackground as never} wallpaper={{} as never} />,
    )
  })
  const pair = { root, host }
  roots.push(pair)
  return pair
}

/** The "Try on" button of the first skin card (button 0 is the official card's). */
const firstSkinTryOn = (host: HTMLDivElement): HTMLButtonElement => {
  const buttons = Array.from(host.querySelectorAll('button')).filter(button => button.textContent === zh.tryOn)
  expect(buttons[1], 'expected a "Try on" button for the first skin card').toBeDefined()
  return buttons[1] as HTMLButtonElement
}

describe('skin-center trying badge across card remounts', () => {
  it('keeps the tried-on skin and its exit control after the settings panel closes and reopens', async () => {
    const controller = new TryOnController({
      loadBundle: async target => { (0, eval)(bundleTextFor(target.id)) },
    })

    let { host } = renderCard(controller)
    const tryOn = firstSkinTryOn(host)
    act(() => { tryOn.click() })
    await act(async () => {})

    // The preview mounted: badge + exit control appear, exactly one of each.
    expect(host.textContent).toContain(zh.tryingOn)
    expect(Array.from(host.querySelectorAll('button')).filter(button => button.textContent === zh.exitTryOn)).toHaveLength(1)

    // "Close" the settings panel: unmount the card. The controller owns the
    // preview and keeps it live across the unmount.
    act(() => { roots[0].root.unmount() })
    roots[0].host.remove()
    roots = []

    // "Reopen" with the same controller: the badge is restored and the
    // tried-on skin offers Exit try-on, not a second Try on.
    ;({ host } = renderCard(controller))
    expect(host.textContent).toContain(zh.tryingOn)
    expect(Array.from(host.querySelectorAll('button')).filter(button => button.textContent === zh.exitTryOn)).toHaveLength(1)
    const tryButtons = Array.from(host.querySelectorAll('button')).filter(button => button.textContent === zh.tryOn)
    expect(tryButtons).toHaveLength(SKIN_CENTER_ENTRIES.length)

    // Exiting still works and clears the badge.
    const exitButtons = Array.from(host.querySelectorAll('button')).filter(button => button.textContent === zh.exitTryOn)
    act(() => { exitButtons[0].click() })
    expect(host.textContent).not.toContain(zh.tryingOn)
  })
})
