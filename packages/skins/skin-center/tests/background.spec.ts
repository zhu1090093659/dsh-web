// @vitest-environment jsdom
/**
 * BackgroundController regression tests for the v2 transport-based controller:
 * the occlusion veil and the per-state backdrop blur (empty vs. with-content
 * conversation). A recording persist callback stands in for the POST
 * transport, so no network and no settings surface is ever touched.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SkinBackgroundConfig } from '../src/core/background.ts'
import {
  BackgroundController,
  BLUR_CONTENT_FIELD,
  BLUR_EMPTY_FIELD,
  BUBBLE_ALPHA_VAR,
  BUBBLE_OPACITY_FIELD,
  SCRIM_VAR,
  INPUT_CARD_BLUR_FIELD,
  INPUT_CARD_BLUR_VAR,
} from '../src/client/background.ts'

/** A persist recorder: captures every full snapshot handed to the transport. */
function makePersist(): { calls: SkinBackgroundConfig[], fn: (next: SkinBackgroundConfig) => void } {
  const calls: SkinBackgroundConfig[] = []
  return { calls, fn: next => { calls.push(next) } }
}

/** The complete snapshot for the schema-default state. */
function defaultSnapshot(): SkinBackgroundConfig {
  return {
    enabled: true,
    backgroundOpacity: 0,
    backgroundBlurEmpty: 0,
    backgroundBlurContent: 0,
    inputCardBlur: 10,
    bubbleOpacity: 50,
  }
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
  })

  it('defaults: no blur element and the occlusion var is still set', () => {
    const persist = makePersist()
    const controller = new BackgroundController(null, persist.fn)
    expect(blurElement()).toBeNull()
    // Occlusion is unchanged: the veil variable is written on a default-0 state.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0')
    controller.dispose()
  })

  it('setBlurEmpty(6) creates a fixed element and persists the full snapshot', () => {
    const persist = makePersist()
    const controller = new BackgroundController(null, persist.fn)
    controller.setBlurEmpty(6)
    const element = blurElement()
    expect(element).not.toBeNull()
    expect(element!.style.backdropFilter).toContain('blur(6px)')
    // The Safari vendor prefix is set via setProperty; jsdom drops it, so
    // only the standard property is observable here.
    expect(element!.style.pointerEvents).toBe('none')
    expect(persist.calls).toHaveLength(1)
    expect(persist.calls[0]).toEqual({ ...defaultSnapshot(), [BLUR_EMPTY_FIELD]: 6 })
    controller.dispose()
  })

  it('switches blur strength between empty and content states', async () => {
    const persist = makePersist()
    const controller = new BackgroundController(
      { backgroundBlurEmpty: 2, backgroundBlurContent: 10 },
      persist.fn,
    )
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
    const persist = makePersist()
    const controller = new BackgroundController(
      { backgroundBlurEmpty: 2, backgroundBlurContent: 10 },
      persist.fn,
    )
    expect(blurElement()!.style.backdropFilter).toContain('blur(2px)')
    addOfficialConversationRow()
    await flush()
    expect(blurElement()!.style.backdropFilter).toContain('blur(10px)')
    controller.dispose()
  })

  it('removes the element when the active value becomes 0, and dispose leaves nothing', () => {
    const persist = makePersist()
    const controller = new BackgroundController({ backgroundBlurEmpty: 4 }, persist.fn)
    expect(blurElement()).not.toBeNull()
    controller.setBlurEmpty(0)
    expect(blurElement()).toBeNull()
    // A later DOM change after dispose does nothing.
    controller.dispose()
    addConversationRow()
    expect(blurElement()).toBeNull()
  })

  it('clamps setBlurEmpty(99) to 20', () => {
    const persist = makePersist()
    const controller = new BackgroundController(null, persist.fn)
    controller.setBlurEmpty(99)
    expect(controller.blurEmpty()).toBe(20)
    expect(blurElement()!.style.backdropFilter).toContain('blur(20px)')
    expect(persist.calls[0]).toEqual({ ...defaultSnapshot(), [BLUR_EMPTY_FIELD]: 20 })
    controller.dispose()
  })

  it('absent blur fields behave as 0', () => {
    const persist = makePersist()
    const controller = new BackgroundController({ backgroundOpacity: 42 }, persist.fn)
    expect(controller.blurEmpty()).toBe(0)
    expect(controller.blurContent()).toBe(0)
    expect(blurElement()).toBeNull()
    // Occlusion still reads its own field.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.42')
    controller.dispose()
  })

  it('disabled section (enabled=false) applies no scrim var and no blur element even with nonzero values', () => {
    const persist = makePersist()
    const controller = new BackgroundController(
      { enabled: false, backgroundOpacity: 60, backgroundBlurEmpty: 8 },
      persist.fn,
    )
    expect(controller.enabled()).toBe(false)
    // Occlusion is gated: the veil variable is removed, not written.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('')
    // Blur is gated: no blur element is created despite a nonzero blur value.
    expect(blurElement()).toBeNull()
    controller.dispose()
  })

  it('wallpaper active suppresses the background blur layer even with nonzero blur (#777 decouple)', () => {
    document.documentElement.setAttribute('data-dsh-wallpaper-active', 'true')
    const persist = makePersist()
    const controller = new BackgroundController({ backgroundBlurEmpty: 6 }, persist.fn)
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

  it('setEnabled(true) restores occlusion application', () => {
    const persist = makePersist()
    const controller = new BackgroundController({ enabled: false, backgroundOpacity: 60 }, persist.fn)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('')
    controller.setEnabled(true)
    expect(controller.enabled()).toBe(true)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.6')
    expect(persist.calls).toHaveLength(1)
    expect(persist.calls[0].enabled).toBe(true)
    controller.dispose()
  })

  it('applies, persists, and cleans up input-card blur', () => {
    const persist = makePersist()
    const controller = new BackgroundController({ inputCardBlur: 6 }, persist.fn)
    expect(controller.inputCardBlur()).toBe(6)
    expect(document.body.style.getPropertyValue(INPUT_CARD_BLUR_VAR)).toBe('6px')
    controller.setInputCardBlur(99)
    expect(controller.inputCardBlur()).toBe(20)
    expect(persist.calls[0]).toEqual({ ...defaultSnapshot(), [INPUT_CARD_BLUR_FIELD]: 20 })
    controller.dispose()
    expect(document.body.style.getPropertyValue(INPUT_CARD_BLUR_VAR)).toBe('')
  })

  it('applies, persists, and cleans up message bubble opacity', () => {
    const persist = makePersist()
    const controller = new BackgroundController({ bubbleOpacity: 35 }, persist.fn)
    expect(controller.bubbleOpacity()).toBe(35)
    expect(document.body.style.getPropertyValue(BUBBLE_ALPHA_VAR)).toBe('0.35')
    controller.setBubbleOpacity(105)
    expect(controller.bubbleOpacity()).toBe(100)
    expect(document.body.style.getPropertyValue(BUBBLE_ALPHA_VAR)).toBe('1')
    expect(persist.calls[0]).toEqual({ ...defaultSnapshot(), [BUBBLE_OPACITY_FIELD]: 100 })
    controller.dispose()
    expect(document.body.style.getPropertyValue(BUBBLE_ALPHA_VAR)).toBe('')
  })

  it('setEnabled persists the complete snapshot', () => {
    const persist = makePersist()
    const controller = new BackgroundController(null, persist.fn)
    controller.setEnabled(false)
    expect(controller.enabled()).toBe(false)
    expect(persist.calls).toEqual([{ ...defaultSnapshot(), enabled: false }])
    controller.dispose()
  })

  it('init backfills every field from a late-arriving payload without persisting', async () => {
    const persist = makePersist()
    const controller = new BackgroundController(null, persist.fn)
    controller.init({
      enabled: true,
      backgroundOpacity: 100,
      backgroundBlurEmpty: 4,
      backgroundBlurContent: 5,
      inputCardBlur: 12,
      bubbleOpacity: 60,
    })
    expect(controller.opacity()).toBe(100)
    expect(controller.blurEmpty()).toBe(4)
    expect(controller.blurContent()).toBe(5)
    expect(controller.inputCardBlur()).toBe(12)
    expect(controller.bubbleOpacity()).toBe(60)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('1')
    expect(blurElement()!.style.backdropFilter).toContain('blur(4px)')
    // init is a read path: nothing is persisted.
    expect(persist.calls).toHaveLength(0)
    controller.dispose()
  })

  it('init clamps out-of-range values and null restores the defaults', () => {
    const persist = makePersist()
    const controller = new BackgroundController(null, persist.fn)
    controller.init({ backgroundOpacity: 250, backgroundBlurEmpty: 99, bubbleOpacity: -5 })
    expect(controller.opacity()).toBe(100)
    expect(controller.blurEmpty()).toBe(20)
    expect(controller.bubbleOpacity()).toBe(0)
    controller.init(null)
    expect(controller.opacity()).toBe(0)
    expect(controller.blurEmpty()).toBe(0)
    expect(controller.bubbleOpacity()).toBe(50)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0')
    controller.dispose()
  })
})
