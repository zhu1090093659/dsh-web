// @vitest-environment jsdom
/**
 * PetSprite rename-box keyboard handling. The rename input must treat
 * Enter/Escape keydowns that arrive during IME composition (candidate
 * selection) as composition input, never as submit/cancel (issue #89).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PetSprite, type PetSpriteProps } from './PetSprite.tsx'
import { t } from './locales.ts'
import type { PetStateView } from '../service.ts'
import type { PetDefinition, PetTrackDef } from '../registry.ts'
import type { PetAnimation } from '../state.ts'
import type { DecorationView } from '../contracts/status-decoration.ts'

/** A minimal pet definition (geometry + tracks) as served by the host. */
function petDefinition(): PetDefinition {
  const track = (frames: number[], durations: number[], loop = true, fallback?: PetAnimation): PetTrackDef => ({
    frames,
    durations,
    loop,
    ...(fallback === undefined ? {} : { fallback }),
  })
  return {
    id: 'whale-girl',
    displayName: '鲸鱼娘',
    description: '测试用鲸鱼娘',
    renderer: 'sprite2d',
    cell: { width: 192, height: 208 },
    columns: 8,
    rows: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    atlasRows: 9,
    tracks: {
      idle: track([0, 1, 2, 3, 4, 5], [400, 400, 400, 400, 400, 400]),
      'running-right': track([0, 1, 2, 3, 4, 5, 6, 7], [225, 225, 225, 225, 225, 225, 225, 225]),
      'running-left': track([0, 1, 2, 3, 4, 5, 6, 7], [225, 225, 225, 225, 225, 225, 225, 225]),
      waving: track([0, 1, 2, 3], [350, 350, 350, 350]),
      jumping: track([0, 1, 2, 3, 4], [300, 300, 300, 300, 300], false, 'idle'),
      failed: track([0, 1, 2, 3, 4, 5, 6, 7], [450, 450, 450, 450, 450, 450, 450, 450], false, 'idle'),
      waiting: track([0, 1, 2, 3, 4, 5], [450, 450, 450, 450, 450, 450]),
      running: track([0, 1, 2, 3, 4, 5], [250, 250, 250, 250, 250, 250]),
      review: track([0, 1, 2, 3, 4, 5], [550, 550, 550, 550, 550, 550]),
    },
    atlasUrl: '/pet/whale-girl/spritesheet.webp',
    manifestUrl: '/pet/whale-girl/pet.json',
  }
}

/** Snapshot fixture: idle whale girl named 泡泡. */
const snapshot: PetStateView = {
  animation: 'idle',
  phase: 'idle',
  sessionActive: true,
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
  display: { visible: true, size: 160, right: 24, bottom: 20 },
  pet: { id: 'whale-girl', displayName: '鲸鱼娘', description: '测试用鲸鱼娘' },
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
  vi.restoreAllMocks()
})

/** Build the mocked props for one render. */
function petProps(overrides: Partial<PetSpriteProps> = {}): PetSpriteProps {
  return {
    snapshot,
    definition: petDefinition(),
    display: snapshot.display,
    feedback: null,
    onPet: vi.fn(),
    onFeed: vi.fn(),
    onHide: vi.fn(),
    onDragEnd: vi.fn(),
    onRename: vi.fn(),
    onOpenSession: vi.fn(),
    onFeedbackDone: vi.fn(),
    t,
    ...overrides,
  }
}

/** Render the pet with mocked callbacks; returns the rename/open spys + the RTL result. */
function renderPet(overrides: Partial<PetSpriteProps> = {}): {
  onRename: ReturnType<typeof vi.fn>
  onOpenSession: ReturnType<typeof vi.fn>
  result: ReturnType<typeof render>
} {
  const onRename = vi.fn()
  const onOpenSession = vi.fn()
  const result = render(<PetSprite {...petProps({ onRename, onOpenSession, ...overrides })} />)
  return { onRename, onOpenSession, result }
}

