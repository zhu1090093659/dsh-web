/** Host config keeps authenticated proxy access opt-in and secret values in the environment. */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PROXY_TOKEN_ENV, resolveProxyAccess } from '../src/index.ts'

describe('authenticated proxy config', () => {
  it('keeps the bridge loopback-only by default', () => {
    expect(resolveProxyAccess(undefined, {})).toEqual({ trustedProxyHosts: [] })
  })

  it('reads the shared token from the configured environment variable', () => {
    expect(resolveProxyAccess({
      trustedProxyHosts: ['dsh.example.test'],
      proxyTokenEnv: 'CUSTOM_PROXY_TOKEN',
    }, { CUSTOM_PROXY_TOKEN: 'test-proxy-token' })).toEqual({
      trustedProxyHosts: ['dsh.example.test'],
      proxyToken: 'test-proxy-token',
    })
  })

  it('uses the documented default token environment variable', () => {
    expect(resolveProxyAccess({ trustedProxyHosts: ['dsh.example.test'] }, {
      [DEFAULT_PROXY_TOKEN_ENV]: 'test-proxy-token',
    }).proxyToken).toBe('test-proxy-token')
  })

  it('fails loud when proxy access is enabled without a token', () => {
    expect(() => resolveProxyAccess({ trustedProxyHosts: ['dsh.example.test'] }, {}))
      .toThrow(DEFAULT_PROXY_TOKEN_ENV)
  })

  it('rejects a blank environment variable name', () => {
    expect(() => resolveProxyAccess({
      trustedProxyHosts: ['dsh.example.test'],
      proxyTokenEnv: ' ',
    }, {})).toThrow(/proxyTokenEnv must not be empty/)
  })
})
