import { mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readActiveSelection, readActiveState, writeActiveSelection, writeActiveState } from '../src/active-state.ts'

const { originalRename } = vi.hoisted(() => ({
  originalRename: { impl: null as unknown as typeof renameSync },
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  originalRename.impl = actual.renameSync
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const renameMock = vi.mocked(renameSync)

describe('active-state persistence (issue #678: atomic write)', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'active-state-'))
    path = join(dir, 'skin-center-active.json')
    renameMock.mockReset()
    renameMock.mockImplementation(originalRename.impl)
  })

  it('writes a valid JSON document and reads it back', () => {
    writeActiveSelection(path, 'skin-a')
    expect(readActiveSelection(path)).toBe('skin-a')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ active: 'skin-a', background: null })
  })

  it('persists null (stock look)', () => {
    writeActiveSelection(path, null)
    expect(readActiveSelection(path)).toBeNull()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ active: null, background: null })
  })

  it('creates the parent directory on demand', () => {
    const nested = join(dir, 'a', 'b', 'active.json')
    writeActiveSelection(nested, 'skin-a')
    expect(readActiveSelection(nested)).toBe('skin-a')
  })

  it('leaves no temp directories behind after a successful write', () => {
    writeActiveSelection(path, 'skin-a')
    expect(readdirSync(dir)).toEqual(['skin-center-active.json'])
  })

  it('keeps the previous content when the rename fails mid-write', () => {
    writeActiveSelection(path, 'skin-a')
    expect(readActiveSelection(path)).toBe('skin-a')
    renameMock.mockImplementationOnce(() => {
      throw new Error('simulated crash')
    })
    expect(() => writeActiveSelection(path, 'skin-b')).toThrow('simulated crash')
    // The half-written temp file must never replace the previous document.
    expect(readActiveSelection(path)).toBe('skin-a')
    expect(readFileSync(path, 'utf8')).toContain('"skin-a"')
    // The failed attempt must clean up its temp directory.
    expect(readdirSync(dir)).toEqual(['skin-center-active.json'])
  })
})

describe('active-state background section (v2 channel persistence)', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'active-state-bg-'))
    path = join(dir, 'skin-center-active.json')
  })

  const BACKGROUND = {
    enabled: true,
    backgroundOpacity: 100,
    backgroundBlurEmpty: 4,
    backgroundBlurContent: 5,
    inputCardBlur: 10,
    bubbleOpacity: 50,
  }

  it('roundtrips the full state document (active + background)', () => {
    writeActiveState(path, 'harbor', BACKGROUND)
    const state = readActiveState(path)
    expect(state.active).toBe('harbor')
    expect(state.background).toEqual(BACKGROUND)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ active: 'harbor', background: BACKGROUND })
  })

  it('reads the legacy active-only format with a null background', () => {
    writeFileSync(path, JSON.stringify({ active: 'harbor' }))
    const state = readActiveState(path)
    expect(state.active).toBe('harbor')
    expect(state.background).toBeNull()
  })

  it('reads an invalid background section back as null (fail-closed)', () => {
    writeFileSync(path, JSON.stringify({ active: 'harbor', background: { backgroundOpacity: 'x' } }))
    const state = readActiveState(path)
    expect(state.active).toBe('harbor')
    expect(state.background).toBeNull()
  })

  it('clamps out-of-range numbers on read', () => {
    writeFileSync(path, JSON.stringify({ active: 'harbor', background: { backgroundOpacity: 250 } }))
    const state = readActiveState(path)
    expect(state.background?.backgroundOpacity).toBe(100)
  })

  it('preserves the stored background when only the active id is written (merge)', () => {
    writeActiveState(path, 'harbor', BACKGROUND)
    writeActiveSelection(path, 'whale-song')
    const state = readActiveState(path)
    expect(state.active).toBe('whale-song')
    expect(state.background).toEqual(BACKGROUND)
  })

  it('explicit null clears the stored background', () => {
    writeActiveState(path, 'harbor', BACKGROUND)
    writeActiveState(path, 'harbor', null)
    const state = readActiveState(path)
    expect(state.active).toBe('harbor')
    expect(state.background).toBeNull()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ active: 'harbor', background: null })
  })

  it('returns nulls for a missing or unreadable file', () => {
    const state = readActiveState(path)
    expect(state).toEqual({ active: null, background: null })
  })
})
