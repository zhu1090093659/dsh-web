/**
 * The trusted public base across a tunnel reconnect (issue #1547): a public
 * request from the address still printed in the QR code must not answer 403
 * the moment the tunnel leaves \`running\`.
 */
import { describe, expect, it, vi } from 'vitest'
import { PublicBaseKeeper, PUBLIC_BASE_GRACE_MS } from '../src/public-base.ts'

function keeper(): { base: PublicBaseKeeper; seen: Array<string | undefined> } {
  const seen: Array<string | undefined> = []
  return { base: new PublicBaseKeeper(base => { seen.push(base) }), seen }
}

describe('public base keeper (#1547)', () => {
  it('keeps a named tunnel host across a reconnect', () => {
    const { base, seen } = keeper()
    base.setMode('named')
    base.markRunning('https://dsh.example.com')
    base.markReconnecting()
    expect(base.current()).toBe('https://dsh.example.com')
    expect(seen.at(-1)).toBe('https://dsh.example.com')
  })

  it('keeps a registered relay host across a reconnect', () => {
    const { base, seen } = keeper()
    base.setMode('quick')
    base.markRunning('https://random.trycloudflare.com')
    base.setRelay('https://abc.dsh-market.com')
    expect(base.current()).toBe('https://abc.dsh-market.com')
    base.markReconnecting()
    expect(base.current()).toBe('https://abc.dsh-market.com')
    expect(seen.at(-1)).toBe('https://abc.dsh-market.com')
  })

  it('drops a quick tunnel host only after the grace window', () => {
    vi.useFakeTimers()
    try {
      const { base } = keeper()
      base.setMode('quick')
      base.markRunning('https://random.trycloudflare.com')
      base.markReconnecting()
      // A phone request already in flight still reaches the fence.
      expect(base.current()).toBe('https://random.trycloudflare.com')
      vi.advanceTimersByTime(PUBLIC_BASE_GRACE_MS - 1)
      expect(base.current()).toBe('https://random.trycloudflare.com')
      vi.advanceTimersByTime(1)
      expect(base.current()).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending drop when the tunnel comes back with a new host', () => {
    vi.useFakeTimers()
    try {
      const { base, seen } = keeper()
      base.setMode('quick')
      base.markRunning('https://a.trycloudflare.com')
      base.markReconnecting()
      base.markRunning('https://b.trycloudflare.com')
      vi.advanceTimersByTime(PUBLIC_BASE_GRACE_MS * 2)
      expect(base.current()).toBe('https://b.trycloudflare.com')
      expect(seen.at(-1)).toBe('https://b.trycloudflare.com')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays forgotten once the base was reset', () => {
    vi.useFakeTimers()
    try {
      const { base } = keeper()
      base.setMode('quick')
      base.markRunning('https://a.trycloudflare.com')
      base.markReconnecting()
      base.reset()
      expect(base.current()).toBeUndefined()
      vi.advanceTimersByTime(PUBLIC_BASE_GRACE_MS)
      expect(base.current()).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
