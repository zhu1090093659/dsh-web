import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  authorizePetNativeRequest,
  createPetNativeToken,
  isPetNativeToken,
} from '../src/adapters/web/native-auth.ts'
import { PET_ERROR_CODES } from '../src/errors.ts'

function request(address: string | undefined, authorization?: string): IncomingMessage {
  return {
    headers: { ...(authorization === undefined ? {} : { authorization }) },
    socket: { remoteAddress: address },
  } as unknown as IncomingMessage
}

describe('native bridge authentication', () => {
  it('generates independent 256-bit base64url credentials', () => {
    const first = createPetNativeToken()
    const second = createPetNativeToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
    expect(isPetNativeToken(first)).toBe(true)
    expect(isPetNativeToken('short')).toBe(false)
  })

  it('requires both a loopback peer and the exact bearer token', () => {
    const token = createPetNativeToken()
    expect(authorizePetNativeRequest(request('::1', `Bearer ${token}`), token)).toBeUndefined()
    expect(authorizePetNativeRequest(request('127.0.0.2', `Bearer ${token}`), token)).toBeUndefined()
    expect(authorizePetNativeRequest(request('::1'), token)).toBe(PET_ERROR_CODES.nativeAuthRequired)
    expect(authorizePetNativeRequest(request('::1', 'Bearer wrong'), token))
      .toBe(PET_ERROR_CODES.nativeAuthInvalid)
    expect(authorizePetNativeRequest(request('10.0.0.2', `Bearer ${token}`), token))
      .toBe(PET_ERROR_CODES.nativeLoopbackRequired)
  })
})
