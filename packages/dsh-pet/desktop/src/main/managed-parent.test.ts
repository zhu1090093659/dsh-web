import { describe, expect, it } from 'vitest'

import {
  managedParentAction,
  managedParentActionFromData,
  managedParentFromData,
  managedParentNativeToken,
  managedParentNativeTokenFromData,
  managedParentOrigin,
  managedParentOriginFromData,
  managedParentPid,
  managedParentRegistrationKey,
  managedParentSourceId,
  managedParentSourceIdFromData,
} from './managed-parent.ts'

describe('managed desktop parent argument', () => {
  it('accepts a distinct positive Harness process id', () => {
    expect(managedParentPid(['electron', '--dsh-parent-pid=4200'], 100)).toBe(4200)
  })

  it('rejects malformed, unsafe and self-referential ids', () => {
    expect(managedParentPid(['--dsh-parent-pid=abc'], 100)).toBeUndefined()
    expect(managedParentPid(['--dsh-parent-pid=-1'], 100)).toBeUndefined()
    expect(managedParentPid(['--dsh-parent-pid=100'], 100)).toBeUndefined()
  })

  it('validates Electron single-instance metadata as untrusted input', () => {
    expect(managedParentFromData({ dshParentPid: 4200 }, 100)).toBe(4200)
    expect(managedParentFromData({ dshParentPid: '4200' }, 100)).toBeUndefined()
    expect(managedParentFromData(null, 100)).toBeUndefined()
  })

  it('accepts only the explicit remove lifecycle action', () => {
    expect(managedParentAction(['--dsh-parent-action=remove'])).toBe('remove')
    expect(managedParentAction(['--dsh-parent-action=unknown'])).toBe('add')
    expect(managedParentActionFromData({ dshParentAction: 'remove' })).toBe('remove')
    expect(managedParentActionFromData({ dshParentAction: 'unknown' })).toBe('add')
  })

  it('keeps multiple plugin sources in one Host process distinct', () => {
    expect(managedParentSourceId(['--dsh-source-id=web-ui-all:pet'])).toBe('web-ui-all:pet')
    expect(managedParentSourceIdFromData({ dshSourceId: 'standalone.pet' })).toBe('standalone.pet')
    expect(managedParentSourceId(['--dsh-source-id=../unsafe'])).toBeUndefined()
    expect(managedParentSourceIdFromData({ dshSourceId: 1 })).toBeUndefined()
    expect(managedParentRegistrationKey(4200, 'direct')).not.toBe(
      managedParentRegistrationKey(4200, 'aggregate'),
    )
    expect(managedParentRegistrationKey(4200)).toBe('4200:legacy:4200')
  })

  it('accepts only loopback DSH origins from arguments and instance metadata', () => {
    expect(managedParentOrigin(['--dsh-origin=http://localhost:3180/'])).toBe('http://localhost:3180')
    expect(managedParentOrigin(['--dsh-origin=https://example.com'])).toBeUndefined()
    expect(managedParentOriginFromData({ dshOrigin: 'http://127.0.0.1:3180' })).toBe('http://127.0.0.1:3180')
    expect(managedParentOriginFromData({ dshOrigin: 3180 })).toBeUndefined()
  })

  it('accepts only a 256-bit base64url native token from private metadata', () => {
    const token = 'a'.repeat(43)
    expect(managedParentNativeToken(token)).toBe(token)
    expect(managedParentNativeToken('short')).toBeUndefined()
    expect(managedParentNativeToken(`${'a'.repeat(42)}+`)).toBeUndefined()
    expect(managedParentNativeTokenFromData({ dshNativeToken: token })).toBe(token)
    expect(managedParentNativeTokenFromData({ dshNativeToken: 1 })).toBeUndefined()
  })
})
