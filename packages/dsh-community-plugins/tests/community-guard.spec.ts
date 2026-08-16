import { describe, expect, it } from 'vitest'
import { isCommunityPluginEntry } from '../src/client/community-guard.ts'
import { COMMUNITY_PLUGINS } from '../src/client/generated/community.ts'

describe('isCommunityPluginEntry', () => {
  it('accepts every generated registry entry', () => {
    for (const entry of COMMUNITY_PLUGINS) {
      expect(isCommunityPluginEntry(entry)).toBe(true)
    }
  })

  it('accepts a minimal well-formed entry', () => {
    expect(isCommunityPluginEntry({
      id: 'x', name: 'X', nameEn: 'X', author: 'someone', repo: 'https://github.com/someone/x',
    })).toBe(true)
  })

  it('rejects malformed entries', () => {
    expect(isCommunityPluginEntry(null)).toBe(false)
    expect(isCommunityPluginEntry({ id: 'x' })).toBe(false)
    expect(isCommunityPluginEntry({ id: 'x', name: 'X', nameEn: 'X', author: '', repo: 'https://github.com/a/b' })).toBe(false)
    expect(isCommunityPluginEntry({ id: 'x', name: 'X', nameEn: 'X', author: 'a', repo: 'not-a-url' })).toBe(false)
    expect(isCommunityPluginEntry({ id: 'x', name: 'X', nameEn: 'X', author: 'a', repo: 'https://github.com/a/b', npm: 42 })).toBe(false)
  })
})
