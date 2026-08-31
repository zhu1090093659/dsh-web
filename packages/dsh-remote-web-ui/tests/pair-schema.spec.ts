/** /api/pair payload schema contracts: only paired requests leave valid types. */
import { describe, expect, it } from 'vitest'
import { acceptPayloadSchema, issuePayloadSchema, pairActionPayloadSchema } from '../src/routes.ts'

describe('/api/pair payload schemas', () => {
  it('issue: the optional address is accepted; unknown keys are stripped', () => {
    expect(issuePayloadSchema.safeParse({}).success).toBe(true)
    expect(issuePayloadSchema.safeParse({ address: '10.0.0.3' }).success).toBe(true)
    expect(issuePayloadSchema.parse({ workspaceId: 'ws-7', address: '10.0.0.3' })).toEqual({ address: '10.0.0.3' })
    expect(issuePayloadSchema.parse({ workspaceId: 'ws-7' })).toEqual({})
  })

  it('issue: rejects non-string targets instead of silently dropping them', () => {
    expect(issuePayloadSchema.safeParse({ address: 42 }).success).toBe(false)
    expect(issuePayloadSchema.safeParse({ address: null }).success).toBe(false)
  })

  it('accept: requires a string token and defaults a missing token to an empty string', () => {
    expect(acceptPayloadSchema.safeParse({ token: 'abc' }).success).toBe(true)
    expect(acceptPayloadSchema.parse({ token: 'abc' })).toEqual({ token: 'abc' })
    expect(acceptPayloadSchema.parse({})).toEqual({ token: '' })
    expect(acceptPayloadSchema.safeParse({ token: 7 }).success).toBe(false)
  })

  it('control-plane endpoints accept any body via the permissive action schema', () => {
    expect(pairActionPayloadSchema.safeParse({}).success).toBe(true)
    expect(pairActionPayloadSchema.safeParse({ anything: true }).success).toBe(true)
  })
})
