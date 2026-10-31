/**
 * The settings-sync tunnel planner: mode precedence and target shaping.
 * quick (autoTunnel) wins over named (token + fixed base); named needs a
 * valid public base because the token does not carry the hostname.
 */
import { describe, expect, it } from 'vitest'
import { isHttpUrl, tunnelPlanOf } from '../src/host/tunnel-plan.ts'

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
    // An empty public base is not reported as ignored. The property is read
    // through `toMatchObject` because this package type-checks its tests and the
    // planner's union has no `ignored` on the `off` variant; the array itself
    // still has to match exactly.
    expect(tunnelPlanOf({ autoTunnel: true, publicBaseUrl: '' }, 3081)).toMatchObject({ mode: 'quick', ignored: [] })
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

  it('operator defers the quick plan to off while the port is unbound (0.2.1-rc.2 port type)', () => {
    // Given an autoTunnel configuration while the listener port is still undefined
    // When tunnelPlanOf computes the plan
    // Then the plan stays off instead of minting an http://127.0.0.1:undefined target
    expect(tunnelPlanOf({ autoTunnel: true }, undefined)).toEqual({ mode: 'off' })
    expect(tunnelPlanOf({ autoTunnel: true, tunnelToken: 'tok', publicBaseUrl: 'https://dsh.example.com' }, undefined)).toEqual({ mode: 'off' })
  })

  it('operator runs the named and off plans without needing the port', () => {
    // Given named-tunnel and empty configurations while the port is undefined
    // When tunnelPlanOf computes each plan
    // Then named and off resolve normally without a local port
    expect(tunnelPlanOf({ tunnelToken: 'tok', publicBaseUrl: 'https://dsh.example.com' }, undefined)).toEqual({
      mode: 'named',
      token: 'tok',
      publicUrl: 'https://dsh.example.com',
    })
    expect(tunnelPlanOf({}, undefined)).toEqual({ mode: 'off' })
  })
})
