// @vitest-environment jsdom
/**
 * ChatView streaming markdown throttle: a pending assistant message must not
 * re-parse its whole accumulated text on every chunk. Streaming text
 * re-parses at most once per STREAM_RENDER_INTERVAL_MS, shows the last
 * parsed result in between, and renders the exact final HTML (byte-identical
 * to the plain renderMarkdown output) the moment the turn closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ChatView, STREAM_RENDER_INTERVAL_MS, LONG_TEXT_LIMIT } from './ChatView.tsx'
import { type SessionView } from './App.tsx'
import { renderMarkdown } from '../markdown.ts'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { HistoryPage } from '../api.ts'
import type { WireEvent } from '../messages.ts'

// The api module is fully mocked; App.tsx's history wrapper is overridden to
// feed a fixed empty history page, its pure helpers stay real.
vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  cancelSession: vi.fn(),
  fetchPending: vi.fn(),
}))
vi.mock('./App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./App.tsx')>()
  return {
    ...actual,
    loadHistory: vi.fn(),
    prompt: vi.fn(async () => {}),
  }
})
// Wrap the real renderer with a call counter: the throttle must cut the
// number of full-text parses during a chunk stream (each parse is O(n)).
vi.mock('../markdown.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../markdown.ts')>()
  return { ...actual, renderMarkdown: vi.fn(actual.renderMarkdown) }
})
import { fetchMobilePreferences, models } from '../api.ts'
import { loadHistory } from './App.tsx'

const loadHistoryMock = vi.mocked(loadHistory)
const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences)
const modelsMock = vi.mocked(models)
const renderMarkdownMock = vi.mocked(renderMarkdown)

const session: SessionView = {
  sessionId: 's-1',
  title: '测试会话',
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
}

/** Minimal mux stand-in: captures the ChatView's frame listener for hand-off. */
class FakeMux {
  listeners = new Set<(frame: unknown) => void>()
  onFrame(listener: (frame: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  emit(frame: unknown): void {
    for (const listener of this.listeners) listener(frame)
  }
}

/** One history entry wrapping a WireEvent (host history-page shape). */
function makeEntry(type: string, data: unknown, seq: number): { event: WireEvent } {
  return { event: { type, seq, time: seq * 1_000, data } }
}

/** Build an empty history page (the live stream supplies all content). */
function historyPage(): HistoryPage {
  return { events: [] as never, hasMore: false } as HistoryPage
}

/**
 * Emit one live text-delta chunk bound to the stable message id 'a-1' (the
 * mobile wire shape). A stable id keeps the message row mounted across the
 * fold, so the tests observe the throttle effect path only.
 */
function chunk(mux: FakeMux, text: string, seq: number): void {
  mux.emit({
    type: 'session/event',
    sessionId: 's-1',
    event: makeEntry('assistant/chunk', { messageId: 'a-1', turn: 0, step: 0, text }, seq).event,
  })
}

/** Emit the final assistant message (authoritative text, closes the turn). */
function finalMessage(mux: FakeMux, text: string, seq: number): void {
  mux.emit({
    type: 'session/event',
    sessionId: 's-1',
    event: makeEntry('assistant/message', {
      turn: 0,
      step: 0,
      message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text }] },
    }, seq).event,
  })
}

/** Round-trip HTML through the DOM so a byte comparison is symmetric. */
function normalize(html: string): string {
  const element = document.createElement('div')
  element.innerHTML = html
  return element.innerHTML
}

/** The assistant message's markdown body (dangerouslySetInnerHTML target). */
function body(): HTMLElement {
  const element = document.querySelector('.chat-msg.chat-msg-assistant .chat-md-body')
  if (element === null) throw new Error('assistant markdown body not found')
  return element as HTMLElement
}

