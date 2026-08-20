// @vitest-environment jsdom
/**
 * BackgroundController regression tests for the skin-background namespace:
 * the occlusion veil and the per-state backdrop blur (empty vs. with-content
 * conversation). A fake SettingsScope drives reads / writes so no real
 * settings surface is ever touched.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  BackgroundController,
  BLUR_CARD_FIELD,
  BLUR_CONTENT_FIELD,
  BLUR_EMPTY_FIELD,
  CARD_BLUR_VAR,
  SCRIM_VAR,
} from '../src/client/background.ts'

/** Shape of the fake scope's section. */
interface Section {
  enabled?: boolean
  backgroundOpacity?: number
  backgroundBlurEmpty?: number
  backgroundBlurContent?: number
  backgroundBlurCard?: number
}

/** A fake SettingsScope recording every set() call. */
function fakeScope(initial: Partial<Section> = {}): {
  scope: SettingsScope<Section>
  calls: Array<{ field: string; value: unknown }>
  setValue: (value: Section) => void
} {
  let value = { ...initial } as Section
  const calls: Array<{ field: string; value: unknown }> = []
  const listeners = new Set<() => void>()
  const snapshot: SettingsScopeSnapshot<Section> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const scope: SettingsScope<Section> = {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, val) => {
      calls.push({ field, value: val })
      value = { ...value, [field]: val as never }
      for (const listener of listeners) listener()
    },
    unset: async field => {
      value = { ...value }
      delete value[field as keyof Section]
      for (const listener of listeners) listener()
    },
  }
  return { scope, calls, setValue: next => { value = next } }
}

/** Find the injected fixed backdrop-filter element, if present. */
function blurElement(): HTMLElement | null {
  const element = document.body.querySelector<HTMLElement>('div[aria-hidden="true"]')
  return element?.style.position === 'fixed' ? element : null
}

