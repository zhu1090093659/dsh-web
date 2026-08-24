// @vitest-environment jsdom
/**
 * BackgroundController regression tests: the occlusion veil and the
 * per-state backdrop blur (empty vs. with-content conversation). Since
 * issue #996 the controller owns no settings scope — tests drive it with an
 * initial config plus a recording persist callback, the transport shape the
 * client wiring uses.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SkinBackgroundConfig } from '../src/core/background.ts'
import {
  BackgroundController,
  BUBBLE_ALPHA_VAR,
  SCRIM_VAR,
  VEIL_VAR,
  INPUT_CARD_BLUR_VAR,
} from '../src/client/background.ts'

/** A recording persist callback plus the controller built over it. */
function rig(initial: SkinBackgroundConfig | null = null): {
  controller: BackgroundController
  writes: SkinBackgroundConfig[]
} {
  const writes: SkinBackgroundConfig[] = []
  const controller = new BackgroundController(initial, (next) => { writes.push(next) })
  return { controller, writes }
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
    const { controller } = rig()
    expect(blurElement()).toBeNull()
    // Occlusion is unchanged: the veil variable is written on a default-0 config.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0')
    controller.dispose()
  })

  it('mirrors every occlusion value onto the universal veil var (#1000)', () => {
    const { controller } = rig({ backgroundOpacity: 40 })
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.4')
    expect(document.body.style.getPropertyValue(VEIL_VAR)).toBe('0.4')
    // Live slider drags update both variables through one write path.
    controller.set(75)
    expect(document.body.style.getPropertyValue(VEIL_VAR)).toBe('0.75')
    // dispose cleans up the veil var it introduced (the legacy scrim var
    // keeps its pre-existing dispose semantics).
    controller.dispose()
    expect(document.body.style.getPropertyValue(VEIL_VAR)).toBe('')
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.75')
  })

  it('disabled config removes the veil var; re-enabling restores it', () => {
    const { controller } = rig({ enabled: false, backgroundOpacity: 60 })
    expect(document.body.style.getPropertyValue(VEIL_VAR)).toBe('')
    controller.setEnabled(true)
    expect(document.body.style.getPropertyValue(VEIL_VAR)).toBe('0.6')
    controller.setEnabled(false)
    expect(document.body.style.getPropertyValue(VEIL_VAR)).toBe('')
    controller.dispose()
  })

  it('setBlurEmpty(6) creates a fixed element and persists the whole snapshot', () => {
    const { controller, writes } = rig()
    controller.setBlurEmpty(6)
    const element = blurElement()
    expect(element).not.toBeNull()
    expect(element!.style.backdropFilter).toContain('blur(6px)')
    // The Safari vendor prefix is set via setProperty; jsdom drops it, so
    // only the standard property is observable here.
    expect(element!.style.pointerEvents).toBe('none')
    expect(writes).toHaveLength(1)
    expect(writes[0].backgroundBlurEmpty).toBe(6)
    controller.dispose()
  })

  it('switches blur strength between empty and content states', async () => {
    const { controller } = rig({ backgroundBlurEmpty: 2, backgroundBlurContent: 10 })
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
    const { controller } = rig({ backgroundBlurEmpty: 2, backgroundBlurContent: 10 })
    expect(blurElement()!.style.backdropFilter).toContain('blur(2px)')
    addOfficialConversationRow()
    await flush()
    expect(blurElement()!.style.backdropFilter).toContain('blur(10px)')
    controller.dispose()
  })

  it('removes the element when the active value becomes 0, and dispose leaves nothing', () => {
    const { controller } = rig({ backgroundBlurEmpty: 4 })
    expect(blurElement()).not.toBeNull()
    controller.setBlurEmpty(0)
    expect(blurElement()).toBeNull()
    // A later DOM change after dispose does nothing.
    controller.dispose()
    addConversationRow()
    expect(blurElement()).toBeNull()
  })

  it('clamps setBlurEmpty(99) to 20', () => {
    const { controller, writes } = rig()
    controller.setBlurEmpty(99)
    expect(controller.blurEmpty()).toBe(20)
    expect(blurElement()!.style.backdropFilter).toContain('blur(20px)')
    expect(writes[0].backgroundBlurEmpty).toBe(20)
    controller.dispose()
  })

  it('absent blur fields behave as 0 while occlusion reads its own field', () => {
    const { controller } = rig({ backgroundOpacity: 42 })
    expect(controller.blurEmpty()).toBe(0)
    expect(controller.blurContent()).toBe(0)
    expect(blurElement()).toBeNull()
    // Occlusion still reads its own field.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.42')
    controller.dispose()
  })

  it('disabled config (enabled=false) applies no scrim var and no blur element even with nonzero values', () => {
    const { controller } = rig({ enabled: false, backgroundOpacity: 60, backgroundBlurEmpty: 8 })
    expect(controller.enabled()).toBe(false)
    // Occlusion is gated: the veil variable is removed, not written.
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('')
    // Blur is gated: no blur element is created despite a nonzero blur value.
    expect(blurElement()).toBeNull()
    controller.dispose()
  })

  it('wallpaper active suppresses the background blur layer even with nonzero blur (#777 decouple)', () => {
    document.documentElement.setAttribute('data-dsh-wallpaper-active', 'true')
    const { controller } = rig({ backgroundBlurEmpty: 6 })
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

  it('setEnabled(true) restores occlusion application and persists', () => {
    const { controller, writes } = rig({ enabled: false, backgroundOpacity: 60 })
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('')
    controller.setEnabled(true)
    expect(controller.enabled()).toBe(true)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('0.6')
    expect(writes).toHaveLength(1)
    expect(writes[0].enabled).toBe(true)
    expect(writes[0].backgroundOpacity).toBe(60)
    controller.dispose()
  })

  it('applies, persists, and cleans up input-card blur', () => {
    const { controller, writes } = rig({ inputCardBlur: 6 })
    expect(controller.inputCardBlur()).toBe(6)
    expect(document.body.style.getPropertyValue(INPUT_CARD_BLUR_VAR)).toBe('6px')
    controller.setInputCardBlur(99)
    expect(controller.inputCardBlur()).toBe(20)
    expect(writes[0].inputCardBlur).toBe(20)
    controller.dispose()
    expect(document.body.style.getPropertyValue(INPUT_CARD_BLUR_VAR)).toBe('')
  })

  it('applies, persists, and cleans up message bubble opacity', () => {
    const { controller, writes } = rig({ bubbleOpacity: 35 })
    expect(controller.bubbleOpacity()).toBe(35)
    expect(document.body.style.getPropertyValue(BUBBLE_ALPHA_VAR)).toBe('0.35')
    controller.setBubbleOpacity(105)
    expect(controller.bubbleOpacity()).toBe(100)
    expect(document.body.style.getPropertyValue(BUBBLE_ALPHA_VAR)).toBe('1')
    expect(writes[0].bubbleOpacity).toBe(100)
    controller.dispose()
    expect(document.body.style.getPropertyValue(BUBBLE_ALPHA_VAR)).toBe('')
  })

  it('setEnabled(false) persists the master switch', () => {
    const { controller, writes } = rig()
    controller.setEnabled(false)
    expect(controller.enabled()).toBe(false)
    expect(writes[0].enabled).toBe(false)
    controller.dispose()
  })

  it('init() replaces every value without persisting (issue #996 backfill)', () => {
    const { controller, writes } = rig({ backgroundOpacity: 10 })
    expect(controller.opacity()).toBe(10)
    // The boot refetch delivers the authoritative v2 state.
    controller.init({ backgroundOpacity: 100, backgroundBlurEmpty: 4, backgroundBlurContent: 5 })
    expect(controller.opacity()).toBe(100)
    expect(controller.blurEmpty()).toBe(4)
    expect(controller.blurContent()).toBe(5)
    // Untouched fields fall back to defaults, matching the stored merge.
    expect(controller.inputCardBlur()).toBe(10)
    expect(controller.bubbleOpacity()).toBe(50)
    expect(document.body.style.getPropertyValue(SCRIM_VAR)).toBe('1')
    // init never writes back: the source already owns the stored copy.
    expect(writes).toHaveLength(0)
    controller.dispose()
  })

  it('init(null) resets to defaults', () => {
    const { controller } = rig({ backgroundOpacity: 80, backgroundBlurEmpty: 6 })
    controller.init(null)
    expect(controller.opacity()).toBe(0)
    expect(controller.blurEmpty()).toBe(0)
    expect(blurElement()).toBeNull()
    controller.dispose()
  })

  it('snapshot() carries every field so one POST replaces the section', () => {
    const { controller } = rig({ backgroundOpacity: 30, backgroundBlurEmpty: 2 })
    expect(controller.snapshot()).toEqual({
      enabled: true,
      backgroundOpacity: 30,
      backgroundBlurEmpty: 2,
      backgroundBlurContent: 0,
      inputCardBlur: 10,
      bubbleOpacity: 50,
    })
    controller.dispose()
  })
})
