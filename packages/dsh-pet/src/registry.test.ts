import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FRAME_COUNTS,
  DEFAULT_PET_CELL,
  codexPetsDir,
  loadPetRegistry,
  petAtlasFile,
  petPackageRoot,
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
    expect(entry!.atlasRows).toBe(9)
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

  it('marks v2 (spriteVersionNumber 2) atlases with 11 rows', () => {
    const entry = resolvePetManifest({
      id: 'firefly',
      displayName: 'Firefly',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
    }, join(tmpdir(), 'firefly'))
    expect(entry).toBeDefined()
    // v2 atlases carry 11 rows: the 9 animation rows plus 2 look rows.
    expect(entry!.atlasRows).toBe(11)
    // The 9 animation rows still resolve the hatch-pet contract.
    expect(entry!.rows).toEqual([...DEFAULT_FRAME_COUNTS])
    expect(entry!.tracks.idle.frames.length).toBe(entry!.rows[0])
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

  it('normalizes valid per-scene animation sequences', () => {
    const entry = resolvePetManifest({
      id: 'whale-girl',
      displayName: '鲸鱼娘',
      spritesheetPath: 'spritesheet.webp',
      sequences: {
        thinking: ['running', 'running-right', 'running', 'running-left', 'waiting'],
      },
    }, join(tmpdir(), 'whale'))
    expect(entry!.sequences).toEqual({
      thinking: ['running', 'running-right', 'running', 'running-left', 'waiting'],
    })
  })

  it('drops invalid or undersized per-scene animation sequences', () => {
    const warnings: string[] = []
    const entry = resolvePetManifest({
      id: 'whale-girl',
      displayName: '鲸鱼娘',
      spritesheetPath: 'spritesheet.webp',
      sequences: {
        waiting: ['waiting', 'idle'],
        thinking: ['running', 'bogus', 'running', 'running-left', 'waiting'],
      },
    }, join(tmpdir(), 'whale'), { warnings })
    expect(entry!.sequences).toBeUndefined()
    expect(warnings).toContain('manifest whale-girl: sequence waiting must contain at least 5 animations')
    expect(warnings).toContain('manifest whale-girl: sequence thinking contains unknown animation "bogus"')
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

  it('normalizes a manifest remarks block into per-pet pools', () => {
    const entry = resolvePetManifest({
      id: 'otter',
      displayName: '水獭',
      spritesheetPath: 'spritesheet.webp',
      remarks: {
        pet: '摸摸水獭的头',
        feed: ['小鱼干真香', ' 再来一条 '],
      },
    }, join(tmpdir(), 'otter'))
    expect(entry!.remarks).toEqual({ pet: ['摸摸水獭的头'], feed: ['小鱼干真香', '再来一条'] })
  })

  it('warns on malformed remarks slots but keeps the pet', () => {
    const warnings: string[] = []
    const entry = resolvePetManifest({
      id: 'fox',
      displayName: '狐狸',
      spritesheetPath: 'spritesheet.webp',
      remarks: { unknownSlot: ['x'], pet: [1, null] },
    }, join(tmpdir(), 'fox'), { warnings })
    expect(entry).toBeDefined()
    expect(entry!.remarks).toBeUndefined()
    expect(warnings.some(message => message.includes('unknown remarks slot'))).toBe(true)
    expect(warnings.some(message => message.includes('no usable lines'))).toBe(true)
  })
})

describe('loadPetRegistry', () => {
  it('ships the original and refined whale variants plus bobo while keeping the original default', () => {
    const registry = loadPetRegistry({
      packageRoot: petPackageRoot(import.meta.url),
      petsDir: '',
    })

    expect(registry.entries.map(entry => entry.id)).toEqual([
      'bobo',
      'whale-girl',
      'whale-girl-refined',
    ])
    expect(registry.byId('bobo')?.displayName).toBe('啵啵')
    expect(registry.byId('bobo')?.atlasRows).toBe(11)
    expect(existsSync(petAtlasFile(registry.byId('bobo')!))).toBe(true)
    expect(registry.byId('whale-girl')?.displayName).toBe('鲸鱼娘（原版）')
    expect(registry.byId('whale-girl-refined')?.displayName).toBe('鲸鱼娘（精致版）')
    expect(existsSync(petAtlasFile(registry.byId('whale-girl-refined')!))).toBe(true)
    expect(readFileSync(petAtlasFile(registry.byId('whale-girl')!)).equals(
      readFileSync(petAtlasFile(registry.byId('whale-girl-refined')!)),
    )).toBe(false)
    expect(registry.defaultEntry().id).toBe('whale-girl')
  })

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

  it('resolves a composed extra atlas to the real file (no doubled directory)', () => {
    const root = tempDir()
    try {
      // The atlas sits at <root>/pets/otter/spritesheet.webp.
      mkdirSync(join(root, 'pets', 'otter'), { recursive: true })
      writeFileSync(join(root, 'pets', 'otter', 'spritesheet.webp'), 'png', 'utf8')

      const registry = loadPetRegistry({
        packageRoot: root,
        petsDir: '',
        extra: [{ id: 'otter', displayName: '水獭', spritesheetPath: 'pets/otter/spritesheet.webp' }],
      })
      const entry = registry.byId('otter')
      expect(entry).toBeDefined()
      // dir is the spritesheet's parent; the stored path is its basename, so
      // joining them resolves to the real file instead of applying the
      // directory twice.
      expect(entry!.dir).toBe(join(root, 'pets', 'otter'))
      expect(entry!.spritesheetPath).toBe('spritesheet.webp')
      const atlas = petAtlasFile(entry!)
      expect(atlas).toBe(join(root, 'pets', 'otter', 'spritesheet.webp'))
      expect(existsSync(atlas)).toBe(true)
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
    // Expected values join through the platform separator (POSIX on CI).
    expect(codexPetsDir({ CODEX_HOME: '/opt/codex' }, '/home/user')).toBe(join('/opt/codex', 'pets'))
    expect(codexPetsDir({ CODEX_HOME: '~/codex' }, '/home/user')).toBe(join('/home/user', 'codex', 'pets'))
    expect(codexPetsDir({}, '/home/user')).toBe(join('/home/user', '.codex', 'pets'))
  })
})
