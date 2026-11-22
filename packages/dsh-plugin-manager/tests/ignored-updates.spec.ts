/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import type { PluginUpdateItem } from '../src/core/protocol.ts'
import { isUpdateIgnored } from '../src/core/updates.ts'
import {
  forgetIgnoredUpdate,
  IGNORED_UPDATES_STORAGE_KEY,
  loadIgnoredUpdates,
  rememberIgnoredUpdate,
  saveIgnoredUpdates,
} from '../src/client/ignored-updates.ts'

const item: PluginUpdateItem = { id: 'dsh-a', current: '0.0.1', latest: '0.0.2' }
const other: PluginUpdateItem = { id: 'dsh-b', current: '1.0.0', latest: '1.1.0' }

afterEach(() => { localStorage.clear() })

describe('exact-version ignored updates', () => {
  it('user persists one offer without hiding another plugin or a newer version', () => {
    // Given two available plugin updates
    // When only A 0.0.2 is ignored
    const ignored = rememberIgnoredUpdate([], item)
    // Then exactly that offer matches and the browser stores the same list
    expect(ignored).toEqual([{ id: 'dsh-a', version: '0.0.2' }])
    expect(loadIgnoredUpdates()).toEqual(ignored)
    expect(isUpdateIgnored(item, ignored)).toBe(true)
    expect(isUpdateIgnored(other, ignored)).toBe(false)
    expect(isUpdateIgnored({ ...item, latest: '0.0.3' }, ignored)).toBe(false)
  })

  it('user restores only the selected exact-version rule', () => {
    // Given two independently ignored versions
    const ignored = rememberIgnoredUpdate(rememberIgnoredUpdate([], item), other)
    // When A is restored
    const restored = forgetIgnoredUpdate(ignored, item)
    // Then B stays ignored and storage agrees
    expect(restored).toEqual([{ id: 'dsh-b', version: '1.1.0' }])
    expect(loadIgnoredUpdates()).toEqual(restored)
  })

  it('user loads only valid unique rules from malformed stored data', () => {
    // Given stored duplicates, malformed entries and broken JSON
    localStorage.setItem(IGNORED_UPDATES_STORAGE_KEY, JSON.stringify([
      { id: 'dsh-a', version: '0.0.2' },
      { id: 'dsh-a', version: '0.0.2' },
      { id: 'dsh-b', version: 3 },
      null,
    ]))
    // When the stored list is read
    // Then only the first valid occurrence remains
    expect(loadIgnoredUpdates()).toEqual([{ id: 'dsh-a', version: '0.0.2' }])
    localStorage.setItem(IGNORED_UPDATES_STORAGE_KEY, '{broken')
    expect(loadIgnoredUpdates()).toEqual([])
  })

  it('user keeps session-local behavior when storage cannot be read or written', () => {
    // Given a browser whose storage refuses reads and writes
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') },
    }
    // When rules are loaded and saved
    // Then both operations degrade without throwing or inventing persisted state
    expect(loadIgnoredUpdates(broken)).toEqual([])
    expect(() => { saveIgnoredUpdates([{ id: 'dsh-a', version: '0.0.2' }], broken) }).not.toThrow()
    expect(loadIgnoredUpdates(undefined)).toEqual([])
  })
})
