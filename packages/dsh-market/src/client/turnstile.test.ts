/** @vitest-environment jsdom */

/**
 * Turnstile client contract: the request id a challenge is filed under, and
 * the challenge frame lifecycle (a failed or timed-out challenge must remove
 * its hidden iframe, so repeated challenges never accumulate frames).
 *
 * The two request-id cases were a second file (tests/turnstile.spec.ts) for the
 * same module; they live here with the lifecycle cases so one module has one
 * test file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketTurnstileToken, resetMarketTurnstile, turnstileRequestId } from './turnstile.ts'

/** Flush the microtask that starts the chained challenge. */
function tick(): Promise<void> {
  return Promise.resolve()
}

function challengeFrames(): NodeListOf<HTMLIFrameElement> {
  return document.querySelectorAll('iframe')
}

describe('turnstile request id', () => {
  it('user on a secure origin gets the browser randomUUID as the challenge id', () => {
    // Given: a browser crypto seat that exposes randomUUID
    const getRandomValues = vi.fn()
    // When: the client derives a request id
    const id = turnstileRequestId({
      randomUUID: () => '11111111-2222-4333-8444-555555555555' as `${string}-${string}-${string}-${string}-${string}`,
      getRandomValues,
    } as Pick<Crypto, 'getRandomValues' | 'randomUUID'>)
    // Then: the id is that UUID and the fallback entropy source was never touched
    expect(id).toBe('11111111-2222-4333-8444-555555555555')
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('user on an insecure LAN origin still gets a UUID v4 from getRandomValues', () => {
    // Given: a browser crypto seat without randomUUID (plain http LAN origin)
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.set([0, 1, 2, 3, 4, 5, 0xff, 7, 0xff, 9, 10, 11, 12, 13, 14, 15])
      return array
    }
    // When: the client derives a request id with the version and variant bits applied
    const id = turnstileRequestId({ getRandomValues })
    // Then: the id is a well-formed UUID v4
    expect(id).toBe('00010203-0405-4f07-bf09-0a0b0c0d0e0f')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('turnstile challenge frame lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetMarketTurnstile()
    for (const leftover of challengeFrames()) leftover.remove()
  })

  it('user retrying after a failed challenge never accumulates hidden frames', async () => {
    // Given: one pending challenge whose frame is in the document
    const first = marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
    const failed = challengeFrames()[0]

    // When: the challenge fails and the user retries
    failed.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('turnstile-frame-failed')
    expect(document.body.contains(failed)).toBe(false)
    const retry = marketTurnstileToken()
    await tick()

    // Then: the retry owns exactly one frame, and failing it again leaves none
    expect(challengeFrames()).toHaveLength(1)
    challengeFrames()[0].dispatchEvent(new Event('error'))
    await expect(retry).rejects.toThrow('turnstile-frame-failed')
    expect(challengeFrames()).toHaveLength(0)
  })

  it('user whose challenge times out gets the stale frame removed and a fresh one on retry', async () => {
    // Given: a challenge frame that has loaded and a fake clock
    vi.useFakeTimers()
    const pending = marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
    const frame = challengeFrames()[0]
    frame.dispatchEvent(new Event('load'))
    await tick()

    // When: the challenge outlives its timeout window
    await vi.advanceTimersByTimeAsync(10_001)

    // Then: the challenge rejects, the frame is gone, and a later challenge builds a fresh one
    await expect(pending).rejects.toThrow('turnstile-timeout')
    expect(document.body.contains(frame)).toBe(false)
    expect(challengeFrames()).toHaveLength(0)
    marketTurnstileToken()
    await tick()
    expect(challengeFrames()).toHaveLength(1)
  })
})
