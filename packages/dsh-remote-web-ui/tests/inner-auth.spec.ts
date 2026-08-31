/** The process's inner browser credential: launch-token redemption and caching. */
import { describe, expect, it } from 'vitest'
import { createInnerAuth } from '../src/inner-auth.ts'

function cookieResponse(cookies: string[]): Response {
  return new Response(null, { status: 303, headers: { 'set-cookie': cookies } })
}

describe('createInnerAuth', () => {
  it('redeems the launch token once and caches the browser-auth cookie pair', async () => {
    let calls = 0
    const auth = createInnerAuth(() => 'http://127.0.0.1:3080/?token=t', async () => {
      calls += 1
      return cookieResponse([
        'dsh-auth-abc=v1.body.sig; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict',
        'other=1; Path=/',
      ])
    })
    expect(await auth.ready()).toBe('dsh-auth-abc=v1.body.sig')
    expect(await auth.ready()).toBe('dsh-auth-abc=v1.body.sig')
    expect(calls).toBe(1)
  })

  it('returns undefined when the exchange sets no browser-auth cookie', async () => {
    const auth = createInnerAuth(() => 'http://127.0.0.1:3080/?token=t', async () => cookieResponse(['other=1; Path=/']))
    expect(await auth.ready()).toBeUndefined()
  })

  it('surfaces redeem failures as undefined instead of throwing', async () => {
    const auth = createInnerAuth(() => 'http://127.0.0.1:3080/?token=t', async () => {
      throw new Error('connection refused')
    })
    expect(await auth.ready()).toBeUndefined()
  })

  it('returns undefined without a launch URL and re-redeems after invalidation', async () => {
    let url: string | undefined = 'http://127.0.0.1:3080/?token=t'
    let calls = 0
    const auth = createInnerAuth(() => url, async () => {
      calls += 1
      return cookieResponse(['dsh-auth-abc=v2.sig; Path=/'])
    })
    expect(await auth.ready()).toBe('dsh-auth-abc=v2.sig')
    auth.invalidate()
    expect(await auth.ready()).toBe('dsh-auth-abc=v2.sig')
    expect(calls).toBe(2)
    // No URL (connection service gone): fail closed to undefined.
    url = undefined
    auth.invalidate()
    expect(await auth.ready()).toBeUndefined()
  })
})