/** Hover the sprite to open the panel, then click the rename button. */
function openRename(): HTMLInputElement {
  fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
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

describe('PetSprite custom visual (pet-center M3)', () => {
  it('renders the visual inside the sprite box and skips the atlas background', () => {
    renderPet({ visual: <canvas data-testid="custom-visual" /> })
    const spriteEl = screen.getByRole('button', { name: '鲸鱼娘' })
    expect(spriteEl.querySelector('[data-testid="custom-visual"]')).toBeTruthy()
    // The atlas background never applies while a renderer visual owns the box.
    expect(spriteEl.style.backgroundImage).toBe('')
  })
})

describe('PetSprite hide control (#1126)', () => {
  it('does not render an intrusive corner close button and allows hiding via hover panel', () => {
    const onHide = vi.fn()
    const onPet = vi.fn()
    renderPet({ onHide, onPet })

    expect(screen.queryByTestId('pet-close')).toBeNull()

    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    const hideBtn = screen.getByText('隐藏')
    fireEvent.click(hideBtn)

    expect(onHide).toHaveBeenCalledTimes(1)
    expect(onPet).not.toHaveBeenCalled()
  })
})

describe('PetSprite affinity rank localization (#1226)', () => {
  it('localizes the rank name in the hover panel when document language is en', () => {
    document.documentElement.lang = 'en'
    try {
      renderPet({
        snapshot: {
          ...snapshot,
          affinity: { ...snapshot.affinity, rank: '幼鲸' },
        },
      })
      fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
      expect(screen.getByText('Affinity Baby Whale')).toBeTruthy()
    } finally {
      document.documentElement.lang = 'zh'
    }
  })
})

describe('PetSprite rename input', () => {
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

  it('ignores Enter between compositionStart and compositionEnd even when isComposing is false (#303)', () => {
    // WeChat IME (Windows) marks composition keydowns with isComposing ===
    // false; only the explicit composition events can be trusted.
    const { onRename } = renderPet()
    const input = openRename()
    fireEvent.change(input, { target: { value: '泡泡酱' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('输入新名字')).toBe(input)
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('泡泡酱')
  })

  it("ignores 'Process' keydowns emitted by IMEs mid-composition (#303)", () => {
    const { onRename } = renderPet()
    const input = openRename()
    fireEvent.change(input, { target: { value: '泡泡酱' } })
    fireEvent.keyDown(input, { key: 'Process' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('输入新名字')).toBe(input)
  })

  it('keeps the rename panel open when the pointer leaves mid-rename (#303)', () => {
    // An IME candidate window is an OS-level window: moving the pointer onto
    // it fires pointerleave on the float. The hide timer must not unmount
    // the input mid-composition (that crashes some IMEs / the renderer).
    vi.useFakeTimers()
    try {
      renderPet()
      const input = openRename()
      const float = input.parentElement?.parentElement?.parentElement
      expect(float).not.toBeNull()
      fireEvent.pointerOut(float!, { relatedTarget: null })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.getByPlaceholderText('输入新名字')).toBe(input)
      // After the rename ends, hover behavior works again.
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.pointerOut(float!, { relatedTarget: null })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.queryByText('改名')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PetSprite hover panel placement', () => {
  it('places the panel above when an old saved position leaves no room below', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.style.bottom !== '') {
        return { top: 720, right: 1256, bottom: 880, left: 1108, width: 148, height: 160, x: 1108, y: 720, toJSON: () => ({}) }
      }
      return { top: 888, right: 1259, bottom: 974, left: 1105, width: 154, height: 86, x: 1105, y: 888, toJSON: () => ({}) }
    })

    renderPet({ display: { ...snapshot.display, bottom: 20 } })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))

    const panel = screen.getByText('改名').closest('[data-placement]') as HTMLElement
    expect(panel.getAttribute('data-placement')).toBe('above')
    // No bubble above the sprite: the panel keeps its default 8px gap.
    expect(panel.style.marginBottom).toBe('')
  })

  it('lifts the above-panel clear of the status bubble instead of overlapping it', () => {
    // Regression: the fallback above-placement anchored the panel at the
    // sprite's top edge — the exact region the status bubble occupies — so
    // the panel covered the bubble. The panel must now ride above it.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.className.includes('bubbleStack')) {
        // The bubble area (stack wrapping the status bubble): 40px tall.
        return { top: 650, right: 1200, bottom: 690, left: 1120, width: 80, height: 40, x: 1120, y: 650, toJSON: () => ({}) }
      }
      // Sprite (bottom 974 of a 900px viewport) and panel (86px tall).
      return { top: 888, right: 1259, bottom: 974, left: 1105, width: 154, height: 86, x: 1105, y: 888, toJSON: () => ({}) }
    })

    renderPet({
      snapshot: { ...snapshot, bubble: '正在思考' },
      display: { ...snapshot.display, bottom: 20 },
    })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))

    const panel = screen.getByText('改名').closest('[data-placement]') as HTMLElement
    expect(panel.getAttribute('data-placement')).toBe('above')
    // 40px bubble height + 14px (8px base gap + 6px clearance).
    expect(panel.style.marginBottom).toBe('54px')
    // The bubble stays rendered while the lifted panel is open.
    expect(screen.queryByText('正在思考')).not.toBeNull()
  })

  it('lifts the above-panel clear of the session bubble stack', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.className.includes('bubbleStack')) {
        // Two stacked bubbles: 88px tall.
        return { top: 600, right: 1200, bottom: 688, left: 1100, width: 100, height: 88, x: 1100, y: 600, toJSON: () => ({}) }
      }
      return { top: 888, right: 1259, bottom: 974, left: 1105, width: 154, height: 86, x: 1105, y: 888, toJSON: () => ({}) }
    })

    renderPet({
      snapshot: {
        ...snapshot,
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
      display: { ...snapshot.display, bottom: 20 },
    })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))

    const panel = screen.getByText('改名').closest('[data-placement]') as HTMLElement
    expect(panel.getAttribute('data-placement')).toBe('above')
    // 88px stack height + 14px clearance.
    expect(panel.style.marginBottom).toBe('102px')
  })
})

