// @vitest-environment jsdom
/**
 * The lever view: the arm, the accessible switch semantics, the gesture verbs,
 * and the jackpot burst. The component is pure, so these tests drive it with a
 * fake face and assert the DOM and the calls it makes.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { LiangShenLever } from '../src/client/LiangShenLever.tsx'
import type { LeverFace, LeverSnapshot } from '../src/client/lever-controller.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

function fakeFace(initial: Partial<LeverSnapshot> = {}) {
  const store = createSnapshotStore<LeverSnapshot>({
    state: 'off',
    restoreLabel: 'Standard',
    busy: false,
    burst: 0,
    ...initial,
  })
  const calls: string[] = []
  const face: LeverFace = {
    store,
    pull: () => { calls.push('pull') },
    push: () => { calls.push('push') },
    t: ((key: string, vars?: Record<string, string | number>) =>
      (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`)) as LeverFace['t'],
  }
  return { face, calls, store }
}

function mount(face: LeverFace): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<LiangShenLever {...face} />) })
  return container
}

function button(container: HTMLElement): HTMLButtonElement {
  const element = container.querySelector('button')
  expect(element).not.toBeNull()
  return element as HTMLButtonElement
}

function gesture(element: HTMLElement, from: number, to: number): void {
  act(() => { element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: from })) })
  act(() => { element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: to })) })
  act(() => { element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: to })) })
}

describe('LiangShenLever', () => {
  it('renders the lever with its semantic attributes', () => {
    const { face } = fakeFace()
    const container = mount(face)
    const root = container.querySelector('[data-dsh-plugin="liangshen"]')
    expect(root?.getAttribute('data-dsh-part')).toBe('lever')
    expect(root?.getAttribute('data-state')).toBe('off')
    expect(container.querySelector('[data-dsh-part="lever-arm"]')).not.toBeNull()
  })

  it('is an accessible switch that reports the current mode', () => {
    const { face } = fakeFace({ state: 'on' })
    const control = button(mount(face))
    expect(control.getAttribute('role')).toBe('switch')
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(control.getAttribute('aria-label')).toBe('lever.a11y')
    expect(control.title).toBe('lever.hint.push:{"preset":"Standard"}')
  })

  it('pulls on a downward drag and pushes on an upward one', () => {
    const off = fakeFace()
    const offButton = button(mount(off.face))
    gesture(offButton, 100, 140)
    expect(off.calls).toEqual(['pull'])

    const on = fakeFace({ state: 'on' })
    const onButton = button(mount(on.face))
    gesture(onButton, 140, 100)
    expect(on.calls).toEqual(['push'])

    const onPull = fakeFace({ state: 'on' })
    const onPullButton = button(mount(onPull.face))
    gesture(onPullButton, 100, 140)
    expect(onPull.calls).toEqual(['push'])

    const offH = fakeFace()
    const offHButton = button(mount(offH.face))
    act(() => { offHButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 })) })
    act(() => { offHButton.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 100 })) })
    act(() => { offHButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 140, clientY: 100 })) })
    expect(offH.calls).toEqual(['pull'])

    const onH = fakeFace({ state: 'on' })
    const onHButton = button(mount(onH.face))
    act(() => { onHButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 140, clientY: 100 })) })
    act(() => { onHButton.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 100 })) })
    act(() => { onHButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 })) })
    expect(onH.calls).toEqual(['push'])
  })

  it('toggles on a keyboard activation, which arrives as a detail-less click', () => {
    const { face, calls } = fakeFace()
    const control = button(mount(face))
    act(() => { control.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })) })
    expect(calls).toEqual(['pull'])
  })

  it('does not toggle when a drag already fired its verb', () => {
    const { face, calls } = fakeFace()
    gesture(button(mount(face)), 100, 140)
    expect(calls).toEqual(['pull'])
  })

  it('ignores gestures a short drag produces no verb for, until the click fires', () => {
    const { face, calls } = fakeFace()
    gesture(button(mount(face)), 100, 104)
    expect(calls).toEqual(['pull'])
  })

  it('renders nothing once the session has started or the preset is missing', () => {
    const locked = fakeFace({ state: 'locked' })
    const lockedContainer = mount(locked.face)
    expect(lockedContainer.querySelector('[data-dsh-plugin="liangshen"]')).toBeNull()
    expect(lockedContainer.querySelector('button')).toBeNull()
    expect(locked.calls).toEqual([])

    const missing = fakeFace({ state: 'missing' })
    expect(mount(missing.face).querySelector('[data-dsh-plugin="liangshen"]')).toBeNull()

    const unswitchableOn = fakeFace({ state: 'on', restoreLabel: '' })
    expect(mount(unswitchableOn.face).querySelector('[data-dsh-plugin="liangshen"]')).toBeNull()
  })

  it('leaves the composer row when the session leaves the blank window and returns on a blank one', () => {
    const { face, store } = fakeFace()
    const container = mount(face)
    expect(container.querySelector('[data-dsh-plugin="liangshen"]')).not.toBeNull()
    act(() => { store.set({ ...store.getSnapshot(), state: 'locked' }) })
    expect(container.querySelector('[data-dsh-plugin="liangshen"]')).toBeNull()
    act(() => { store.set({ ...store.getSnapshot(), state: 'off' }) })
    expect(container.querySelector('[data-dsh-plugin="liangshen"]')).not.toBeNull()
  })

  it('reports a refused switch in the composer row', () => {
    const { face } = fakeFace({ error: { kind: 'failed', reason: 'boom' } })
    const container = mount(face)
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('lever.failed.failed:{"reason":"boom"}')
  })

  it('reports a timed-out switch in the composer row', () => {
    const { face } = fakeFace({ error: { kind: 'timeout' } })
    expect(mount(face).querySelector('[role="status"]')?.textContent).toBe('lever.failed.timeout')
  })

  it('plays the jackpot burst when the controller reports a landed pull', () => {
    const { face, store } = fakeFace()
    const container = mount(face)
    expect(container.querySelector('[data-dsh-part="lever-burst"]')).toBeNull()
    act(() => { store.set({ ...store.getSnapshot(), state: 'on', burst: 1 }) })
    const burst = container.querySelector('[data-dsh-part="lever-burst"]')
    expect(burst).not.toBeNull()
    expect(burst?.querySelector('[data-dsh-part="lever-banner"]')).not.toBeNull()
    expect(burst?.textContent).toContain('burst.line1')
  })

  it('never replays the burst for an unchanged counter', () => {
    const { face, store } = fakeFace()
    const container = mount(face)
    act(() => { store.set({ ...store.getSnapshot(), burst: 1 }) })
    expect(container.querySelector('[data-dsh-part="lever-burst"]')).not.toBeNull()
    act(() => { store.set({ ...store.getSnapshot(), busy: true }) })
    expect(container.querySelectorAll('[data-dsh-part="lever-burst"]')).toHaveLength(1)
  })

  it('user observes hero preset chip preserved on initial mount and synced on toggle', () => {
    // Given an existing hero preset chip rendered in the DOM
    const heroBtn = document.createElement('button')
    heroBtn.setAttribute('aria-haspopup', 'menu')
    const seatLabel = document.createElement('span')
    seatLabel.className = 'seatLabel_mock'
    seatLabel.textContent = 'Command Code'
    heroBtn.appendChild(seatLabel)
    document.body.appendChild(heroBtn)

    const { face, store } = fakeFace({ state: 'off', restoreLabel: 'Standard' })

    // When the lever mounts in initial off state
    mount(face)

    // Then it does not overwrite the existing hero chip
    expect(seatLabel.textContent).toBe('Command Code')

    // When toggled to on
    act(() => { store.set({ ...store.getSnapshot(), state: 'on' }) })

    // Then the hero chip reflects LiangShen mode
    expect(seatLabel.textContent).toBe('lever.name')

    // When toggled back to off
    act(() => { store.set({ ...store.getSnapshot(), state: 'off', restoreLabel: 'Command Code' }) })

    // Then the hero chip reflects the restored preset
    expect(seatLabel.textContent).toBe('Command Code')
  })
})
