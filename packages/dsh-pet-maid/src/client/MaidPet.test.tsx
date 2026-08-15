// @vitest-environment jsdom
/**
 * MaidPet tests: the rename-box keyboard handling (Enter/Escape must not
 * submit during IME composition — the same interaction dsh-pet protects),
 * plus the pure pose-resolution helpers (resolvePose / spriteTransform) that
 * drive click-to-jump, double-click-to-wave, sleep-and-wake and mini mode.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MaidPet, resolvePose, spriteTransform, SLEEP_AFTER_MS, type MaidPetProps } from './MaidPet.tsx'
import { t } from './locales.ts'
import type { PetStateView } from '../service.ts'

/** Snapshot fixture: idle whale maid named 泡泡. */
const snapshot: PetStateView = {
  animation: 'idle',
  phase: 'idle',
  sessionActive: true,
  activeSessions: 1,
  workingTier: 0,
  assetSource: 'bundled',
  affinity: {
    points: 0,
    rank: '幼鲸',
    rankEmoji: '*',
    pets: 0,
    feeds: 0,
    turns: 0,
    petCooldown: false,
    feedCooldown: false,
  },
  display: { visible: true, size: 160, right: 48, bottom: 20, eyeTracking: true, miniMode: true },
  name: '泡泡',
  treats: { stocked: 3, max: 5 },
}

beforeAll(() => {
  // Deterministic zh copy for button labels.
  document.documentElement.lang = 'zh'
  // Prefer-reduced-motion matches: the sprite loop then never schedules
  // requestAnimationFrame, keeping the test free of animation timers.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  cleanup()
})

/** Render the pet with mocked callbacks; returns the rename spy. */
function renderPet(): { onRename: ReturnType<typeof vi.fn> } {
  const onRename = vi.fn()
  const props: MaidPetProps = {
    snapshot,
    display: snapshot.display,
    feedback: null,
    onPet: vi.fn(),
    onFeed: vi.fn(),
    onHide: vi.fn(),
    onDragEnd: vi.fn(),
    onRename,
    onFeedbackDone: vi.fn(),
    t,
  }
  render(<MaidPet {...props} />)
  return { onRename }
}

/** Hover the sprite to open the panel, then click the rename button. */
function openRename(): HTMLInputElement {
  fireEvent.pointerOver(screen.getByRole('button', { name: 'whale maid' }))
  fireEvent.click(screen.getByText('改名'))
  return screen.getByPlaceholderText('输入新名字') as HTMLInputElement
}

/**
 * Fire a keydown whose native event reports an active IME composition, the
 * way Chromium marks Enter/Escape pressed to select or dismiss a candidate.
 */
function fireComposingKeydown(target: Element, key: string): void {
  fireEvent.compositionStart(target)
  const native = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    isComposing: true,
  })
  // jsdom does not implement KeyboardEvent.isComposing, so pin the flag on
  // the dispatched native event exactly as the browser would report it.
  Object.defineProperty(native, 'isComposing', { value: true })
  fireEvent(target, native)
  fireEvent.compositionEnd(target)
}

describe('MaidPet rename input', () => {
  it('submits the draft on Enter outside composition', () => {
    const { onRename } = renderPet()
    const input = openRename()
    fireEvent.change(input, { target: { value: ' 小鲸 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('小鲸')
    expect(screen.queryByPlaceholderText('输入新名字')).toBeNull()
  })

  it('ignores Enter while an IME composition is active', () => {
    const { onRename } = renderPet()
    const input = openRename()
    fireEvent.change(input, { target: { value: '泡泡酱' } })
    fireComposingKeydown(input, 'Enter')
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('输入新名字')).toBe(input)
    expect(input.value).toBe('泡泡酱')
    // Once the composition is over, Enter submits normally.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('泡泡酱')
    expect(screen.queryByPlaceholderText('输入新名字')).toBeNull()
  })

  it('ignores Escape while an IME composition is active', () => {
    const { onRename } = renderPet()
    const input = openRename()
    fireEvent.change(input, { target: { value: 'abc' } })
    fireComposingKeydown(input, 'Escape')
    expect(screen.getByPlaceholderText('输入新名字')).toBe(input)
    // A real Escape outside composition closes the box without renaming.
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('输入新名字')).toBeNull()
  })
})

describe('resolvePose', () => {
  it('lets a live reaction override the host animation', () => {
    const now = 1_000_000
    expect(resolvePose('idle', { reaction: { kind: 'jump', until: now + 500 }, asleep: false, lastActive: now, now }).animation).toBe('jumping')
    expect(resolvePose('idle', { reaction: { kind: 'wave', until: now + 500 }, asleep: false, lastActive: now, now }).animation).toBe('waving')
    // An expired reaction falls through to the base pose.
    expect(resolvePose('idle', { reaction: { kind: 'jump', until: now - 1 }, asleep: false, lastActive: now, now }).animation).toBe('idle')
  })

  it('falls asleep after idle and wakes on recent activity', () => {
    const now = 1_000_000
    const idleInput = { reaction: null, lastActive: now - SLEEP_AFTER_MS - 1, now }
    const asleep = resolvePose('idle', { ...idleInput, asleep: false })
    expect(asleep.animation).toBe('sleeping')
    expect(asleep.asleep).toBe(true)
    // Recent activity inside the wake grace ends the sleep.
    const awake = resolvePose('idle', { ...idleInput, asleep: true, lastActive: now - 100 })
    expect(awake.animation).toBe('idle')
    expect(awake.asleep).toBe(false)
    // Working phases never sleep.
    expect(resolvePose('running', { ...idleInput, asleep: false }).animation).toBe('running')
  })
})

describe('spriteTransform', () => {
  it('tucks the pet in mini mode and peeks on hover', () => {
    const tucked = spriteTransform('idle', { mini: true, hovered: false, eyeTracking: true, eye: { x: 1, y: 2 } })
    expect(tucked).toContain('translateX(70%)')
    const peeked = spriteTransform('idle', { mini: true, hovered: true, eyeTracking: true, eye: { x: 1, y: 2 } })
    expect(peeked).toBe('translateX(0%)')
  })

  it('applies the eye offset only in idle poses', () => {
    expect(spriteTransform('idle', { mini: false, hovered: false, eyeTracking: true, eye: { x: 3, y: -2 } }))
      .toBe('translate(3px, -2px)')
    expect(spriteTransform('running', { mini: false, hovered: false, eyeTracking: true, eye: { x: 3, y: -2 } }))
      .toBe('')
    expect(spriteTransform('idle', { mini: false, hovered: false, eyeTracking: false, eye: { x: 3, y: -2 } }))
      .toBe('')
  })
})