describe('PetSprite status bubble', () => {
  const workingSnapshot: PetStateView = {
    ...snapshot,
    animation: 'running',
    phase: 'thinking',
    bubble: '正在思考',
  }

  it('renders host activity when no interaction feedback is active', () => {
    renderPet({ snapshot: workingSnapshot })
    expect(screen.queryByText('正在思考')).not.toBeNull()
  })

  it('lets transient interaction feedback replace host activity', () => {
    renderPet({
      snapshot: workingSnapshot,
      feedback: { text: '摸摸成功', kind: 'pet', at: 1 },
    })
    expect(screen.queryByText('摸摸成功')).not.toBeNull()
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  /** Expand a collapsed session stack by hovering its bubble area. */
  function expandStack(): void {
    const stack = screen.getByText('正在思考').closest('div')
    expect(stack).not.toBeNull()
    fireEvent.pointerOver(stack!)
  }

  it('collapses concurrent sessions behind the display session bubble', () => {
    renderPet({
      snapshot: {
        ...workingSnapshot,
        bubble: '正在思考',
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
    })
    // Only the display session speaks; the other session hides behind the
    // '+1' badge so the pet never wears a tall bubble stack.
    expect(screen.getAllByText('正在思考')).toHaveLength(1)
    expect(screen.queryByText('正在使用 grep')).toBeNull()
    expect(screen.queryByRole('button', { name: '展开其余 1 个会话的气泡' })).not.toBeNull()
  })

  it('expands the collapsed stack on hover and on badge tap', () => {
    renderPet({
      snapshot: {
        ...workingSnapshot,
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
    })
    // Hover peek: extras appear, and leaving collapses them again.
    expandStack()
    expect(screen.queryByText('正在使用 grep')).not.toBeNull()
    fireEvent.pointerOut(screen.getByText('正在思考').closest('div')!)
    expect(screen.queryByText('正在使用 grep')).toBeNull()
    // Badge tap pins the stack open (touch path); tapping again collapses.
    fireEvent.click(screen.getByRole('button', { name: '展开其余 1 个会话的气泡' }))
    expect(screen.queryByText('正在使用 grep')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '收起会话气泡' }))
    expect(screen.queryByText('正在使用 grep')).toBeNull()
  })

  it('renders one bubble per concurrent session in the expanded stack', () => {
    renderPet({
      snapshot: {
        ...workingSnapshot,
        bubble: '正在思考',
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
    })
    expandStack()
    // The display session appears in the stack exactly once: the legacy
    // single bubble is not rendered on top of the session list.
    expect(screen.getAllByText('正在思考')).toHaveLength(1)
    expect(screen.queryByText('正在使用 grep')).not.toBeNull()
  })

  it('lets a session whisper take over its own bubble while others stay collapsed', () => {
    const { onOpenSession } = renderPet({
      snapshot: {
        ...workingSnapshot,
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考', whisper: '我在这儿陪着你呢，别急别急' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
    })
    // The lead session's bubble speaks ITS whisper instead of its status
    // copy; the collapsed extra session hides behind the badge.
    expect(screen.queryByText('我在这儿陪着你呢，别急别急')).not.toBeNull()
    expect(screen.queryByText('正在思考')).toBeNull()
    expect(screen.queryByText('正在使用 grep')).toBeNull()
    // Expanding reveals the other session's own bubble, untouched.
    fireEvent.pointerOver(screen.getByText('我在这儿陪着你呢，别急别急').closest('div')!)
    expect(screen.queryByText('正在使用 grep')).not.toBeNull()
    // The whisper-toned bubble stays clickable and still opens its session.
    fireEvent.click(screen.getByText('我在这儿陪着你呢，别急别急'))
    expect(onOpenSession).toHaveBeenCalledWith('s-a')
  })

  it('renders each session whisper on its own expanded bubble', () => {
    renderPet({
      snapshot: {
        ...workingSnapshot,
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考', whisper: 'A 的碎碎念' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep', whisper: 'B 的碎碎念' },
        ],
      },
    })
    fireEvent.pointerOver(screen.getByText('A 的碎碎念').closest('div')!)
    expect(screen.queryByText('A 的碎碎念')).not.toBeNull()
    expect(screen.queryByText('B 的碎碎念')).not.toBeNull()
    expect(screen.queryByText('正在思考')).toBeNull()
  })

  it('lets transient interaction feedback take over the whisper too', () => {
    renderPet({
      snapshot: {
        ...workingSnapshot,
        sessions: [{ sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考', whisper: '哼哧哼哧，大脑转得飞快～' }],
      },
      feedback: { text: '摸摸成功', kind: 'pet', at: 1 },
    })
    expect(screen.queryByText('摸摸成功')).not.toBeNull()
    expect(screen.queryByText('哼哧哼哧，大脑转得飞快～')).toBeNull()
  })

  it('lets feedback replace the whole session bubble stack', () => {
    renderPet({
      snapshot: {
        ...workingSnapshot,
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
      feedback: { text: '摸摸成功', kind: 'pet', at: 1 },
    })
    expect(screen.queryByText('摸摸成功')).not.toBeNull()
    expect(screen.queryByText('正在思考')).toBeNull()
    expect(screen.queryByText('正在使用 grep')).toBeNull()
  })

  it('clicking a session bubble navigates to that session', () => {
    const { onOpenSession } = renderPet({
      snapshot: {
        ...workingSnapshot,
        bubble: '正在思考',
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
    })
    // The collapsed stack must be expanded before its extras can be hit.
    fireEvent.pointerOver(screen.getByText('正在思考').closest('div')!)
    fireEvent.click(screen.getByText('正在使用 grep'))
    expect(onOpenSession).toHaveBeenCalledTimes(1)
    expect(onOpenSession).toHaveBeenCalledWith('s-b')
    fireEvent.click(screen.getByText('正在思考'))
    expect(onOpenSession).toHaveBeenCalledTimes(2)
    expect(onOpenSession).toHaveBeenCalledWith('s-a')
    // Petting stays on the sprite only: bubble clicks must not pet.
  })

  it('clicking the legacy single bubble does not navigate (no session identity)', () => {
    const { onOpenSession } = renderPet({ snapshot: workingSnapshot })
    fireEvent.click(screen.getByText('正在思考'))
    expect(onOpenSession).not.toHaveBeenCalled()
  })

  it('keeps session bubbles visible and clickable while the hover panel is open', () => {
    // Regression: the panel used to occupy the same region as the bubble
    // stack and hide it on hover, so reaching a bubble was impossible. The
    // panel now opens beside the sprite and the stack stays interactive.
    const { onOpenSession } = renderPet({
      snapshot: {
        ...workingSnapshot,
        sessions: [
          { sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考' },
          { sessionId: 's-b', animation: 'running-right', phase: 'tool', bubble: '正在使用 grep' },
        ],
      },
    })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    // The hover panel is open...
    expect(screen.queryByText('改名')).not.toBeNull()
    // ...and the bubbles are still there, still clickable once the collapsed
    // stack is expanded by hovering it.
    fireEvent.pointerOver(screen.getByText('正在思考').closest('div')!)
    expect(screen.getByText('正在使用 grep')).not.toBeNull()
    fireEvent.click(screen.getByText('正在使用 grep'))
    expect(onOpenSession).toHaveBeenCalledWith('s-b')
  })
})

describe('PetSprite definition-driven render', () => {
  it('labels the sprite with the pet display name', () => {
    renderPet()
    expect(screen.queryByRole('button', { name: '鲸鱼娘' })).not.toBeNull()
  })

  it('shows the renamed snapshot name in the hover panel', () => {
    renderPet()
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.queryByText('泡泡')).not.toBeNull()
  })

  it('advances a configured scene sequence after the current track duration', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let nextFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      nextFrame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const definition = petDefinition()
    definition.sequences = {
      thinking: ['running', 'waiting', 'running', 'waiting', 'running'],
    }
    renderPet({
      definition,
      snapshot: { ...snapshot, animation: 'running', phase: 'thinking' },
    })
    const sprite = screen.getByRole('button', { name: '鲸鱼娘' })
    expect(sprite.style.backgroundPosition).toBe('0px -1120px')
    act(() => { nextFrame?.(1_500) })
    expect(sprite.style.backgroundPosition).toBe('0px -960px')
  })

  it('skips redundant backgroundPosition style assignments when frame coordinates do not change (issue #1013)', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let nextFrame: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      nextFrame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    renderPet({
      snapshot: { ...snapshot, animation: 'idle', phase: 'idle' },
    })
    const sprite = screen.getByRole('button', { name: '鲸鱼娘' })
    const styleSetterSpy = vi.spyOn(sprite.style, 'backgroundPosition', 'set')
    // Idle frame 0 duration is 400ms. An intermediate tick at 16ms does not advance the frame.
    act(() => { nextFrame?.(16) })
    expect(styleSetterSpy).not.toHaveBeenCalled()
    // A tick past 400ms advances to frame 1 and should set backgroundPosition once.
    act(() => { nextFrame?.(410) })
    expect(styleSetterSpy).toHaveBeenCalledTimes(1)
  })
})

describe('PetSprite panel chrome from the voice pack (pet-center M4)', () => {
  const voicedDefinition = (): PetDefinition => ({
    ...petDefinition(),
    panel: {
      labels: { feed: '投喂', rename: '起名字', hide: '藏起来', confirm: '好的' },
      stats: { rank: '好感 {rank}', treats: '鱼干 {n}', points: '{points} 分' },
    },
  })

  it('renders pack labels and stat formats, falling back per slot', () => {
    renderPet({ definition: voicedDefinition() })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.getByText('投喂')).toBeDefined()
    expect(screen.getByText('起名字')).toBeDefined()
    expect(screen.getByText('藏起来')).toBeDefined()
    expect(screen.getByText('好感 幼鲸')).toBeDefined()
    expect(screen.getByText('鱼干 3')).toBeDefined()
    expect(screen.getByText('0 分')).toBeDefined()
  })

  it('uses the pack confirm label inside the rename row', () => {
    renderPet({ definition: voicedDefinition() })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    fireEvent.click(screen.getByText('起名字'))
    expect(screen.getByText('好的')).toBeDefined()
  })

  it('hides actions the pack omits', () => {
    renderPet({
      definition: {
        ...petDefinition(),
        panel: { labels: { feed: '投喂' }, actions: ['feed'] },
      },
    })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.getByText('投喂')).toBeDefined()
    expect(screen.queryByText('改名')).toBeNull()
    expect(screen.queryByText('隐藏')).toBeNull()
  })

  it('renders no action buttons when the pack hides them all', () => {
    renderPet({ definition: { ...petDefinition(), panel: { actions: [] } } })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.queryByText('喂食')).toBeNull()
    expect(screen.queryByText('改名')).toBeNull()
    expect(screen.queryByText('隐藏')).toBeNull()
    // The stat rows keep rendering.
    expect(screen.getByText('亲密度 幼鲸')).toBeDefined()
    expect(screen.getByText('小鱼干 ×3')).toBeDefined()
  })

  it('keeps the i18n copy when the pet carries no panel', () => {
    renderPet()
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.getByText('喂食')).toBeDefined()
    expect(screen.getByText('改名')).toBeDefined()
    expect(screen.getByText('隐藏')).toBeDefined()
    expect(screen.getByText('亲密度 幼鲸')).toBeDefined()
  })

  it('substitutes cross-slot placeholders in pack stat formats', () => {
    renderPet({ definition: { ...petDefinition(), panel: { stats: { treats: '鱼干 {n}（{points} 分，{rank}）' } } } })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    // The host whitelists {rank}/{n}/{points} in every stat slot, so a pack
    // format may reference any of them; all three live values substitute.
    expect(screen.getByText('鱼干 3（0 分，幼鲸）')).toBeDefined()
  })
})
describe('PetSprite gameplay entry in the hover panel (miku generalization)', () => {
  it('renders a 玩法 action and routes clicks to the HUD channel', () => {
    const onGameplayMenu = vi.fn()
    renderPet({ onGameplayMenu })
    // The entry lives in the hover panel; a closed panel shows no chrome.
    expect(screen.queryByText('玩法')).toBeNull()
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.getByText('玩法')).toBeDefined()
    fireEvent.click(screen.getByText('玩法'))
    expect(onGameplayMenu).toHaveBeenCalledTimes(1)
  })

  it('omits the 玩法 action when the pet carries no gameplay HUD', () => {
    renderPet()
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.queryByText('玩法')).toBeNull()
  })

  it('keeps the 玩法 entry when a voice pack hides every panel action', () => {
    renderPet({
      definition: { ...petDefinition(), panel: { actions: [] } },
      onGameplayMenu: vi.fn(),
    })
    fireEvent.pointerOver(screen.getByRole('button', { name: '鲸鱼娘' }))
    expect(screen.getByText('玩法')).toBeDefined()
    expect(screen.queryByText('喂食')).toBeNull()
  })
})