beforeEach(() => {
  fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: true })
  modelsMock.mockResolvedValue({
    current: { provider: 'fx', model: 'fx-1' },
    routable: true,
    groups: [],
    failures: [],
  } satisfies SessionModels)
  loadHistoryMock.mockResolvedValue(historyPage())
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('ChatView streaming markdown throttle', () => {
  it('re-parses pending text at most once per interval and catches up byte-exactly', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)
    })

    const parts = [
      '第一段 **加粗** 文本与 `行内代码`。\n\n',
      '第二段 *斜体* 与 <标签> 内容。\n\n',
      '第三段 ~~删除线~~ 和 [链接](https://example.com/a)。',
    ]
    const full = parts.join('')

    // The first chunk mounts the pending message; the mount render parses it.
    await act(async () => { chunk(mux, parts[0] ?? '', 6) })
    const afterMount = renderMarkdownMock.mock.calls.length
    expect(afterMount).toBeGreaterThanOrEqual(1)

    // A burst of further chunks does not re-parse per chunk: at most one
    // leading parse may run (if the wall-clock gap to the burst exceeded the
    // window), but never one parse per chunk.
    await act(async () => {
      chunk(mux, parts[1] ?? '', 7)
      chunk(mux, parts[2] ?? '', 8)
    })
    expect(renderMarkdownMock.mock.calls.length - afterMount).toBeLessThan(2)
    // During the window the last parsed result stays visible: the newest
    // chunk's text has not reached the DOM yet.
    expect(body().innerHTML).not.toContain('第三段')

    // The trailing render inside the window catches up to the newest text,
    // byte-identical to a full renderMarkdown of the accumulated text.
    await act(async () => {
      vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS + 5)
    })
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(full)))
    expect(renderMarkdownMock.mock.calls.length - afterMount).toBeLessThan(3)
  })

  it('renders the exact final HTML immediately when the turn closes', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)
    })

    // The final event carries the authoritative text and closes the turn
    // (pending -> false) in the same synchronous burst as the chunks.
    const finalText = '最终 **整篇** `渲染` 与 [链接](https://example.com/x) 文本。'
    await act(async () => {
      chunk(mux, '流式前缀', 6)
      chunk(mux, '中间过程', 7)
      finalMessage(mux, finalText, 8)
    })

    // No timer advance needed: the closed turn already renders the exact
    // final HTML (terminal messages keep the immediate-render behavior).
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(finalText)))
  })

  it('keeps the streaming render fresh after window edges and skips the identical final parse', async () => {
    const mux = new FakeMux()
    await act(async () => {
      render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)
    })

    const first = '第一期内容。'
    const second = '第二期内容，包含 `code`。'
    const full = first + second

    // The chunk and the window edge in one tick: the trailing render fires
    // inside the window and shows the current text.
    await act(async () => {
      chunk(mux, first, 6)
      vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS + 5)
    })
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(first)))

    // A later chunk schedules a new trailing render; before it fires the last
    // parsed result is still on screen.
    await act(async () => { chunk(mux, second, 7) })
    expect(body().innerHTML).not.toContain('第二期内容')
    await act(async () => {
      vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS + 5)
    })
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(full)))

    // Closing the turn with the exact text already rendered must not re-parse
    // (the row already holds the byte-identical final HTML).
    const beforeFinal = renderMarkdownMock.mock.calls.length
    await act(async () => { finalMessage(mux, full, 9) })
    expect(renderMarkdownMock.mock.calls.length - beforeFinal).toBe(0)
    expect(normalize(body().innerHTML)).toBe(normalize(renderMarkdown(full)))
  })

  it('does not collapse long text while streaming (pending) and collapses once turn finishes', async () => {
    const mux = new FakeMux()
    let container: HTMLElement
    await act(async () => {
      const rendered = render(<ChatView session={session} mux={mux as never} onBack={() => {}} />)
      container = rendered.container
    })

    const hugeChunk = 'C'.repeat(LONG_TEXT_LIMIT + 200)

    // Stream a chunk exceeding LONG_TEXT_LIMIT
    await act(async () => {
      chunk(mux, hugeChunk, 6)
      vi.advanceTimersByTime(STREAM_RENDER_INTERVAL_MS + 5)
    })

    // During streaming (pending), message is not collapsed
    expect(container!.querySelector('.chat-md-collapsed')).toBeNull()
    expect(screen.queryByRole('button', { name: /展开全文/ })).toBeNull()

    // Turn closes
    await act(async () => {
      finalMessage(mux, hugeChunk, 7)
    })

    // Once turn ends (not pending), message is collapsed and has expand button
    expect(container!.querySelector('.chat-md-collapsed')).not.toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(`展开全文（${LONG_TEXT_LIMIT + 200} 字）`) })).toBeTruthy()
  })
})
