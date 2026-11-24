// @vitest-environment node
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { connectionAdmits } from '../src/host/connection-trust.ts'

const request = { headers: {}, socket: {} } as IncomingMessage

describe('Host connection trust bridge', () => {
  it('operator on a peer-auth host enters only with a peer and no rejection', () => {
    // Given peer-auth admission results for accepted and rejected requests
    const admit = vi.fn(() => ({ peer: { id: 'browser-1' } }))
    // When the bridge evaluates them
    const allowed = connectionAdmits({ admit }, request)
    // Then only a live peer without a rejection is an admission and admit saw the original request
    expect(allowed).toBe(true)
    expect(admit).toHaveBeenCalledWith(request)
    expect(connectionAdmits({ admit: () => ({ rejection: 401 }) }, request)).toBe(false)
    expect(connectionAdmits({ admit: () => ({}) }, request)).toBe(false)
  })

  it('operator keeps the old fence when the Host bridge is absent or throws', () => {
    // Given no usable Host decision, including an authentication injection failure
    // When the bridge evaluates the request
    // Then it never turns a missing or failed decision into admission
    expect(connectionAdmits(undefined, request)).toBe(false)
    expect(connectionAdmits({ admit: () => { throw new Error('missing connection.authentication inject') } }, request)).toBe(false)
  })
})
