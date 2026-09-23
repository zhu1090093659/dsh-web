// @vitest-environment jsdom
/**
 * Shell rendering adapter DOM-work contracts (#954 follow-up): the composer
 * seat is resolved once and reused while connected, the
 * `--dsh-composer-height` write is skipped when the value is unchanged,
 * mutation bursts coalesce into one measurement per animation frame, and
 * teardown cancels pending work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installShellRenderingAdapter,
  shellRenderingCss,
  SHELL_RENDERING_STYLE_ATTR,
} from '../src/client/runtime/shell-rendering.ts'

const COMPOSER_ATTR = 'data-slot'
const COMPOSER_VALUE = 'conversation.composer'

interface FrameStub {
  flush: () => void
  pending: () => number
  cancelled: () => number
}

let frames: Array<FrameRequestCallback | null> = []
let cancelledFrames = 0
let originalRaf: typeof window.requestAnimationFrame
let originalCancelRaf: typeof window.cancelAnimationFrame

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(_callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
}

function installFrameStub(): FrameStub {
  frames = []
  cancelledFrames = 0
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  }) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((handle: number) => {
    if (handle > 0 && frames[handle - 1] !== undefined) {
      frames[handle - 1] = null
      cancelledFrames += 1
    }
  }) as typeof window.cancelAnimationFrame
  return {
    flush: () => {
      const pending = frames.splice(0, frames.length)
      for (const callback of pending) callback?.(0)
    },
    pending: () => frames.filter(callback => callback !== null).length,
    cancelled: () => cancelledFrames,
  }
}

function rectFor(height: number): DOMRect {
  return {
    height,
    width: 800,
    top: 500,
    bottom: 500 + height,
    left: 0,
    right: 800,
    x: 0,
    y: 500,
    toJSON: () => ({}),
  } as DOMRect
}

/** Mount a composer seat whose measured height is scripted by the caller. */
function mountComposer(height: number): { el: HTMLElement; rect: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div')
  el.setAttribute(COMPOSER_ATTR, COMPOSER_VALUE)
  const rect = vi.fn(() => rectFor(height))
  el.getBoundingClientRect = rect as unknown as typeof el.getBoundingClientRect
  document.body.appendChild(el)
  return { el, rect }
}

/** Let the MutationObserver deliver its queued records (macrotask). */
function deliverMutations(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

function appliedHeight(): string {
  return document.documentElement.style.getPropertyValue('--dsh-composer-height')
}

let framesStub: FrameStub
let activeDispose: (() => void) | null = null

/** Install the adapter and remember its teardown for the afterEach sweep. */
function install(): () => void {
  activeDispose = installShellRenderingAdapter(document)
  return activeDispose
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.style.removeProperty('--dsh-composer-height')
  originalRaf = window.requestAnimationFrame
  originalCancelRaf = window.cancelAnimationFrame
  framesStub = installFrameStub()
  FakeResizeObserver.instances = []
  window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
  activeDispose?.()
  activeDispose = null
  window.requestAnimationFrame = originalRaf
  window.cancelAnimationFrame = originalCancelRaf
  delete (window as { ResizeObserver?: unknown }).ResizeObserver
  document.head.querySelector(`style[${SHELL_RENDERING_STYLE_ATTR}]`)?.remove()
  vi.restoreAllMocks()
})

