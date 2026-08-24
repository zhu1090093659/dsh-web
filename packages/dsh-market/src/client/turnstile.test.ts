/** @vitest-environment jsdom */

/**
 * Turnstile challenge frame lifecycle: a failed or timed-out challenge must
 * remove its hidden iframe, so repeated challenges never accumulate frames.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketTurnstileToken, resetMarketTurnstile } from './turnstile.ts'

/** Flush the microtask that starts the chained challenge. */
function tick(): Promise<void> {
  return Promise.resolve()
}

function challengeFrames(): NodeListOf<HTMLIFrameElement> {
  return document.querySelectorAll('iframe')
}

describe('turnstile challenge frame lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetMarketTurnstile()
    for (const leftover of challengeFrames()) leftover.remove()
  })

  it('removes the failed challenge frame so retries do not accumulate iframes', async () => {
    const first = marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
    const failed = challengeFrames()[0]
    failed.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('turnstile-frame-failed')
    expect(document.body.contains(failed)).toBe(false)

    const retry = marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
    challengeFrames()[0].dispatchEvent(new Event('error'))
    await expect(retry).rejects.toThrow('turnstile-frame-failed')
    expect(challengeFrames()).toHaveLength(0)
  })

  it('removes the frame and clears the ready state when a challenge times out', async () => {
    vi.useFakeTimers()
    const pending = marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
    const frame = challengeFrames()[0]
    frame.dispatchEvent(new Event('load'))
    await tick()
    await vi.advanceTimersByTimeAsync(10_001)
    await expect(pending).rejects.toThrow('turnstile-timeout')
    expect(document.body.contains(frame)).toBe(false)
    expect(challengeFrames()).toHaveLength(0)

    // A later challenge builds a fresh frame instead of reusing the removed one.
    const retry = marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
  })
})
