/**
 * Release-notes data integrity: the source the What's New section renders must
 * be internally consistent — the current version matches the newest entry, each
 * highlight carries a known kind and refs, and every category list is a plain
 * string array.
 */
import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION, RELEASES, type ReleaseChange, type ReleaseEntry } from '../src/client/release-notes.ts'

describe('release-notes data', () => {
  it('ships at least one release', () => {
    expect(RELEASES.length).toBeGreaterThanOrEqual(1)
  })

  it('CURRENT_VERSION matches the newest entry', () => {
    const [latest] = RELEASES
    expect(latest).toBeDefined()
    expect(CURRENT_VERSION).toBe(latest.version)
  })

  it('orders releases newest first', () => {
    for (let i = 1; i < RELEASES.length; i += 1) {
      expect(RELEASES[i - 1].version >= RELEASES[i].version).toBe(true)
    }
  })

  it('every highlight carries a known kind and string refs', () => {
    const kinds = new Set(['new', 'improved', 'fixed'])
    for (const release of RELEASES) {
      for (const highlight of release.highlights) {
        expect(kinds.has(highlight.kind)).toBe(true)
        expect(highlight.title).toBeTruthy()
        expect(highlight.desc).toBeTruthy()
        expect(Array.isArray(highlight.refs ?? [])).toBe(true)
        for (const ref of highlight.refs ?? []) expect(typeof ref).toBe('string')
      }
    }
  })

  it('every section bucket is a string array', () => {
    for (const release of RELEASES) {
      for (const key of ['new', 'improved', 'fixed'] as const) {
        expect(Array.isArray(release.sections[key])).toBe(true)
        for (const item of release.sections[key]) expect(typeof item).toBe('string')
      }
    }
  })

  it('the latest release has a lede and date', () => {
    const [latest] = RELEASES
    expect(latest.lede).toBeTruthy()
    expect(/^\d{4}-\d{2}-\d{2}$/.test(latest.date)).toBe(true)
  })
})
