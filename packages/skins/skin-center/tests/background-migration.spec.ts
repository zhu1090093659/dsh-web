/**
 * Background-migration tests (issue #996): the one-shot copy of a customized
 * legacy skin-background settings section into the v2 active-state document.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateBackgroundFromSettings } from '../src/background-migration.ts'
import { readActiveState, writeActiveState } from '../src/active-state.ts'

let dir: string
let statePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'background-migration-'))
  statePath = join(dir, 'skin-center-active.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('migrateBackgroundFromSettings', () => {
  it('copies a customized legacy section into an empty state document', () => {
    const result = migrateBackgroundFromSettings({
      activeStatePath: statePath,
      readSettings: () => ({ backgroundOpacity: 100, backgroundBlurEmpty: 4, backgroundBlurContent: 5 }),
    })
    expect(result.migrated).toBe(true)
    expect(readActiveState(statePath).background).toEqual({
      backgroundOpacity: 100,
      backgroundBlurEmpty: 4,
      backgroundBlurContent: 5,
    })
  })

  it('preserves an existing active selection while migrating', () => {
    writeActiveState(statePath, { active: 'harbor' })
    const result = migrateBackgroundFromSettings({
      activeStatePath: statePath,
      readSettings: () => ({ backgroundOpacity: 80 }),
    })
    expect(result.migrated).toBe(true)
    expect(readActiveState(statePath)).toEqual({ active: 'harbor', background: { backgroundOpacity: 80 }, initialized: true })
  })

  it('skips when the state document already carries a background section', () => {
    writeActiveState(statePath, { background: { backgroundOpacity: 60 } })
    const result = migrateBackgroundFromSettings({
      activeStatePath: statePath,
      readSettings: () => ({ backgroundOpacity: 100 }),
    })
    expect(result.migrated).toBe(false)
    expect(readActiveState(statePath).background).toEqual({ backgroundOpacity: 60 })
  })

  it('skips a never-customized section (resolved schema defaults)', () => {
    const result = migrateBackgroundFromSettings({
      activeStatePath: statePath,
      readSettings: () => ({
        enabled: true,
        backgroundOpacity: 0,
        backgroundBlurEmpty: 0,
        backgroundBlurContent: 0,
        inputCardBlur: 10,
        bubbleOpacity: 50,
      }),
    })
    expect(result.migrated).toBe(false)
    // The state document stays clean: no background key materialized.
    expect(readActiveState(statePath).background).toBeNull()
  })

  it('normalizes legacy data: clamps ranges and drops unknown keys', () => {
    const result = migrateBackgroundFromSettings({
      activeStatePath: statePath,
      readSettings: () => ({ backgroundOpacity: 140, bogus: 'x' }),
    })
    expect(result.migrated).toBe(true)
    expect(readActiveState(statePath).background).toEqual({ backgroundOpacity: 100 })
  })

  it('fails closed without throwing when the state path is unwritable', () => {
    const result = migrateBackgroundFromSettings({
      activeStatePath: join(dir, 'missing-parent', '..', 'x', '\0'),
      readSettings: () => ({ backgroundOpacity: 100 }),
    })
    expect(result.migrated).toBe(false)
    expect(result.notes.length).toBeGreaterThan(0)
  })
})
