import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FRAME_COUNTS,
  DEFAULT_PET_CELL,
  codexPetsDir,
  loadPetRegistry,
  resolvePetManifest,
} from './registry.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-registry-'))
}

describe('resolvePetManifest', () => {
  it('resolves a bare Codex manifest onto the hatch-pet contract defaults', () => {
    const entry = resolvePetManifest({
      id: 'otter',
      displayName: '水獭',
      spritesheetPath: 'spritesheet.webp',
    }, join(tmpdir(), 'otter'))
    expect(entry).toBeDefined()
    expect(entry!.id).toBe('otter')
    expect(entry!.cell).toEqual(DEFAULT_PET_CELL)
    expect(entry!.columns).toBe(8)
    expect(entry!.rows).toEqual([...DEFAULT_FRAME_COUNTS])
    expect(entry!.atlasUrl).toBe('/pet/otter/spritesheet.webp')
    expect(entry!.manifestUrl).toBe('/pet/otter/pet.json')
    // Every track's frames/durations line up with its row count.
    expect(entry!.tracks.idle.frames.length).toBe(entry!.rows[0])
    expect(entry!.tracks.idle.durations.length).toBe(entry!.rows[0])
    expect(entry!.tracks.jumping.loop).toBe(false)
    expect(entry!.tracks.jumping.fallback).toBe('idle')
    expect(entry!.tracks.failed.loop).toBe(false)
    expect(entry!.tracks.running.loop).toBe(true)
  })

  it('keeps the legacy whale-girl frame counts and its own durations', () => {
    const entry = resolvePetManifest({
      id: 'whale-girl',
      displayName: '鲸鱼娘',
      spritesheetPath: 'spritesheet.webp',
      frames: [6, 8, 8, 4, 5, 8, 6, 6, 6],
      tracks: { idle: { durations: [400, 400, 500, 400, 400, 500] } },
    }, join(tmpdir(), 'whale'))
    expect(entry!.rows).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6])
    expect(entry!.tracks.idle.durations).toEqual([400, 400, 500, 400, 400, 500])
    // Non-overridden tracks keep the contract rhythm.
    expect(entry!.tracks['running-right'].durations.length).toBe(8)
  })

  it('exposes safe skin atlas URLs alongside the default atlas', () => {
    const entry = resolvePetManifest({
      id: 'whale-girl',
      displayName: '鲸鱼娘',
      spritesheetPath: 'spritesheet.webp',
      skins: {
        refined: 'skins/refined/spritesheet.webp',
        original: 'skins/original/spritesheet.webp',
      },
    }, join(tmpdir(), 'whale'))
    expect(entry!.skinUrls).toEqual({
      refined: '/pet/whale-girl/skins/refined/spritesheet.webp',
      original: '/pet/whale-girl/skins/original/spritesheet.webp',
    })
  })

  it('cycles short override durations up to the row frame count', () => {
    const entry = resolvePetManifest({
      id: 'fox',
      displayName: '狐狸',
      spritesheetPath: 'atlas.png',
      frames: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      tracks: { idle: { durations: [200, 300] } },
    }, join(tmpdir(), 'fox'))
    expect(entry!.tracks.idle.durations).toEqual([200, 300, 200, 300])
    expect(entry!.tracks.idle.frames).toEqual([0, 1, 2, 3])
  })

  it('rejects unsafe ids and spritesheet paths with warnings', () => {
    const warnings: string[] = []
    expect(resolvePetManifest({ id: 'Bad Id', displayName: 'x', spritesheetPath: 'a.webp' }, '/tmp', { warnings })).toBeUndefined()
    expect(resolvePetManifest({ id: 'ok', displayName: 'x', spritesheetPath: '../etc/passwd' }, '/tmp', { warnings })).toBeUndefined()
    expect(resolvePetManifest({ id: 'ok', displayName: 'x', spritesheetPath: '/absolute.webp' }, '/tmp', { warnings })).toBeUndefined()
    expect(warnings.length).toBe(3)
  })
})

describe('loadPetRegistry', () => {
  it('scans built-in assets, the custom pets dir, and composed extras with precedence', () => {
    const root = tempDir()
    try {
      const assets = join(root, 'assets')
      mkdirSync(join(assets, 'whale'), { recursive: true })
      writeFileSync(join(assets, 'whale', 'pet.json'), JSON.stringify({
        id: 'whale-girl', displayName: '鲸鱼娘', spritesheetPath: 'spritesheet.webp',
      }), 'utf8')
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'otter'), { recursive: true })
      writeFileSync(join(petsDir, 'otter', 'pet.json'), JSON.stringify({
        id: 'otter', displayName: '水獭', spritesheetPath: 'spritesheet.webp',
      }), 'utf8')
      // A broken manifest is skipped with a warning, never thrown.
      mkdirSync(join(petsDir, 'broken'), { recursive: true })
      writeFileSync(join(petsDir, 'broken', 'pet.json'), '{ not json', 'utf8')

      const registry = loadPetRegistry({ packageRoot: root, petsDir })
      expect(registry.entries.map(entry => entry.id)).toEqual(['whale-girl', 'otter'])
      expect(registry.defaultEntry().id).toBe('whale-girl')
      expect(registry.warnings.some(warning => warning.includes('broken'))).toBe(true)

      // A composed extra with the same id overrides the earlier sources.
      const overridden = loadPetRegistry({
        packageRoot: root,
        petsDir,
        extra: [{ id: 'whale-girl', displayName: '替换鲸', spritesheetPath: 'spritesheet.webp' }],
      })
      expect(overridden.byId('whale-girl')!.displayName).toBe('替换鲸')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('defaults to the built-in pet even when custom pets sort first', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'aardvark'), { recursive: true })
      writeFileSync(join(petsDir, 'aardvark', 'pet.json'), JSON.stringify({
        id: 'aardvark', displayName: '土豚', spritesheetPath: 'spritesheet.webp',
      }), 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'no-assets'), petsDir })
      expect(registry.defaultEntry().id).toBe('aardvark')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('codexPetsDir', () => {
  it('honors CODEX_HOME and expands a leading tilde', () => {
    expect(codexPetsDir({ CODEX_HOME: '/opt/codex' }, '/home/user')).toBe('/opt/codex/pets')
    expect(codexPetsDir({ CODEX_HOME: '~/codex' }, '/home/user')).toBe('/home/user/codex/pets')
    expect(codexPetsDir({}, '/home/user')).toBe('/home/user/.codex/pets')
  })
})
