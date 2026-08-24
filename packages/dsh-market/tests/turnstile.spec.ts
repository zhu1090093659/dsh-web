import { describe, expect, it, vi } from 'vitest'
import { turnstileRequestId } from '../src/client/turnstile.ts'

describe('turnstile request ids', () => {
  it('uses randomUUID when the browser exposes it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555' as `${string}-${string}-${string}-${string}-${string}`)
    const getRandomValues = vi.fn()
    const id = turnstileRequestId({ randomUUID, getRandomValues } as Pick<Crypto, 'getRandomValues' | 'randomUUID'>)
    expect(id).toBe('11111111-2222-4333-8444-555555555555')
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('builds a UUID v4 with getRandomValues on insecure LAN origins', () => {
    const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.set([0, 1, 2, 3, 4, 5, 0xff, 7, 0xff, 9, 10, 11, 12, 13, 14, 15])
      return array
    }
    const id = turnstileRequestId({ getRandomValues })
    expect(id).toBe('00010203-0405-4f07-bf09-0a0b0c0d0e0f')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
