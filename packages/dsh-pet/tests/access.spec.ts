/**
 * Pet trust fence: loopback always passes; a live paired-device cookie is an
 * additional allow path when the remote-web-ui service is present.
 */
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { isPetAllowed } from '../src/access.ts'

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

describe('isPetAllowed', () => {
  it('allows loopback without a pairing service', () => {
    expect(isPetAllowed({} as never, request())).toBe(true)
  })

  it('refuses a LAN client when no pairing service is present', () => {
    const ctx = { get: () => undefined }
    expect(isPetAllowed(ctx as never, request({
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
    expect(isPetAllowed(ctx as never, req)).toBe(true)
    expect(isPairedDevice).toHaveBeenCalledWith(req)
  })

  it('refuses a LAN client when pairing returns false (revoked or unknown)', () => {
    const ctx = { get: () => ({ isPairedDevice: () => false }) }
    expect(isPetAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=revoked',
    }))).toBe(false)
  })
})
