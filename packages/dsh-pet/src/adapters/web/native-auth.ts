/** Authentication boundary for the loopback-only native desktop bridge. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { PET_ERROR_CODES, type PetErrorCode } from '../../errors.ts'
import { isLoopbackAddress } from '../../loopback.ts'

export const PET_NATIVE_TOKEN_BYTES = 32
const PET_NATIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type PetNativeAuthFailure = Extract<PetErrorCode,
  | 'NATIVE_LOOPBACK_REQUIRED'
  | 'NATIVE_AUTH_REQUIRED'
  | 'NATIVE_AUTH_INVALID'
>

/** Generate one 256-bit credential for the lifetime of one Host plugin boot. */
export function createPetNativeToken(): string {
  return randomBytes(PET_NATIVE_TOKEN_BYTES).toString('base64url')
}

export function isPetNativeToken(value: unknown): value is string {
  return typeof value === 'string' && PET_NATIVE_TOKEN_PATTERN.test(value)
}

function bearerToken(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return undefined
  const token = authorization.slice('Bearer '.length)
  return token === '' ? undefined : token
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes)
}

/** Return a stable denial code, or undefined when a native request is allowed. */
export function authorizePetNativeRequest(
  req: IncomingMessage,
  expectedToken: string,
): PetNativeAuthFailure | undefined {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return PET_ERROR_CODES.nativeLoopbackRequired
  if (req.headers.authorization === undefined) return PET_ERROR_CODES.nativeAuthRequired
  const actualToken = bearerToken(req)
  if (actualToken === undefined || !secureEqual(actualToken, expectedToken)) {
    return PET_ERROR_CODES.nativeAuthInvalid
  }
  return undefined
}
