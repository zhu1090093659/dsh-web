/**
 * Skill-center trust fence: loopback always passes; a live paired-device cookie
 * is an additional allow path when the remote-web-ui service is present.
 */
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { isSkillExplorerAllowed } from '../src/access.ts'

function request(options: {
  remoteAddress?: string
  host?: string
  cookie?: string
} = {}): IncomingMessage {
  return {
    headers: {
      host: options.host ?? '127.0.0.1:3000',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  } as IncomingMessage
}

describe('isSkillExplorerAllowed', () => {
  it('allows loopback without a pairing service', () => {
    expect(isSkillExplorerAllowed({} as never, request())).toBe(true)
  })

  it('refuses a LAN client when no pairing service is present', () => {
    const ctx = { get: () => undefined }
    expect(isSkillExplorerAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
    }))).toBe(false)
  })

  it('allows a LAN client with a live paired-device cookie', () => {
    const isPairedDevice = vi.fn(() => true)
    const ctx = { get: (name: string) => name === 'remoteWebUiPairing' ? { isPairedDevice } : undefined }
    const req = request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
    })
    expect(isSkillExplorerAllowed(ctx as never, req)).toBe(true)
    expect(isPairedDevice).toHaveBeenCalledWith(req)
  })

  it('refuses a LAN client when pairing returns false (revoked or unknown)', () => {
    const ctx = { get: () => ({ isPairedDevice: () => false }) }
    expect(isSkillExplorerAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=revoked',
    }))).toBe(false)
  })

  it('operator: allows a remote client when the host connection service accepts the request', () => {
    // Given an incoming request through a reverse proxy and an accepting host connection service
    const requestRejection = vi.fn(() => undefined)
    const ctx = { get: (name: string) => name === 'connection' ? { requestRejection } : undefined }
    const req = request({
      remoteAddress: '192.168.15.24',
      host: 'dsh.example.internal',
    })

    // When checking skill-explorer route admission
    const allowed = isSkillExplorerAllowed(ctx as never, req)

    // Then the request is accepted and connection service was queried
    expect(allowed).toBe(true)
    expect(requestRejection).toHaveBeenCalledWith(req)
  })

  it('operator: refuses a remote client when the host connection service rejects the request', () => {
    // Given an incoming request through a reverse proxy and a rejecting host connection service
    const requestRejection = vi.fn(() => 403)
    const ctx = { get: (name: string) => name === 'connection' ? { requestRejection } : undefined }
    const req = request({
      remoteAddress: '192.168.15.24',
      host: 'dsh.example.internal',
    })

    // When checking skill-explorer route admission
    const allowed = isSkillExplorerAllowed(ctx as never, req)

    // Then the request is rejected and connection service was queried
    expect(allowed).toBe(false)
    expect(requestRejection).toHaveBeenCalledWith(req)
  })

  it('operator: falls back to the loopback and pairing fence when connection lookup throws or is incomplete', () => {
    // Given a context whose connection lookup throws for an un-injected service
    const throwingCtx = {
      get: (name: string) => {
        if (name === 'connection') throw new Error('service unavailable')
        return undefined
      },
    }
    const remoteReq = request({
      remoteAddress: '192.168.15.24',
      host: 'dsh.example.internal',
    })

    // When checking admission for a remote request vs a direct loopback request
    const remoteAllowed = isSkillExplorerAllowed(throwingCtx as never, remoteReq)
    const loopbackAllowed = isSkillExplorerAllowed(throwingCtx as never, request())

    // Then the remote request is refused while the direct loopback request stays admitted
    expect(remoteAllowed).toBe(false)
    expect(loopbackAllowed).toBe(true)
  })
})
