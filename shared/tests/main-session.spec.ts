import { describe, expect, it } from 'vitest'
import { mainViewSessionId } from '../client/main-session.ts'

describe('mainViewSessionId', () => {
  it('returns the row the main view owns', () => {
    const byId = {
      'session-a': { id: 'session-a', retainedBy: { gateway: 1 } },
      'session-b': { id: 'session-b', retainedBy: { mainView: 1 } },
    }
    expect(mainViewSessionId(byId)).toBe('session-b')
  })

  it('ignores rows owned only by other sources', () => {
    const byId = {
      'session-a': { id: 'session-a', retainedBy: { mainView: 0, gateway: 3 } },
      'session-b': { id: 'session-b', retainedBy: { sidebarChat: 2 } },
    }
    expect(mainViewSessionId(byId)).toBeUndefined()
  })

  it('treats a missing ownership record as unowned', () => {
    expect(mainViewSessionId({ 'session-a': { id: 'session-a' } })).toBeUndefined()
  })

  it('returns undefined for an absent or null catalog', () => {
    expect(mainViewSessionId(undefined)).toBeUndefined()
    expect(mainViewSessionId(null)).toBeUndefined()
  })

  it('skips undefined catalog slots without throwing', () => {
    expect(mainViewSessionId({ 'session-a': undefined, 'session-b': { id: 'session-b', retainedBy: { mainView: 1 } } }))
      .toBe('session-b')
  })
})
