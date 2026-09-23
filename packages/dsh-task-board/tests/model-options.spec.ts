import { describe, expect, it } from 'vitest'
import { inject } from '../src/client/index.ts'

describe('task-board client inject', () => {
  it('declares remote.session in inject to avoid Cordis proxy property access refusal', () => {
    expect(inject).toContain('remote')
    expect(inject).toContain('remote.session')
  })
})
