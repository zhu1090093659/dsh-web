import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_RETRY_CONFIG, isRetryableFailure, retryDelay, waitForRetry } from './retry.ts'

describe('automatic retry policy', () => {
  it('defaults to five retries after the initial request', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(5)
  })

  it('accepts only transient model-request failures', () => {
    expect(isRetryableFailure({ code: 'EMPTY_RESPONSE' })).toBe(true)
    expect(isRetryableFailure({ code: 'RATE_LIMIT' })).toBe(true)
    expect(isRetryableFailure({ code: 'SERVER' })).toBe(true)
    expect(isRetryableFailure({ code: 'TIMEOUT' })).toBe(true)
    expect(isRetryableFailure({ code: 'TRANSPORT' })).toBe(true)
    expect(isRetryableFailure({ code: 'AUTH' })).toBe(false)
    expect(isRetryableFailure({ code: 'INVALID_ARGS' })).toBe(false)
  })

  it('uses bounded exponential backoff and deterministic jitter', () => {
    const randomLow = vi.fn(() => 0)
    const randomHigh = vi.fn(() => 1)
    expect(retryDelay(1, DEFAULT_RETRY_CONFIG, randomLow)).toBe(450)
    expect(retryDelay(2, DEFAULT_RETRY_CONFIG, randomHigh)).toBe(1100)
    expect(retryDelay(5, DEFAULT_RETRY_CONFIG, () => 0.5)).toBe(8000)
    expect(retryDelay(6, DEFAULT_RETRY_CONFIG, () => 1)).toBe(10_000)
  })

  it('stops a pending delay when the request signal aborts', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const pending = waitForRetry(1000, controller.signal)
      controller.abort()
      await expect(pending).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
