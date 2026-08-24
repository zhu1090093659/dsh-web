/**
 * Upgrade-detection helper tests for the What's New section: version
 * comparison, last-seen persistence, and the "has a newer release" decision.
 */
import { describe, expect, it } from 'vitest'
import {
  acknowledgeVersion,
  compareVersions,
  hasNewRelease,
  isNewerVersion,
  readAutoShown,
  readLastSeen,
  readSuppress,
  setAutoShown,
  setSuppress,
  shouldAutoPopup,
  WHATS_NEW_AUTO_SHOWN_KEY,
  WHATS_NEW_LAST_SEEN_KEY,
  WHATS_NEW_SUPPRESS_KEY,
  type StringStorage,
} from '../src/client/whats-new.ts'

/** In-memory storage implementing the injectable StringStorage face. */
interface MemStorage extends StringStorage {
  entries: Map<string, string>
}

function makeStorage(initial: Record<string, string> = {}): MemStorage {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value) },
  }
}

describe('compareVersions', () => {
  it('compares dotted numeric versions', () => {
    expect(compareVersions('0.3.2', '0.3.1')).toBeGreaterThan(0)
    expect(compareVersions('0.3.1', '0.3.2')).toBeLessThan(0)
    expect(compareVersions('0.3.2', '0.3.2')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0)
    expect(compareVersions('1', '1.0.0')).toBe(0)
  })
})

describe('isNewerVersion', () => {
  it('returns true when lastSeen is absent', () => {
    expect(isNewerVersion('0.3.2', undefined)).toBe(true)
    expect(isNewerVersion('0.3.2', '')).toBe(true)
  })

  it('returns false when candidate is not newer', () => {
    expect(isNewerVersion('0.3.2', '0.3.2')).toBe(false)
    expect(isNewerVersion('0.3.1', '0.3.2')).toBe(false)
  })

  it('returns true when candidate is newer', () => {
    expect(isNewerVersion('0.4.0', '0.3.2')).toBe(true)
  })
})

describe('readLastSeen / acknowledgeVersion / hasNewRelease', () => {
  it('reads nothing before any acknowledgement', () => {
    const storage = makeStorage()
    expect(readLastSeen(storage)).toBeUndefined()
    expect(hasNewRelease(storage, '0.3.2')).toBe(true)
  })

  it('advertises a new release only when a newer version exists', () => {
    const storage = makeStorage()
    acknowledgeVersion(storage, '0.3.2')
    expect(hasNewRelease(storage, '0.3.2')).toBe(false)
    expect(hasNewRelease(storage, '0.4.0')).toBe(true)
  })

  it('uses a custom key when provided', () => {
    const storage = makeStorage()
    const key = 'custom:key'
    acknowledgeVersion(storage, '0.3.2', key)
    expect(hasNewRelease(storage, '0.3.2', key)).toBe(false)
    // The default key is unaffected.
    expect(hasNewRelease(storage, '0.3.2')).toBe(true)
  })
})

describe('readAutoShown / setAutoShown / shouldAutoPopup', () => {
  it('reads nothing before any auto-show', () => {
    const storage = makeStorage()
    expect(readAutoShown(storage)).toBeUndefined()
  })

  it('returns the version set by setAutoShown', () => {
    const storage = makeStorage()
    setAutoShown(storage, '0.3.2')
    expect(readAutoShown(storage)).toBe('0.3.2')
  })

  it('shouldAutoPopup returns true when new release exists and not yet auto-shown', () => {
    const storage = makeStorage()
    expect(shouldAutoPopup(storage, '0.3.2')).toBe(true)
  })

  it('shouldAutoPopup returns false when already auto-shown for the same version', () => {
    const storage = makeStorage()
    setAutoShown(storage, '0.3.2')
    expect(shouldAutoPopup(storage, '0.3.2')).toBe(false)
  })

  it('shouldAutoPopup returns false when version was acknowledged (no new release)', () => {
    const storage = makeStorage()
    acknowledgeVersion(storage, '0.3.2')
    expect(shouldAutoPopup(storage, '0.3.2')).toBe(false)
  })

  it('shouldAutoPopup returns false when suppress preference is set', () => {
    const storage = makeStorage()
    setSuppress(storage, true)
    expect(shouldAutoPopup(storage, '0.3.2')).toBe(false)
  })

  it('shouldAutoPopup uses the auto-shown key independently of the last-seen key', () => {
    const storage = makeStorage()
    // Version 0.3.2 acknowledged, but 0.4.0 is installed.
    acknowledgeVersion(storage, '0.3.2')
    expect(shouldAutoPopup(storage, '0.4.0')).toBe(true)
    // Auto-show it.
    setAutoShown(storage, '0.4.0')
    expect(shouldAutoPopup(storage, '0.4.0')).toBe(false)
  })
})

describe('readSuppress / setSuppress', () => {
  it('reads false when no suppress preference is set', () => {
    const storage = makeStorage()
    expect(readSuppress(storage)).toBe(false)
  })

  it('returns true after setSuppress(storage, true)', () => {
    const storage = makeStorage()
    setSuppress(storage, true)
    expect(readSuppress(storage)).toBe(true)
  })

  it('returns false after setSuppress(storage, false) clears the key', () => {
    const storage = makeStorage()
    setSuppress(storage, true)
    setSuppress(storage, false)
    expect(readSuppress(storage)).toBe(false)
  })
})
