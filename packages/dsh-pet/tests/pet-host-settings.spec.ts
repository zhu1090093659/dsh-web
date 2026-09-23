/**
 * Host-half settings lifecycle for the 0.1.7 cohort. A plugin's settings ARE
 * its own Cordis Config now: the pet row serves its page from `Config`, the
 * Host commits an edit into the RUNNING config reference, and the row is not
 * remounted for it. These tests mount the real plugin on a context that
 * records the web-server routes and the settings page policy, then drive that
 * commit the way the Loader announces it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Volatile, type VolatileSnapshot } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { apply } from '../src/index.ts'
import { loadPetPersist } from '../src/persist.ts'
import { resolvePetManifest, type PetRegistry } from '../src/registry.ts'

/** A live config reference the test can drive, as the Host commits into it. */
type LiveRef<T> = Volatile<T> & { set(value: T): void }

/** Stand-in for the Host's live config reference: a settings edit commits here. */
function liveRef<T extends string | number | boolean>(initial: T): LiveRef<T> {
  let value = initial
  return {
    get: () => value as unknown as VolatileSnapshot<T>,
    set: (next: T) => { value = next },
  }
}

/** Two pets, so a selection can actually change. */
function fixtureRegistry(): PetRegistry {
  const warnings: string[] = []
  const whale = resolvePetManifest({
    id: 'whale-girl',
    displayName: '鲸鱼娘',
    spritesheetPath: 'spritesheet.webp',
  }, join(tmpdir(), 'whale'), { warnings })
  const otter = resolvePetManifest({
    id: 'otter',
    displayName: '水獭',
    spritesheetPath: 'spritesheet.webp',
  }, join(tmpdir(), 'otter'), { warnings })
  const entries = [whale!, otter!]
  return {
    entries,
    warnings,
    diagnostics: [],
    byId: id => entries.find(entry => entry.id === id),
    defaultEntry: () => entries[0]!,
  }
}

let home: string
let ctx: Context
/** Paths the pet currently serves through the web server. */
const served = new Set<string>()
const pagePolicies: Array<{ auto?: boolean }> = []
const size: LiveRef<number> = liveRef<number>(160)
const right: LiveRef<number> = liveRef<number>(24)
const bottom: LiveRef<number> = liveRef<number>(20)
const petId: LiveRef<string> = liveRef<string>('whale-girl')
const enabled: LiveRef<boolean> = liveRef<boolean>(true)

beforeAll(() => {
  home = join(mkdtempSync(join(tmpdir(), 'dsh-pet-host-config-')), 'home')
  ctx = new Context()
  ctx.provide('webServer', {
    register: (route: { path: string }) => {
      served.add(route.path)
      return () => { served.delete(route.path) }
    },
  } as unknown as Context['webServer'])
  ctx.provide('settings', {
    configure: (presentation: { auto?: boolean }) => {
      pagePolicies.push(presentation)
      return () => {}
    },
  } as unknown as Context['settings'])
  apply(ctx, {
    persistDir: home,
    registry: fixtureRegistry(),
    visible: liveRef(true),
    size,
    right,
    bottom,
    bubbleScale: liveRef(1),
    petId,
    enabled,
    decorationEnabled: liveRef(true),
  })
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

/** Announce a committed settings edit the way the Loader does. */
function commitSettings(): void {
  ctx.emit('loader/volatile-update', [])
}

describe('pet row configuration lifecycle', () => {
  it('operator gets the pet API routes while the entry leaves the plugin enabled', () => {
    // Given a mounted row whose own config leaves the plugin enabled
    // When the Host serves the pet
    // Then the pet's own JSON endpoints answer
    expect([...served]).toContain('/api/pet/state')
  })

  it('operator sees no auto-generated settings page for the entry that ships its own card', async () => {
    // Given the pet renders its own settings card in the browser half
    // When the Host resolves the page policy for this entry
    await Promise.resolve()
    // Then the automatic page is switched off
    expect(pagePolicies).toContainEqual({ auto: false })
  })

  it('user moves the pet in the settings page and the pet adopts the new layout', () => {
    // Given a settings edit the Host committed into the running config
    size.set(240)
    right.set(48)
    bottom.set(80)
    // When the Loader announces the volatile commit
    commitSettings()
    // Then the pet runs with the edited layout and has persisted it
    expect(loadPetPersist(home).display).toMatchObject({ size: 240, right: 48, bottom: 80 })
  })

  it('user switches the pet in the settings page and the pet serves the new selection', () => {
    // Given a committed pet selection
    petId.set('otter')
    // When the Loader announces the volatile commit
    commitSettings()
    // Then the pet serves that selection
    expect(loadPetPersist(home).petId).toBe('otter')
  })

  it('user turns the pet off in the settings page and the pet API stops serving', () => {
    // Given a committed config that switches the plugin off
    enabled.set(false)
    // When the Loader announces the volatile commit
    commitSettings()
    // Then the routes are withdrawn
    expect([...served]).toEqual([])

    // And the next edit brings them back for an enabled plugin
    enabled.set(true)
    commitSettings()
    expect([...served]).toContain('/api/pet/state')
  })
})
