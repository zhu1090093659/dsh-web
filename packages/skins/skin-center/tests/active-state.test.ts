import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readActiveState, seedDefaultActiveSkin } from '../src/active-state.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skin-center-seed-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const statePath = () => join(dir, 'skin-center-active.json')

describe('seedDefaultActiveSkin', () => {
  it('seeds the bundled default skin on a fresh (no state file) install', () => {
    const seeded = seedDefaultActiveSkin(statePath(), () => true)
    expect(seeded).toBe(true)
    expect(readActiveState(statePath()).active).toBe('blue-fantasy')
  })

  it('does NOT overwrite an explicit official-default (active: null) selection', () => {
    // The client posts { active: null } when the user applies 官方默认; the
    // host writeActiveState persists it with initialized: true. The seed must
    // treat an existing state file as "user has chosen", never re-seed.
    writeFileSync(statePath(), JSON.stringify({ active: null, initialized: true }) + '\n')
    const seeded = seedDefaultActiveSkin(statePath(), () => true)
    expect(seeded).toBe(false)
    expect(readActiveState(statePath()).active).toBe(null)
  })

  it('does NOT overwrite an existing catalog skin selection', () => {
    writeFileSync(statePath(), JSON.stringify({ active: 'blue-fantasy', initialized: true }) + '\n')
    const seeded = seedDefaultActiveSkin(statePath(), () => true)
    expect(seeded).toBe(false)
    expect(readActiveState(statePath()).active).toBe('blue-fantasy')
  })

  it('does not seed when the default skin is absent from the catalog', () => {
    const seeded = seedDefaultActiveSkin(statePath(), () => false)
    expect(seeded).toBe(false)
    expect(readActiveState(statePath()).active).toBe(null)
  })
})
