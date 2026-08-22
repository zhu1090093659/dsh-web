/**
 * Background state-flow tests: one-shot migration of the skin-background
 * settings section into the v2 state store, plus the ongoing settings-page
 * sync. Style mirrors legacy-bridge.spec.ts (fail-closed, idempotent).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateBackgroundState, syncBackgroundState } from '../src/background-migration.ts'
import { readActiveState } from '../src/active-state.ts'

const CUSTOMIZED = {
  backgroundOpacity: 100,
  backgroundBlurEmpty: 4,
  backgroundBlurContent: 5,
}

let root: string
let statePath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'background-migration-'))
  statePath = join(root, 'skin-center-active.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('migrateBackgroundState (one-shot)', () => {
  it('migrates a customized settings value into an empty state store', () => {
    const result = migrateBackgroundState({ activeStatePath: statePath, source: () => CUSTOMIZED })
    expect(result.migrated).toBe(true)
    expect(result.wrote).toBe(true)
    expect(result.failed).toBe(false)
    const state = readActiveState(statePath)
    expect(state.active).toBeNull()
    expect(state.background).toMatchObject(CUSTOMIZED)
    expect(state.background?.enabled).toBe(true)
    expect(state.background?.inputCardBlur).toBe(10)
  })

  it('is idempotent: the second run writes nothing', () => {
    migrateBackgroundState({ activeStatePath: statePath, source: () => CUSTOMIZED })
    const before = readFileSync(statePath, 'utf8')
    const second = migrateBackgroundState({ activeStatePath: statePath, source: () => CUSTOMIZED })
    expect(second.migrated).toBe(false)
    expect(second.wrote).toBe(false)
    expect(second.failed).toBe(false)
    expect(readFileSync(statePath, 'utf8')).toBe(before)
  })

  it('does not overwrite an existing background section', () => {
    const stored = {
      enabled: true,
      backgroundOpacity: 30,
      backgroundBlurEmpty: 2,
      backgroundBlurContent: 3,
      inputCardBlur: 10,
      bubbleOpacity: 50,
    }
    writeFileSync(statePath, JSON.stringify({ active: 'harbor', background: stored }))
    const result = migrateBackgroundState({ activeStatePath: statePath, source: () => CUSTOMIZED })
    expect(result.migrated).toBe(false)
    const state = readActiveState(statePath)
    expect(state.active).toBe('harbor')
    expect(state.background).toEqual(stored)
  })

  it('skips pristine defaults (steady state stays silent)', () => {
    const result = migrateBackgroundState({
      activeStatePath: statePath,
      source: () => ({ enabled: true, backgroundOpacity: 0, backgroundBlurEmpty: 0, backgroundBlurContent: 0, inputCardBlur: 10, bubbleOpacity: 50 }),
    })
    expect(result.migrated).toBe(false)
    expect(result.wrote).toBe(false)
    expect(result.failed).toBe(false)
    expect(() => readFileSync(statePath, 'utf8')).toThrow()
  })

  it('skips an empty settings section', () => {
    const result = migrateBackgroundState({ activeStatePath: statePath, source: () => ({}) })
    expect(result.migrated).toBe(false)
    expect(() => readFileSync(statePath, 'utf8')).toThrow()
  })

  it('fails closed when the source throws', () => {
    const result = migrateBackgroundState({
      activeStatePath: statePath,
      source: () => { throw new Error('settings down') },
    })
    expect(result.failed).toBe(true)
    expect(result.migrated).toBe(false)
    expect(result.notes.join(' ')).toContain('failed closed')
    expect(() => readFileSync(statePath, 'utf8')).toThrow()
  })
})

describe('syncBackgroundState (ongoing settings-page edits)', () => {
  it('writes a customized value into an empty store', () => {
    const result = syncBackgroundState({ activeStatePath: statePath, source: () => CUSTOMIZED })
    expect(result.wrote).toBe(true)
    expect(readActiveState(statePath).background).toMatchObject(CUSTOMIZED)
  })

  it('keeps writing once the store has a background section, even for defaults', () => {
    writeFileSync(statePath, JSON.stringify({
      active: 'harbor',
      background: { enabled: true, backgroundOpacity: 30, backgroundBlurEmpty: 2, backgroundBlurContent: 3, inputCardBlur: 10, bubbleOpacity: 50 },
    }))
    const result = syncBackgroundState({
      activeStatePath: statePath,
      source: () => ({ enabled: true, backgroundOpacity: 0, backgroundBlurEmpty: 0, backgroundBlurContent: 0, inputCardBlur: 10, bubbleOpacity: 50 }),
    })
    expect(result.wrote).toBe(true)
    expect(readActiveState(statePath).background?.backgroundOpacity).toBe(0)
  })

  it('preserves the active id while syncing', () => {
    writeFileSync(statePath, JSON.stringify({ active: 'harbor', background: null }))
    syncBackgroundState({ activeStatePath: statePath, source: () => CUSTOMIZED })
    const state = readActiveState(statePath)
    expect(state.active).toBe('harbor')
    expect(state.background).toMatchObject(CUSTOMIZED)
  })

  it('skips pristine defaults while the store is still empty (no boot-time write)', () => {
    const result = syncBackgroundState({
      activeStatePath: statePath,
      source: () => ({ enabled: true, backgroundOpacity: 0, backgroundBlurEmpty: 0, backgroundBlurContent: 0, inputCardBlur: 10, bubbleOpacity: 50 }),
    })
    expect(result.wrote).toBe(false)
    expect(() => readFileSync(statePath, 'utf8')).toThrow()
  })

  it('fails closed when the source throws', () => {
    const result = syncBackgroundState({
      activeStatePath: statePath,
      source: () => { throw new Error('settings down') },
    })
    expect(result.failed).toBe(true)
    expect(result.wrote).toBe(false)
  })
})