describe('PetSprite status decoration (pet-center M5, #567)', () => {
  const decoration: DecorationView = {
    apiVersion: 'x-org.linxin666.pet-center/status-decoration-v1',
    id: 'whale',
    assetBase: '/api/pet/decoration/whale',
    entryUrl: '/api/pet/decoration/whale/whale-frames.png',
    cell: { width: 64, height: 48 },
    columns: 4,
    durations: [160, 160, 160, 160],
    loop: true,
    phases: {
      idle: 'hide',
      waiting: { from: 0, to: 1 },
      thinking: { from: 0, to: 3 },
      done: { from: 2, to: 3 },
    },
  }

  const ornament = (): HTMLElement | null => document.body.querySelector('[data-dsh-pet-decoration="whale"]')

  it('renders an aria-hidden ornament inside the status bubble for a bound phase', () => {
    renderPet({ snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking', decoration } })
    const el = ornament()
    expect(el).not.toBeNull()
    expect(el!.getAttribute('aria-hidden')).toBe('true')
    expect(el!.style.backgroundImage).toContain('whale-frames.png')
    // The bubble keeps its semantics beside the ornament.
    const bubble = document.body.querySelector('[role="status"][aria-live="polite"]')
    expect(bubble).not.toBeNull()
    expect(bubble!.textContent).toContain('正在思考')
  })

  it('hides the ornament for phases bound to hide and for the idle default', () => {
    renderPet({ snapshot: { ...snapshot, bubble: '等待', phase: 'idle', decoration } })
    expect(ornament()).toBeNull()
  })

  it('holds the segment first frame under prefers-reduced-motion', () => {
    renderPet({ snapshot: { ...snapshot, bubble: '完成', phase: 'done', decoration } })
    const el = ornament()
    expect(el).not.toBeNull()
    // The harness matchMedia mock reports reduced motion, so the ornament
    // rests on the segment's first frame (column 2 of a 24px-wide frame).
    expect(el!.style.backgroundPosition).toBe('-48px 0px')
  })

  it('yields the bubble to the whisper (voice moment hides the ornament)', () => {
    renderPet({
      snapshot: {
        ...snapshot,
        phase: 'thinking',
        decoration,
        sessions: [{ sessionId: 's-a', animation: 'running', phase: 'thinking', bubble: '正在思考', whisper: '冲了冲了' }],
      },
    })
    expect(ornament()).toBeNull()
    expect(document.body.textContent).toContain('冲了冲了')
  })

  it('renders no ornament when the host serves no decoration', () => {
    renderPet({ snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking' } })
    expect(ornament()).toBeNull()
  })

  it('advances the ornament frames on the duration timer and wraps when looping', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    // The ornament schedules by frame duration (setTimeout), the sprite
    // still uses rAF; capture both so stepping advances both loops.
    const timers: { at: number; callback: () => void }[] = []
    let timerId = 0
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, delay = 0) => {
      timers.push({ at: now + delay, callback })
      return ++timerId
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    renderPet({ snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking', decoration } })
    const el = ornament()!
    // Run the sprite rAF callbacks immediately (its idle track never moves);
    // run ornament timers as the clock reaches them, repeatedly, because a
    // due timer reschedules the next one at now + duration.
    const step = (ms: number): void => {
      for (const callback of frames.splice(0)) callback(now)
      now += ms
      for (;;) {
        const due = timers.filter(t => t.at <= now)
        if (due.length === 0) break
        for (const t of due) {
          const idx = timers.indexOf(t)
          if (idx >= 0) timers.splice(idx, 1)
          t.callback()
        }
      }
    }
    // frameWidth = round(64 * 18 / 48) = 24 px; thinking binds frames 0..3.
    expect(el.style.backgroundPosition).toBe('0px 0px')
    act(() => { step(161) })
    expect(el.style.backgroundPosition).toBe('-24px 0px')
    act(() => { step(161) })
    expect(el.style.backgroundPosition).toBe('-48px 0px')
    act(() => { step(161) })
    expect(el.style.backgroundPosition).toBe('-72px 0px')
    act(() => { step(161) })
    // The looping segment wraps back to its first frame.
    expect(el.style.backgroundPosition).toBe('0px 0px')
  })

  it('holds the segment last frame when the loop is off and stops scheduling', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const timers: { at: number; callback: () => void }[] = []
    let timerId = 0
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, delay = 0) => {
      timers.push({ at: now + delay, callback })
      return ++timerId
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    renderPet({ snapshot: { ...snapshot, bubble: '完成', phase: 'done', decoration: { ...decoration, loop: false } } })
    const el = ornament()!
    const step = (ms: number): void => {
      for (const callback of frames.splice(0)) callback(now)
      now += ms
      for (;;) {
        const due = timers.filter(t => t.at <= now)
        if (due.length === 0) break
        for (const t of due) {
          const idx = timers.indexOf(t)
          if (idx >= 0) timers.splice(idx, 1)
          t.callback()
        }
      }
    }
    // done binds frames 2..3; the segment starts on frame 2.
    expect(el.style.backgroundPosition).toBe('-48px 0px')
    act(() => { step(161) })
    expect(el.style.backgroundPosition).toBe('-72px 0px')
    // The ornament stopped scheduling timers (only the sprite rAF remains).
    expect(timers).toHaveLength(0)
    act(() => { step(161) })
    // The last frame holds.
    expect(el.style.backgroundPosition).toBe('-72px 0px')
  })

  it('does not schedule a frame loop for a single-frame segment even when looping', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const timers: { at: number; callback: () => void }[] = []
    let timerId = 0
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, delay = 0) => {
      timers.push({ at: delay, callback })
      return ++timerId
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    // failed binds the single frame 3 of a 24px-wide frame; loop stays true.
    renderPet({
      snapshot: {
        ...snapshot,
        bubble: '失败',
        phase: 'failed',
        decoration: { ...decoration, phases: { ...decoration.phases, failed: { from: 3, to: 3 } } },
      },
    })
    const el = ornament()!
    // The ornament settles on its only frame, exactly like the reduced-motion
    // hold — no timer may start (only the sprite's idle rAF is pending).
    expect(el.style.backgroundPosition).toBe('-72px 0px')
    expect(timers).toHaveLength(0)
    const step = (ts: number): void => { for (const callback of frames.splice(0)) callback(ts) }
    act(() => { step(161) })
    act(() => { step(322) })
    // The frame never moves and the ornament never reschedules itself.
    expect(el.style.backgroundPosition).toBe('-72px 0px')
    expect(timers).toHaveLength(0)
  })

  it('does not advance the background while a frame is still in play', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const timers: { at: number; callback: () => void }[] = []
    let timerId = 0
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, delay = 0) => {
      timers.push({ at: now + delay, callback })
      return ++timerId
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    renderPet({ snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking', decoration } })
    const el = ornament()!
    const step = (ms: number): void => {
      for (const callback of frames.splice(0)) callback(now)
      now += ms
      for (;;) {
        const due = timers.filter(t => t.at <= now)
        if (due.length === 0) break
        for (const t of due) {
          const idx = timers.indexOf(t)
          if (idx >= 0) timers.splice(idx, 1)
          t.callback()
        }
      }
    }
    // thinking binds frames 0..3 at 160 ms/frame. The effect holds frame 0;
    // a step at 80 ms — inside the first frame — must not move the ornament,
    // and only crossing the 160 ms boundary advances to the next frame.
    expect(el.style.backgroundPosition).toBe('0px 0px')
    act(() => { step(80) })
    expect(el.style.backgroundPosition).toBe('0px 0px')
    act(() => { step(161) })
    expect(el.style.backgroundPosition).toBe('-24px 0px')
  })

  it('catches up every due frame after a long idle gap', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const timers: { at: number; callback: () => void }[] = []
    let timerId = 0
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, delay = 0) => {
      timers.push({ at: now + delay, callback })
      return ++timerId
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    renderPet({ snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking', decoration } })
    const el = ornament()!
    const step = (ms: number): void => {
      for (const callback of frames.splice(0)) callback(now)
      now += ms
      for (;;) {
        const due = timers.filter(t => t.at <= now)
        if (due.length === 0) break
        for (const t of due) {
          const idx = timers.indexOf(t)
          if (idx >= 0) timers.splice(idx, 1)
          t.callback()
        }
      }
    }
    // A 500 ms gap (jank / background tab) spans three 160 ms frames; the
    // ornament must advance through all of them (0 -> 1 -> 2 -> 3), not
    // drop the surplus time.
    expect(el.style.backgroundPosition).toBe('0px 0px')
    act(() => { step(500) })
    expect(el.style.backgroundPosition).toBe('-72px 0px')
    act(() => { step(161) })
    // The next frame tick wraps the looping segment back to its first frame.
    expect(el.style.backgroundPosition).toBe('0px 0px')
  })

  it('does not restart the frame loop when an equal-content decoration re-renders', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const timers: { at: number; callback: () => void }[] = []
    let timerId = 0
    const timerSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((callback: () => void, delay = 0) => {
      timers.push({ at: now + delay, callback })
      return ++timerId
    }) as typeof window.setTimeout)
    const clearSpy = vi.spyOn(window, 'clearTimeout').mockImplementation(() => {})
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    // The definition comes from '/api/pet/pets', fetched once — a state
    // poll never replaces it, so both renders share one definition object.
    const definition = petDefinition()
    const { result } = renderPet({ definition, snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking', decoration } })
    const step = (ms: number): void => {
      for (const callback of frames.splice(0)) callback(now)
      now += ms
      for (;;) {
        const due = timers.filter(t => t.at <= now)
        if (due.length === 0) break
        for (const t of due) {
          const idx = timers.indexOf(t)
          if (idx >= 0) timers.splice(idx, 1)
          t.callback()
        }
      }
    }
    act(() => { step(161) })
    expect(ornament()!.style.backgroundPosition).toBe('-24px 0px')
    const schedulesBefore = timerSpy.mock.calls.length
    // The 2 s poll delivers a fresh JSON round-trip: identical content, new
    // object identities everywhere. The loop must not cancel/restart.
    const repolled: DecorationView = {
      ...decoration,
      cell: { ...decoration.cell },
      durations: [...decoration.durations],
      phases: { ...decoration.phases },
    }
    result.rerender(<PetSprite {...petProps({ definition, snapshot: { ...snapshot, bubble: '正在思考', phase: 'thinking', decoration: repolled } })} />)
    act(() => { step(161) })
    expect(ornament()!.style.backgroundPosition).toBe('-48px 0px')
    expect(clearSpy).not.toHaveBeenCalled()
    // One reschedule per frame tick; no effect restart added new timers.
    expect(timerSpy.mock.calls.length).toBe(schedulesBefore + 1)
  })
})


describe('PetSprite portal target', () => {
  it('portals the float into the provided target instead of document.body', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    renderPet({ portalTarget: host })
    // The float (sprite chrome) lands inside the owning root, so a
    // root-keyed suppressor (the portrait mobile layer) hides it as one unit.
    expect(host.querySelector('[role="button"]')).not.toBeNull()
  })

  it('portals the float into document.body when no target is given', () => {
    renderPet()
    expect(document.body.querySelector('[role="button"]')).not.toBeNull()
  })
})

