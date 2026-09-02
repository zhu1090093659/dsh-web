// @vitest-environment jsdom
/** Session-id panel: lists every session id, exposes a copy button per row. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionIdPanel, type SessionIdPanelProps } from '../src/client/SessionIdPanel.tsx'
import { zh, type SessionIdKey } from '../src/client/locales.ts'

// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); stub the one value member
// the panel uses so copy clicks resolve deterministically.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  writeClipboard: vi.fn(async () => true),
}))

const sid = (value: string): SessionId => value as never

/** Minimal translate over the zh dictionary (template params included). */
function makeTranslate(): SessionIdPanelProps['t'] {
  return (key, params) => {
    let text = zh[key as SessionIdKey] ?? key
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

/** Build a fake SessionListState from summaries (branded ids via sid). */
function makeList(sessions: Array<{
  id: string
  displayTitle: string
  updatedAt: number
  blank?: boolean
  running?: boolean
  completed?: boolean
}>, current?: string): SessionListState {
  const byId: any = {}
  for (const row of sessions) {
    byId[sid(row.id)] = {
      id: sid(row.id),
      displayTitle: row.displayTitle,
      updatedAt: row.updatedAt,
      blank: row.blank ?? false,
      running: row.running ?? false,
      ...(row.completed !== undefined ? { completed: row.completed } : {}),
    }
  }
  return {
    ids: sessions.map(row => sid(row.id)) as never,
    byId,
    current: current === undefined ? undefined : sid(current) as never,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

/** A controllable list source for the panel. */
function sourceOf(snapshot: SessionListState): SessionIdPanelProps['list'] {
  let current = snapshot
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SessionIdPanel', () => {
  it('renders every session title and full id, with a copy button per row', () => {
    const list = sourceOf(makeList([
      { id: 'session-aaa', displayTitle: 'Alpha', updatedAt: 1_700_000_000_000 },
      { id: 'session-bbb', displayTitle: 'Beta', updatedAt: 1_700_000_100_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('session-aaa')).toBeTruthy()
    expect(screen.getByText('session-bbb')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: /复制|copy/i })
    expect(buttons.length).toBe(2)
  })

  it('marks the current session row', () => {
    const list = sourceOf(makeList([
      { id: 'session-aaa', displayTitle: 'Alpha', updatedAt: 1_700_000_000_000 },
      { id: 'session-bbb', displayTitle: 'Beta', updatedAt: 1_700_000_100_000 },
    ], 'session-bbb'))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    expect(screen.getByText('当前')).toBeTruthy()
  })

  it('renders the empty state when there are no sessions', () => {
    const list = sourceOf(makeList([]))
    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    expect(screen.getByText('暂无会话')).toBeTruthy()
  })

  it('copies the row id to the clipboard when the copy button is clicked', async () => {
    // The top-level mock keeps this import binding the stubbed writeClipboard.
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    const spy = vi.mocked(primitives.writeClipboard)

    const list = sourceOf(makeList([
      { id: 'session-zzz', displayTitle: 'Zulu', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const button = screen.getByRole('button', { name: /复制|copy/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('session-zzz')
    })
  })

  it('shows an actionable failed state when the clipboard write fails', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    vi.mocked(primitives.writeClipboard).mockResolvedValueOnce(false)

    const list = sourceOf(makeList([
      { id: 'session-zzz', displayTitle: 'Zulu', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const button = screen.getByRole('button', { name: /复制|copy/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('复制失败，请重试')).toBeTruthy()
    })
  })

  it('stamps semantic attributes on the panel, rows and copy buttons', () => {
    const list = sourceOf(makeList([
      { id: 'session-aaa', displayTitle: 'Alpha', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const overlay = screen.getByRole('presentation')
    expect(overlay.getAttribute('data-dsh-plugin')).toBe('session-id')
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('data-dsh-part')).toBe('panel')
    const row = document.querySelector('[data-dsh-part="row"]')
    expect(row).toBeTruthy()
    const copy = document.querySelector('[data-dsh-part="copy"]')
    expect(copy).toBeTruthy()
  })

  it('filters rows by title or id substring when searching', () => {
    const list = sourceOf(makeList([
      { id: 'session-aaa', displayTitle: 'Alpha', updatedAt: 1_700_000_000_000 },
      { id: 'session-bbb', displayTitle: 'Beta', updatedAt: 1_700_000_100_000 },
      { id: 'session-ccc', displayTitle: 'Gamma', updatedAt: 1_700_000_200_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const input = screen.getByRole('searchbox')

    // Filter by title substring.
    fireEvent.change(input, { target: { value: 'eta' } })
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByText('Gamma')).toBeNull()

    // Filter by id substring.
    fireEvent.change(input, { target: { value: 'session-aaa' } })
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Beta')).toBeNull()

    // Empty query restores the full list.
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Gamma')).toBeTruthy()
  })

  it('shows the no-match state when the query matches nothing', () => {
    const list = sourceOf(makeList([
      { id: 'session-aaa', displayTitle: 'Alpha', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'zzz-no-such' } })

    expect(screen.getByText('无匹配会话')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('falls back to the id as the title when the display title is empty', () => {
    const list = sourceOf(makeList([
      { id: 'session-aaa', displayTitle: '', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    // The row renders the id as its visible title when displayTitle is blank:
    // the id text appears at least twice (title span + id span).
    expect(screen.getAllByText('session-aaa').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps very long ids inside the row (title attribute carries the full id)', () => {
    const longId = `session-${'a'.repeat(80)}`
    const list = sourceOf(makeList([
      { id: longId, displayTitle: 'Long', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const row = document.querySelector('[data-dsh-part="row"]')
    expect(row).toBeTruthy()
    const idEl = row?.querySelector('[class*="rowId"]') as HTMLElement | null
    expect(idEl).toBeTruthy()
    // The full id stays reachable (row title / id tooltip) even when clipped.
    expect(idEl?.getAttribute('title')).toBe(longId)
  })

  it('flips to the failed state when writeClipboard rejects', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    vi.mocked(primitives.writeClipboard).mockRejectedValueOnce(new Error('clipboard unavailable'))

    const list = sourceOf(makeList([
      { id: 'session-zzz', displayTitle: 'Zulu', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const button = screen.getByRole('button', { name: /复制|copy/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('复制失败，请重试')).toBeTruthy()
    })
  })

  it('keeps a single pending status-reset timer across rapid repeated copies', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    vi.mocked(primitives.writeClipboard).mockResolvedValue(true)
    vi.useFakeTimers()

    const list = sourceOf(makeList([
      { id: 'session-zzz', displayTitle: 'Zulu', updatedAt: 1_700_000_000_000 },
    ]))

    render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const button = screen.getByRole('button', { name: /复制|copy/i })

    fireEvent.click(button)
    await act(async () => {}) // flush the clipboard write
    expect(screen.getByText('已复制')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(1)

    // A second click must cancel the previous reset before scheduling a new
    // one; without the clear there would be two stacked timers.
    fireEvent.click(button)
    await act(async () => {})
    expect(vi.getTimerCount()).toBe(1)

    // The single pending timer resets the button exactly once to idle.
    act(() => { vi.advanceTimersByTime(1200) })
    expect(screen.queryByText('已复制')).toBeNull()
    expect(screen.getByText('复制')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the pending status-reset timer when the row unmounts', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    vi.mocked(primitives.writeClipboard).mockResolvedValue(true)
    vi.useFakeTimers()

    const list = sourceOf(makeList([
      { id: 'session-zzz', displayTitle: 'Zulu', updatedAt: 1_700_000_000_000 },
    ]))

    const { unmount } = render(<SessionIdPanel list={list} onClose={() => {}} t={makeTranslate()} />)
    const button = screen.getByRole('button', { name: /复制|copy/i })

    fireEvent.click(button)
    await act(async () => {})
    expect(vi.getTimerCount()).toBe(1)

    // Unmount cleanup must clear the handle; no timer may stay registered.
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