/** Flush the MutationObserver's coalesced rAF recheck. */
async function flush(): Promise<void> {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/** Wrap one conversation message row inside the conversation pane. */
function addConversationRow(): void {
  const pane = document.createElement('div')
  pane.setAttribute('data-pane', 'conversation')
  const row = document.createElement('div')
  row.className = 'somehash_userRow'
  pane.appendChild(row)
  document.body.appendChild(pane)
}

function addOfficialConversationRow(): void {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', 'turn-1')
  document.body.appendChild(row)
}

function removeConversationRow(): void {
  document.body.querySelectorAll('[data-pane="conversation"]').forEach(node => node.remove())
  document.body.querySelectorAll('[data-chat-anchor-key]').forEach(node => node.remove())
}

describe('BackgroundController', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-wallpaper-active')
    document.documentElement.style.removeProperty(CARD_BLUR_VAR)
  })

  it('defaults: no blur element and the occlusion var is still set', () => {
    const { scope } = fakeScope()
    const controller = new BackgroundController(scope)
    expect(blurElement()).toBeNull()
    // Occlusion is unchanged: the veil variable is written on a default-0 scope.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0')
    controller.dispose()
  })

  it('setBlurEmpty(6) creates a fixed element and persists via scope.set', () => {
    const { scope, calls } = fakeScope()
    const controller = new BackgroundController(scope)
    controller.setBlurEmpty(6)
    const element = blurElement()
    expect(element).not.toBeNull()
    expect(element!.style.backdropFilter).toContain('blur(6px)')
    // The Safari vendor prefix is set via setProperty; jsdom drops it, so
    // only the standard property is observable here.
    expect(element!.style.pointerEvents).toBe('none')
    expect(calls).toContainEqual({ field: BLUR_EMPTY_FIELD, value: 6 })
    controller.dispose()
  })

  it('switches blur strength between empty and content states', async () => {
    const { scope } = fakeScope({ backgroundBlurEmpty: 2, backgroundBlurContent: 10 })
    const controller = new BackgroundController(scope)
    // Empty conversation -> empty blur.
    expect(blurElement()!.style.backdropFilter).toContain('blur(2px)')
    // A hash-prefixed message row flips the state to with-content.
    addConversationRow()
    await flush()
    expect(blurElement()!.style.backdropFilter).toContain('blur(10px)')
    // Removing the row flips back to the empty state.
    removeConversationRow()
    await flush()
    expect(blurElement()!.style.backdropFilter).toContain('blur(2px)')
    controller.dispose()
  })

  it('detects official shell message rows without the compat data-pane shim', async () => {
    const { scope } = fakeScope({ backgroundBlurEmpty: 2, backgroundBlurContent: 10 })
    const controller = new BackgroundController(scope)
    expect(blurElement()!.style.backdropFilter).toContain('blur(2px)')
    addOfficialConversationRow()
    await flush()
    expect(blurElement()!.style.backdropFilter).toContain('blur(10px)')
    controller.dispose()
  })

  it('removes the element when the active value becomes 0, and dispose leaves nothing', () => {
    const { scope } = fakeScope({ backgroundBlurEmpty: 4 })
    const controller = new BackgroundController(scope)
    expect(blurElement()).not.toBeNull()
    controller.setBlurEmpty(0)
    expect(blurElement()).toBeNull()
    // A later DOM change after dispose does nothing.
    controller.dispose()
    addConversationRow()
    expect(blurElement()).toBeNull()
  })

  it('clamps setBlurEmpty(99) to 20', () => {
    const { scope, calls } = fakeScope()
    const controller = new BackgroundController(scope)
    controller.setBlurEmpty(99)
    expect(controller.blurEmpty()).toBe(20)
    expect(blurElement()!.style.backdropFilter).toContain('blur(20px)')
    expect(calls).toContainEqual({ field: BLUR_EMPTY_FIELD, value: 20 })
    controller.dispose()
  })

  it('getSnapshot with absent blur fields behaves as 0', () => {
    const { scope } = fakeScope({ backgroundOpacity: 42 })
    const controller = new BackgroundController(scope)
    expect(controller.blurEmpty()).toBe(0)
    expect(controller.blurContent()).toBe(0)
    expect(blurElement()).toBeNull()
    // Occlusion still reads its own field.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.42')
    controller.dispose()
  })

  it('disabled section (enabled=false) applies no scrim var and no blur element even with nonzero values', () => {
    const { scope } = fakeScope({ enabled: false, backgroundOpacity: 60, backgroundBlurEmpty: 8 })
    const controller = new BackgroundController(scope)
    expect(controller.enabled()).toBe(false)
    // Occlusion is gated: the veil variable is removed, not written.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('')
    // Blur is gated: no blur element is created despite a nonzero blur value.
    expect(blurElement()).toBeNull()
    controller.dispose()
  })

  it('wallpaper active suppresses the background blur layer even with nonzero blur (#777 decouple)', () => {
    document.documentElement.setAttribute('data-dsh-wallpaper-active', 'true')
    const { scope } = fakeScope({ backgroundBlurEmpty: 6 })
    const controller = new BackgroundController(scope)
    expect(blurElement()).toBeNull()
    controller.setBlurEmpty(10)
    expect(blurElement()).toBeNull()
    // Unmount wallpaper: the blur layer is allowed again on the next sync.
    document.documentElement.removeAttribute('data-dsh-wallpaper-active')
    controller.setBlurEmpty(10)
    expect(blurElement()).not.toBeNull()
    expect(blurElement()!.style.backdropFilter).toContain('blur(10px)')
    controller.dispose()
  })

  it('applies and persists the card glass blur variable (#805 slider)', () => {
    const { scope, calls } = fakeScope({ backgroundBlurCard: 8 })
    const controller = new BackgroundController(scope)
    expect(document.documentElement.style.getPropertyValue(CARD_BLUR_VAR)).toContain('blur(8px)')
    controller.setCardBlur(16)
    expect(document.documentElement.style.getPropertyValue(CARD_BLUR_VAR)).toContain('blur(16px)')
    expect(calls).toContainEqual({ field: BLUR_CARD_FIELD, value: 16 })
    controller.dispose()
    expect(document.documentElement.style.getPropertyValue(CARD_BLUR_VAR)).toBe('')
  })

  it('setEnabled(true) restores occlusion application', () => {
    const { scope } = fakeScope({ enabled: false, backgroundOpacity: 60 })
    const controller = new BackgroundController(scope)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('')
    controller.setEnabled(true)
    expect(controller.enabled()).toBe(true)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.6')
    controller.dispose()
  })

  it('setEnabled persists via scope.set', () => {
    const { scope, calls } = fakeScope()
    const controller = new BackgroundController(scope)
    controller.setEnabled(false)
    expect(controller.enabled()).toBe(false)
    expect(calls).toContainEqual({ field: 'enabled', value: false })
    controller.dispose()
  })
})
