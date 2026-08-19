import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { watchRendererReload } from './renderer-recovery.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('renderer reload watchdog', () => {
  it('scopes listeners to one successful load generation', () => {
    vi.useFakeTimers()
    const events = new EventEmitter()
    const firstSettled = vi.fn()
    const first = watchRendererReload(events, 5_000, firstSettled)
    const staleFinish = events.listeners('did-finish-load')[0]

    events.emit('did-fail-load', {}, -3, 'subframe aborted', 'about:blank', false)
    expect(firstSettled).not.toHaveBeenCalled()
    events.emit('did-finish-load')
    expect(firstSettled).toHaveBeenCalledWith('loaded')
    expect(events.listenerCount('did-finish-load')).toBe(0)
    expect(events.listenerCount('did-fail-load')).toBe(0)

    const secondSettled = vi.fn()
    const second = watchRendererReload(events, 5_000, secondSettled)
    staleFinish?.()
    expect(secondSettled).not.toHaveBeenCalled()
    events.emit('did-fail-load', {}, -105, 'name not resolved', 'https://dsh.invalid', true)
    expect(secondSettled).toHaveBeenCalledWith('failed')
    expect(events.listenerCount('did-finish-load')).toBe(0)
    expect(events.listenerCount('did-fail-load')).toBe(0)

    first.dispose()
    second.dispose()
  })

  it('reports timeout once and removes the generation listeners', () => {
    vi.useFakeTimers()
    const events = new EventEmitter()
    const settled = vi.fn()
    watchRendererReload(events, 2_000, settled)

    vi.advanceTimersByTime(1_999)
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(settled).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledWith('timed-out')
    expect(events.listenerCount('did-finish-load')).toBe(0)
    expect(events.listenerCount('did-fail-load')).toBe(0)

    events.emit('did-finish-load')
    vi.advanceTimersByTime(2_000)
    expect(settled).toHaveBeenCalledOnce()
  })

  it('can be disposed without publishing a stale outcome', () => {
    vi.useFakeTimers()
    const events = new EventEmitter()
    const settled = vi.fn()
    const watchdog = watchRendererReload(events, 2_000, settled)

    watchdog.dispose()
    events.emit('did-finish-load')
    vi.advanceTimersByTime(2_000)

    expect(settled).not.toHaveBeenCalled()
    expect(events.listenerCount('did-finish-load')).toBe(0)
    expect(events.listenerCount('did-fail-load')).toBe(0)
  })
})
