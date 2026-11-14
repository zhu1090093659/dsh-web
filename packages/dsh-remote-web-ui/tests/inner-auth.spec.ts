/** The process's inner browser credential: launch-token redemption and caching. */
import { describe, expect, it } from 'vitest'
import { resolveLaunchTokenUrl, type LaunchTokenContext } from '../src/index.ts'
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

describe('resolveLaunchTokenUrl', () => {
  it('operator resolves legacy ctx.connection.authenticatedUrl when present', () => {
    // Given a legacy SDK cohort host whose ctx.connection exposes authenticatedUrl
    const ctx: LaunchTokenContext = {
      connection: { authenticatedUrl: (baseUrl: string) => `${baseUrl}?token=legacy` },
    }

    // When resolving the launch-token URL
    const resolved = resolveLaunchTokenUrl(ctx, 'http://127.0.0.1:4321/')

    // Then the legacy connection URL is returned directly
    expect(resolved).toBe('http://127.0.0.1:4321/?token=legacy')
  })

  it('operator collects peer-auth entry URLs from webserver/entry-url preferring open=true', () => {
    // Given a peer-auth host where connection has no authenticatedUrl and providers respond via webserver/entry-url
    const serverToken = { tag: 'webserver' }
    const ctx: LaunchTokenContext = {
      connection: {},
      webServer: serverToken,
      emit: (subject, event, baseUrl, entries) => {
        if (subject === serverToken && event === 'webserver/entry-url') {
          entries.push({ url: `${baseUrl}?token=secondary`, open: false })
          entries.push({ url: `${baseUrl}?token=primary`, open: true })
        }
      },
    }

    // When resolving the launch-token URL across registered providers
    const resolved = resolveLaunchTokenUrl(ctx, 'http://127.0.0.1:4321/')

    // Then the open=true provider URL takes priority
    expect(resolved).toBe('http://127.0.0.1:4321/?token=primary')
  })

  it('operator falls back to the first non-empty entry URL and tolerates provider errors', () => {
    // Given one host without open=true and another whose emit handler throws
    const fallbackCtx: LaunchTokenContext = {
      webServer: {},
      emit: (_subject, _event, baseUrl, entries) => {
        entries.push({ url: '' })
        entries.push({ url: `${baseUrl}?token=fallback` })
      },
    }
    const throwingCtx: LaunchTokenContext = {
      webServer: {},
      emit: () => { throw new Error('emit failed') },
    }

    // When resolving the launch-token URL on both contexts
    const fallbackUrl = resolveLaunchTokenUrl(fallbackCtx, 'http://127.0.0.1:4321/')
    const throwingUrl = resolveLaunchTokenUrl(throwingCtx, 'http://127.0.0.1:4321/')

    // Then the fallback URL is returned and the throwing context returns undefined
    expect(fallbackUrl).toBe('http://127.0.0.1:4321/?token=fallback')
    expect(throwingUrl).toBeUndefined()
  })
})
