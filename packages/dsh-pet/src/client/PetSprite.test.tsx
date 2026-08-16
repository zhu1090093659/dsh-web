// @vitest-environment jsdom
/**
 * PetSprite rename-box keyboard handling. The rename input must treat
 * Enter/Escape keydowns that arrive during IME composition (candidate
 * selection) as composition input, never as submit/cancel (issue #89).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PetSprite, type PetSpriteProps } from './PetSprite.tsx'
import { t } from './locales.ts'
import type { PetStateView } from '../service.ts'
import type { PetDefinition, PetTrackDef } from '../registry.ts'
import type { PetAnimation } from '../state.ts'

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
    cell: { width: 192, height: 208 },
    columns: 8,
    rows: [6, 8, 8, 4, 5, 8, 6, 6, 6],
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
})

/** Render the pet with mocked callbacks; returns the rename spy. */
function renderPet(overrides: Partial<PetSpriteProps> = {}): { onRename: ReturnType<typeof vi.fn> } {
  const onRename = vi.fn()
  const props: PetSpriteProps = {
    snapshot,
    definition: petDefinition(),
    display: snapshot.display,
    feedback: null,
    onPet: vi.fn(),
    onFeed: vi.fn(),
    onHide: vi.fn(),
    onDragEnd: vi.fn(),
    onRename,
    onFeedbackDone: vi.fn(),
    t,
    ...overrides,
  }
  render(<PetSprite {...props} />)
  return { onRename }
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

  it('renders one bubble per concurrent session without duplicating the global bubble', () => {
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
    // The display session appears in the stack exactly once: the legacy
    // single bubble is not rendered on top of the session list.
    expect(screen.getAllByText('正在思考')).toHaveLength(1)
    expect(screen.queryByText('正在使用 grep')).not.toBeNull()
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
})
