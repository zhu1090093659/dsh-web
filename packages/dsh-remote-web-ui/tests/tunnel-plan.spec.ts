/**
 * The settings-sync tunnel planner: mode precedence and target shaping.
 * quick (autoTunnel) wins over named (token + fixed base); named needs a
 * valid public base because the token does not carry the hostname.
 */
import { describe, expect, it } from 'vitest'
import { isHttpUrl, tunnelPlanOf } from '../src/tunnel-plan.ts'

describe('isHttpUrl', () => {
  it('accepts https and http URLs with a host', () => {
    expect(isHttpUrl('https://dsh.example.com')).toBe(true)
    expect(isHttpUrl('http://192.168.1.10:3080')).toBe(true)
  })

  it('rejects garbage and empty values', () => {
    expect(isHttpUrl('dsh.example.com')).toBe(false)
    expect(isHttpUrl('ftp://dsh.example.com')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('tunnelPlanOf', () => {
  it('quick wins when autoTunnel is on and reports the ignored keys', () => {
    expect(tunnelPlanOf({ autoTunnel: true }, 3080)).toEqual({
      mode: 'quick',
      targetUrl: 'http://127.0.0.1:3080',
      ignored: [],
    })
    expect(tunnelPlanOf({ autoTunnel: true, tunnelToken: 'tok', publicBaseUrl: 'https://dsh.example.com' }, 3080)).toEqual({
      mode: 'quick',
      targetUrl: 'http://127.0.0.1:3080',
      ignored: ['tunnelToken', 'publicBaseUrl'],
    })
    expect(tunnelPlanOf({ autoTunnel: true, publicBaseUrl: '' }, 3081).ignored).toEqual([])
  })

  it('named runs with a token and a valid public base', () => {
    expect(tunnelPlanOf({ tunnelToken: 'tok', publicBaseUrl: 'https://dsh.example.com' }, 3080)).toEqual({
      mode: 'named',
      token: 'tok',
      publicUrl: 'https://dsh.example.com',
    })
  })

  it('named without a usable public base stays off (the token does not carry the hostname)', () => {
    expect(tunnelPlanOf({ tunnelToken: 'tok' }, 3080)).toEqual({ mode: 'off' })
    expect(tunnelPlanOf({ tunnelToken: 'tok', publicBaseUrl: 'dsh.example.com' }, 3080)).toEqual({ mode: 'off' })
    expect(tunnelPlanOf({ tunnelToken: 'tok', publicBaseUrl: '' }, 3080)).toEqual({ mode: 'off' })
  })

  it('an empty token is unset; nothing configured is off', () => {
    expect(tunnelPlanOf({ tunnelToken: '' }, 3080)).toEqual({ mode: 'off' })
    expect(tunnelPlanOf({}, 3080)).toEqual({ mode: 'off' })
  })
})