describe('shell rendering adapter DOM work', () => {
  it('writes the composer height once when unchanged across many mutation bursts', async () => {
    const { el, rect } = mountComposer(128)
    const querySpy = vi.spyOn(document.body, 'querySelector')
    const setSpy = vi.spyOn(document.documentElement.style, 'setProperty')

    const dispose = install()
    expect(appliedHeight()).toBe('128px')
    expect(querySpy).toHaveBeenCalledTimes(1)
    expect(rect).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledTimes(1)

    // Streaming-like churn: many mutation batches, each delivered on its own
    // microtask checkpoint, all inside the same animation frame.
    for (let i = 0; i < 50; i++) {
      document.body.appendChild(document.createElement('div'))
      await Promise.resolve()
    }
    expect(framesStub.pending()).toBe(1)
    // Nothing measured or written before the frame is flushed.
    expect(rect).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledTimes(1)

    framesStub.flush()
    // One coalesced measurement for the whole burst, still one write total.
    expect(rect).toHaveBeenCalledTimes(2)
    expect(setSpy).toHaveBeenCalledTimes(1)
    // The connected composer stayed cached: no repeated body query.
    expect(querySpy).toHaveBeenCalledTimes(1)
    expect(appliedHeight()).toBe('128px')
    expect(el.isConnected).toBe(true)
    dispose()
  })

  it('writes the new value when the composer height really changes', async () => {
    const { rect } = mountComposer(128)
    const setSpy = vi.spyOn(document.documentElement.style, 'setProperty')
    const dispose = install()
    expect(appliedHeight()).toBe('128px')
    setSpy.mockClear()

    rect.mockReturnValue(rectFor(200))
    document.body.appendChild(document.createElement('div'))
    await deliverMutations()
    framesStub.flush()

    expect(appliedHeight()).toBe('200px')
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith('--dsh-composer-height', '200px')
    dispose()
  })

  it('re-resolves a replaced composer and re-targets the ResizeObserver', async () => {
    const { el: first } = mountComposer(128)
    const querySpy = vi.spyOn(document.body, 'querySelector')
    const dispose = install()
    const observer = FakeResizeObserver.instances[0]!
    expect(observer.observe).toHaveBeenCalledWith(first)
    expect(appliedHeight()).toBe('128px')
    expect(querySpy).toHaveBeenCalledTimes(1)

    const second = document.createElement('div')
    second.setAttribute(COMPOSER_ATTR, COMPOSER_VALUE)
    second.getBoundingClientRect = vi.fn(() => rectFor(210)) as unknown as typeof second.getBoundingClientRect
    first.replaceWith(second)

    await deliverMutations()
    framesStub.flush()

    // The stale node is dropped, the replacement is re-queried, re-observed
    // and measured.
    expect(observer.unobserve).toHaveBeenCalledWith(first)
    expect(observer.observe).toHaveBeenCalledWith(second)
    expect(observer.observe).toHaveBeenCalledTimes(2)
    expect(querySpy).toHaveBeenCalledTimes(2)
    expect(appliedHeight()).toBe('210px')
    dispose()
  })

  it('cancels a pending frame and cleans up on dispose', async () => {
    const { rect } = mountComposer(128)
    const setSpy = vi.spyOn(document.documentElement.style, 'setProperty')
    const dispose = install()
    const observer = FakeResizeObserver.instances[0]!
    expect(appliedHeight()).toBe('128px')
    rect.mockClear()
    setSpy.mockClear()

    rect.mockReturnValue(rectFor(333))
    document.body.appendChild(document.createElement('div'))
    await deliverMutations()
    expect(framesStub.pending()).toBe(1)

    dispose()
    expect(framesStub.cancelled()).toBe(1)
    framesStub.flush()

    // The cancelled frame must not re-measure or re-apply the property.
    expect(rect).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
    expect(appliedHeight()).toBe('')
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(document.head.querySelector(`style[${SHELL_RENDERING_STYLE_ATTR}]`)).toBeNull()

    // A later mutation cannot resurrect the adapter after teardown.
    document.body.appendChild(document.createElement('div'))
    await deliverMutations()
    expect(framesStub.pending()).toBe(0)
  })

  it('skips the body query for later frames while the cached composer stays connected', async () => {
    mountComposer(96)
    const querySpy = vi.spyOn(document.body, 'querySelector')
    const dispose = install()
    querySpy.mockClear()

    for (let frame = 0; frame < 3; frame++) {
      document.body.appendChild(document.createElement('div'))
      await deliverMutations()
      framesStub.flush()
    }

    expect(querySpy).not.toHaveBeenCalled()
    expect(appliedHeight()).toBe('96px')
    dispose()
  })
})

/**
 * #1490: the dark-theme badge correction shipped for #1117 prefixed the
 * already-scoped selector list with body[data-ds-dark-theme], which emits
 * "body ... html ..." — the attribute sits on <body>, so no element can ever
 * match that descendant chain and the whole rule was dead CSS.
 */
describe('shell rendering dark-theme badge correction', () => {
  it('scopes the dark-theme badge rule under the active visual selectors', () => {
    const css = shellRenderingCss()
    expect(css).toContain('html[data-dsh-skin] body[data-ds-dark-theme] [data-question-key] [class*="_badge"]')
    expect(css).toContain('html[data-dsh-skin] body[data-ds-dark-theme] [data-question-scroll] [class*="_badge"]')
  })

  it('never orders a scoped html prefix after a body attribute', () => {
    // The dead-CSS shape: a body-prefixed selector whose target then requires an
    // html ancestor. Guard the whole sheet, not just the badge rule.
    const offenders = shellRenderingCss()
      .split(',')
      .filter((selector) => {
        const body = selector.indexOf('body[')
        const html = selector.indexOf('html[')
        return body !== -1 && html !== -1 && body < html
      })
    expect(offenders).toEqual([])
  })
})
