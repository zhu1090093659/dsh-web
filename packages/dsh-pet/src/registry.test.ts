import { describe, expect, it } from 'vitest'
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FRAME_COUNTS,
  DEFAULT_PET_CELL,
  DEFAULT_TRACK_PATTERNS,
  PET_ROW_ORDER,
  PET_SCAN_JSON_CAP,
  PET_SCAN_LIVE2D_MODEL_CAP,
  codexPetsDir,
  loadPetRegistry,
  petAtlasFile,
  petEntryView,
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

describe('loadPetRegistry frames2d', () => {
  /** Write a frames2d pet fixture: pet.json + thumb/<track>/<frame> files. */
  function writeFrames2dPet(root: string, id: string, manifest: Record<string, unknown>, files: Record<string, string[]>): string {
    const dir = join(root, 'assets', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({
      petManifestVersion: 2,
      id,
      displayName: id,
      license: 'MIT',
      renderer: 'frames2d',
      ...manifest,
    }), 'utf8')
    for (const [trackDir, frames] of Object.entries(files)) {
      mkdirSync(join(dir, trackDir), { recursive: true })
      for (const frame of frames) writeFileSync(join(dir, trackDir, frame), 'webp', 'utf8')
    }
    return dir
  }

  it('resolves directory-listed tracks with filename-encoded durations', () => {
    const root = tempDir()
    try {
      writeFrames2dPet(root, 'miku', {
        frames2d: {
          dir: 'thumb',
          tracks: { idle: { loop: true }, happy: { loop: false } },
          phases: { idle: 'idle', done: 'happy' },
        },
      }, {
        'thumb/idle': ['miku_1_200.webp', 'miku_2_260.webp'],
        'thumb/happy': ['miku-happy_1_300.webp'],
      })
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const entry = registry.byId('miku')
      expect(entry?.renderer).toBe('frames2d')
      expect(entry?.frames2d?.phases).toEqual({ idle: 'idle', done: 'happy' })
      expect(entry?.frames2d?.tracks.idle).toMatchObject({ loop: true, durations: [200, 260] })
      expect(entry?.frames2d?.tracks.idle?.frames).toEqual([
        '/pet/miku/thumb/idle/miku_1_200.webp',
        '/pet/miku/thumb/idle/miku_2_260.webp',
      ])
      expect(entry?.frames2d?.tracks.happy).toMatchObject({ loop: false, fallback: 'idle', durations: [300] })
      expect([...(entry?.servable ?? [])].sort()).toEqual([
        'thumb/happy/miku-happy_1_300.webp',
        'thumb/idle/miku_1_200.webp',
        'thumb/idle/miku_2_260.webp',
      ])
      expect(entry?.atlasUrl).toBe('/pet/miku/thumb/idle/miku_1_200.webp')
      // The browser view carries the frames2d block.
      const view = petEntryView(entry!)
      expect(view.frames2d?.tracks.idle?.frames).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('orders directory-scanned frames by their trailing index (10+ frames)', () => {
    const root = tempDir()
    try {
      const names = Array.from({ length: 12 }, (_, index) => 'miku-pet-eat' + String(index + 1) + '.webp')
      writeFrames2dPet(root, 'miku', {
        frames2d: { dir: 'thumb', tracks: { eat: { loop: false } }, phases: { idle: 'eat' } },
      }, { 'thumb/eat': names })
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const frames = registry.byId('miku')?.frames2d?.tracks.eat?.frames ?? []
      expect(frames).toHaveLength(12)
      expect(frames[1]).toBe('/pet/miku/thumb/eat/miku-pet-eat2.webp')
      expect(frames[9]).toBe('/pet/miku/thumb/eat/miku-pet-eat10.webp')
      expect(frames[11]).toBe('/pet/miku/thumb/eat/miku-pet-eat12.webp')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('honours explicit frames order and frameMs over filename-encoded durations', () => {
    const root = tempDir()
    try {
      writeFrames2dPet(root, 'fox', {
        frames2d: {
          dir: 'thumb',
          tracks: { idle: { frames: ['b_100.webp', 'a_100.webp'], frameMs: [111, 222], loop: true } },
          phases: { idle: 'idle' },
        },
      }, { 'thumb/idle': ['a_100.webp', 'b_100.webp'] })
      const entry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' }).byId('fox')
      expect(entry?.frames2d?.tracks.idle?.frames).toEqual([
        '/pet/fox/thumb/idle/b_100.webp',
        '/pet/fox/thumb/idle/a_100.webp',
      ])
      expect(entry?.frames2d?.tracks.idle?.durations).toEqual([111, 222])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('drops an empty track and remaps its phases to idle with a warning', () => {
    const root = tempDir()
    try {
      writeFrames2dPet(root, 'miku', {
        frames2d: {
          dir: 'thumb',
          tracks: { idle: {}, work: {} },
          phases: { idle: 'idle', thinking: 'work' },
        },
      }, { 'thumb/idle': ['miku_1_200.webp'] })
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const entry = registry.byId('miku')
      expect(entry?.frames2d?.tracks.work).toBeUndefined()
      expect(entry?.frames2d?.phases.thinking).toBe('idle')
      expect(registry.warnings.some(warning => warning.includes('work'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects the entry fail-closed when the idle track has no frames on disk', () => {
    const root = tempDir()
    try {
      writeFrames2dPet(root, 'miku', {
        frames2d: {
          dir: 'thumb',
          tracks: { idle: {}, happy: {} },
          phases: { idle: 'idle', done: 'happy' },
        },
      }, { 'thumb/happy': ['miku_1_200.webp'] })
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      expect(registry.byId('miku')).toBeUndefined()
      expect(registry.diagnostics.some(d => d.level === 'error' && d.message.includes('idle'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('warns and skips a missing explicit frame', () => {
    const root = tempDir()
    try {
      writeFrames2dPet(root, 'miku', {
        frames2d: {
          dir: 'thumb',
          tracks: { idle: { frames: ['a_100.webp', 'gone_100.webp'] } },
          phases: { idle: 'idle' },
        },
      }, { 'thumb/idle': ['a_100.webp'] })
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const entry = registry.byId('miku')
      expect(entry?.frames2d?.tracks.idle?.frames).toEqual(['/pet/miku/thumb/idle/a_100.webp'])
      expect(registry.warnings.some(warning => warning.includes('gone_100.webp'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('loadPetRegistry', () => {
  it('ships every built-in pet while keeping the original whale as default', () => {
    const registry = loadPetRegistry({
      packageRoot: petPackageRoot(import.meta.url),
      petsDir: '',
      dshPetsDir: '',
    })

    // The repo checkout also resolves miku (frames2d gameplay pet) and
    // starry-doll (community sprite2d pet) from assets/; the npm files
    // whitelist excludes them (Workshop delivery), so npm installs see the
    // three atlas pets until a Workshop install lands them under
    // $DSH_HOME/pets.
    expect(registry.entries.map(entry => entry.id)).toEqual([
      'miku',
      'ouo-neko',
      'starry-doll',
      'whale-girl',
      'whale-girl-refined',
    ])
    expect(registry.byId('ouo-neko')).toMatchObject({
      displayName: 'OUO Neko',
      atlasRows: 11,
      columns: 8,
      rows: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    })
    expect(existsSync(petAtlasFile(registry.byId('ouo-neko')!))).toBe(true)
    expect(registry.byId('starry-doll')).toMatchObject({
      displayName: '星夜人偶',
      atlasRows: 9,
      columns: 8,
      rows: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    })
    expect(existsSync(petAtlasFile(registry.byId('starry-doll')!))).toBe(true)
    expect(registry.byId('whale-girl')?.displayName).toBe('鲸鱼娘（原版）')
    expect(registry.byId('whale-girl-refined')?.displayName).toBe('鲸鱼娘（精致版）')
    expect(existsSync(petAtlasFile(registry.byId('whale-girl-refined')!))).toBe(true)
    expect(readFileSync(petAtlasFile(registry.byId('whale-girl')!)).equals(
      readFileSync(petAtlasFile(registry.byId('whale-girl-refined')!)),
    )).toBe(false)
    expect(registry.defaultEntry().id).toBe('whale-girl')
    // Both built-in whales and every override-free pet share the one slow
    // global rhythm (user request: all pets were too fast at the legacy
    // hatch-pet contract pace).
    for (const track of PET_ROW_ORDER) {
      expect(registry.byId('whale-girl')!.tracks[track].durations)
        .toEqual(DEFAULT_TRACK_PATTERNS[track].durations)
      expect(registry.byId('whale-girl-refined')!.tracks[track].durations)
        .toEqual(DEFAULT_TRACK_PATTERNS[track].durations)
    }
    expect(DEFAULT_TRACK_PATTERNS.idle.durations[0]!).toBeGreaterThanOrEqual(500)
    expect(DEFAULT_TRACK_PATTERNS['running-right'].durations[0]!).toBeGreaterThanOrEqual(300)
    expect(DEFAULT_TRACK_PATTERNS.waving.durations[0]!).toBeGreaterThanOrEqual(450)
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

      const registry = loadPetRegistry({ packageRoot: root, petsDir, dshPetsDir: '' })
      expect(registry.entries.map(entry => entry.id)).toEqual(['whale-girl', 'otter'])
      expect(registry.defaultEntry().id).toBe('whale-girl')
      expect(registry.warnings.some(warning => warning.includes('broken'))).toBe(true)

      // A composed extra with the same id overrides the earlier sources.
      const overridden = loadPetRegistry({
        packageRoot: root,
        petsDir,
        dshPetsDir: '',
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
        dshPetsDir: '',
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
      const registry = loadPetRegistry({ packageRoot: join(root, 'no-assets'), petsDir, dshPetsDir: '' })
      expect(registry.defaultEntry().id).toBe('aardvark')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips an oversized pet.json with a warning instead of reading it', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'loud'), { recursive: true })
      writeFileSync(join(petsDir, 'loud', 'pet.json'), '{ ' + 'x'.repeat(PET_SCAN_JSON_CAP) + ' }', 'utf8')
      // A healthy neighbor keeps listing while the pathological one is skipped.
      mkdirSync(join(petsDir, 'plain'), { recursive: true })
      writeFileSync(join(petsDir, 'plain', 'pet.json'), JSON.stringify({
        id: 'plain', displayName: 'Plain', spritesheetPath: 'spritesheet.webp',
      }), 'utf8')
      writeFileSync(join(petsDir, 'plain', 'spritesheet.webp'), 'webp', 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('loud')).toBeUndefined()
      expect(registry.byId('plain')).toBeDefined()
      expect(registry.warnings.some(w => w.includes('scan ceiling'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a non-regular pet.json with a warning', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'odd', 'pet.json'), { recursive: true })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.entries.map(entry => entry.id)).toEqual([])
      expect(registry.warnings.some(w => w.includes('not a regular file'))).toBe(true)
      expect(registry.diagnostics.some(d => d.level === 'warning' && d.message.includes('pet manifest is not a regular file'))).toBe(true)
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

describe('loadPetRegistry pet-center v2 (issue #623)', () => {
  function writePet(dir: string, name: string, manifest: Record<string, unknown>): void {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'pet.json'), JSON.stringify(manifest), 'utf8')
    writeFileSync(join(dir, name, 'spritesheet.webp'), 'webp', 'utf8')
  }

  it('resolves a v2 sprite2d pet with the same geometry as its v1 twin', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      writePet(petsDir, 'v1pet', { id: 'twin-v1', displayName: 'Twin V1', frames: [1, 2, 3, 4, 5, 6, 7, 8, 9] })
      writePet(petsDir, 'v2pet', {
        petManifestVersion: 2, id: 'twin-v2', displayName: 'Twin V2', license: 'CC0-1.0',
        renderer: 'sprite2d', sprite2d: { spritesheetPath: 'spritesheet.webp', frames: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      const v1 = registry.byId('twin-v1')!
      const v2 = registry.byId('twin-v2')!
      expect(v2.rows).toEqual(v1.rows)
      expect(v2.tracks.idle.durations).toEqual(v1.tracks.idle.durations)
      expect(registry.diagnostics.some(d => d.message.includes('v1 compat read'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('round-trips atlasRows 11 through the v1 compat resolver', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      writePet(petsDir, 'looky', {
        petManifestVersion: 2, id: 'looky', displayName: 'Looky', license: 'CC0-1.0',
        renderer: 'sprite2d', sprite2d: { spritesheetPath: 'spritesheet.webp', atlasRows: 11 },
      })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('looky')?.atlasRows).toBe(11)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects atlasRows values the v1 compat resolver cannot express', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      writePet(petsDir, 'odd', {
        petManifestVersion: 2, id: 'odd', displayName: 'Odd', license: 'CC0-1.0',
        renderer: 'sprite2d', sprite2d: { spritesheetPath: 'spritesheet.webp', atlasRows: 7 },
      })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('odd')).toBeUndefined()
      expect(registry.diagnostics.some(d => d.level === 'error' && d.message.includes('atlasRows'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists live2d pets with the render block and the servable closure (M3)', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'haru', 'motions'), { recursive: true })
      mkdirSync(join(petsDir, 'haru', 'textures'), { recursive: true })
      writeFileSync(join(petsDir, 'haru', 'pet.json'), JSON.stringify({
        petManifestVersion: 2, id: 'haru', displayName: 'Haru', license: 'Live2D-Sample',
        renderer: 'live2d',
        live2d: {
          model: 'haru.model3.json',
          scale: 1.2,
          motions: { idle: 'Idle', thinking: 'TapBody' },
          hitAreas: ['Head'],
        },
      }), 'utf8')
      writeFileSync(join(petsDir, 'haru', 'haru.model3.json'), JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: 'haru.moc3',
          Textures: ['textures/texture_00.png'],
          Motions: { Idle: [{ File: 'motions/idle_00.motion3.json' }] },
        },
        HitAreas: [{ Name: 'Head', Id: 'HitAreaHead' }],
      }), 'utf8')
      writeFileSync(join(petsDir, 'haru', 'haru.moc3'), 'moc', 'utf8')
      writeFileSync(join(petsDir, 'haru', 'textures', 'texture_00.png'), 'png', 'utf8')
      writeFileSync(join(petsDir, 'haru', 'motions', 'idle_00.motion3.json'), '{}', 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      const entry = registry.byId('haru')
      expect(entry).toBeDefined()
      expect(entry!.renderer).toBe('live2d')
      expect(entry!.live2d).toBeDefined()
      expect(entry!.live2d!.modelUrl).toBe('/pet/haru/haru.model3.json')
      expect(entry!.live2d!.modelPath).toBe('haru.model3.json')
      expect(entry!.live2d!.scale).toBe(1.2)
      expect(entry!.live2d!.motions).toEqual({ idle: 'Idle', thinking: 'TapBody' })
      expect(entry!.live2d!.hitAreas).toEqual(['Head'])
      // The servable closure covers the model plus every referenced file.
      expect(entry!.servable).toEqual([
        'haru.model3.json', 'haru.moc3', 'motions/idle_00.motion3.json', 'textures/texture_00.png',
      ])
      // Sprite fields carry harmless contract defaults (chrome sizing only).
      expect(entry!.cell).toEqual(DEFAULT_PET_CELL)
      expect(entry!.rows).toEqual([...DEFAULT_FRAME_COUNTS])
      expect(entry!.tracks.idle.frames.length).toBe(entry!.rows[0])
      // The client-visible view keeps the live2d block, drops host paths.
      const view = petEntryView(entry!)
      expect(view.live2d!.modelPath).toBe('haru.model3.json')
      expect('servable' in view).toBe(false)
      expect('dir' in view).toBe(false)
      // A healthy live2d entry records no diagnostics.
      expect(registry.diagnostics.filter(d => d.message.includes('haru'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects live2d pets whose model3.json is unreadable', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      writePet(petsDir, 'haru', {
        petManifestVersion: 2, id: 'haru', displayName: 'Haru', license: 'Live2D-Sample',
        renderer: 'live2d', live2d: { model: 'haru.model3.json', motions: { idle: 'Idle' } },
      })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('haru')).toBeUndefined()
      expect(registry.diagnostics.some(d => d.level === 'error' && d.message.includes('not readable'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects live2d pets whose model3.json declares unsafe references', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'haru'), { recursive: true })
      writeFileSync(join(petsDir, 'haru', 'pet.json'), JSON.stringify({
        petManifestVersion: 2, id: 'haru', displayName: 'Haru', license: 'Live2D-Sample',
        renderer: 'live2d', live2d: { model: 'haru.model3.json', motions: { idle: 'Idle' } },
      }), 'utf8')
      writeFileSync(join(petsDir, 'haru', 'haru.model3.json'), JSON.stringify({
        Version: 3,
        FileReferences: { Moc: '../escape.moc3' },
      }), 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('haru')).toBeUndefined()
      expect(registry.diagnostics.some(d => d.level === 'error' && d.message.includes('not a safe relative path'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('warns on closure files missing on disk but keeps the live2d pet listed', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'haru'), { recursive: true })
      writeFileSync(join(petsDir, 'haru', 'pet.json'), JSON.stringify({
        petManifestVersion: 2, id: 'haru', displayName: 'Haru', license: 'Live2D-Sample',
        renderer: 'live2d', live2d: { model: 'haru.model3.json', motions: { idle: 'Idle' } },
      }), 'utf8')
      writeFileSync(join(petsDir, 'haru', 'haru.model3.json'), JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'haru.moc3', Textures: ['missing.png'] },
      }), 'utf8')
      writeFileSync(join(petsDir, 'haru', 'haru.moc3'), 'moc', 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('haru')).toBeDefined()
      expect(registry.diagnostics.some(d => d.level === 'warning' && d.message.includes('closure file missing: missing.png'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed on v2 manifests with unknown fields', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      writePet(petsDir, 'surprise', {
        petManifestVersion: 2, id: 'surprise', displayName: 'S', license: 'CC0-1.0',
        renderer: 'sprite2d', sprite2d: { spritesheetPath: 'spritesheet.webp' }, sneaky: true,
      })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('surprise')).toBeUndefined()
      expect(registry.diagnostics.some(d => d.level === 'error' && d.message.includes('sneaky'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ranks the DSH_HOME pets source above the legacy codex source', () => {
    const root = tempDir()
    try {
      const legacy = join(root, 'legacy')
      const dsh = join(root, 'dsh')
      writePet(legacy, 'cat', { id: 'cat', displayName: 'Legacy Cat' })
      writePet(dsh, 'cat', { id: 'cat', displayName: 'Home Cat' })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir: legacy, dshPetsDir: dsh })
      expect(registry.byId('cat')?.displayName).toBe('Home Cat')
      // '' disables the source entirely.
      const disabled = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir: '', dshPetsDir: dsh })
      expect(disabled.entries.map(e => e.id)).toEqual(['cat'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a live2d pet whose model3.json exceeds the model scan ceiling with a warning', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'haru'), { recursive: true })
      writeFileSync(join(petsDir, 'haru', 'pet.json'), JSON.stringify({
        petManifestVersion: 2, id: 'haru', displayName: 'Haru', license: 'Live2D-Sample',
        renderer: 'live2d', live2d: { model: 'haru.model3.json', motions: { idle: 'Idle' } },
      }), 'utf8')
      // A sparse file one byte past the ceiling: stat reports the size
      // without materializing 32 MB of bytes on disk.
      const fd = openSync(join(petsDir, 'haru', 'haru.model3.json'), 'w')
      try {
        ftruncateSync(fd, PET_SCAN_LIVE2D_MODEL_CAP + 1)
      } finally {
        closeSync(fd)
      }
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('haru')).toBeUndefined()
      expect(registry.warnings.some(w => w.includes('scan ceiling'))).toBe(true)
      expect(registry.diagnostics.some(d => d.level === 'warning'
        && d.message.includes('exceeds the ' + PET_SCAN_LIVE2D_MODEL_CAP + '-byte scan ceiling'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a live2d pet whose model3.json is not a regular file with a warning', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'haru', 'haru.model3.json'), { recursive: true })
      writeFileSync(join(petsDir, 'haru', 'pet.json'), JSON.stringify({
        petManifestVersion: 2, id: 'haru', displayName: 'Haru', license: 'Live2D-Sample',
        renderer: 'live2d', live2d: { model: 'haru.model3.json', motions: { idle: 'Idle' } },
      }), 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('haru')).toBeUndefined()
      expect(registry.warnings.some(w => w.includes('not a regular file'))).toBe(true)
      expect(registry.diagnostics.some(d => d.level === 'warning'
        && d.message.includes('live2d model haru.model3.json is not a regular file'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('voice packs (pet-center M4, issue #677)', () => {
  function writeVoice(dir: string, name: string, pack: unknown): void {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'pet.json'), JSON.stringify({ id: name, displayName: name, spritesheetPath: 'spritesheet.webp' }), 'utf8')
    writeFileSync(join(dir, name, 'spritesheet.webp'), 'webp', 'utf8')
    writeFileSync(join(dir, name, 'voice.json'), JSON.stringify(pack), 'utf8')
  }

  it('loads a pet voice.json and serves its panel slice to the browser view', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      writeVoice(petsDir, 'talker', {
        status: { done: ['自定义完工'] },
        panel: { labels: { feed: '投喂' }, stats: { rank: '好感 {rank}' }, actions: ['feed'] },
      })
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      const entry = registry.byId('talker')!
      expect(entry.voice?.overrides.status?.done).toEqual(['自定义完工'])
      const view = petEntryView(entry)
      expect(view.panel).toEqual({
        labels: { feed: '投喂' },
        stats: { rank: '好感 {rank}' },
        actions: ['feed'],
      })
      // Host-only voice content never reaches the browser half.
      expect('voice' in view).toBe(false)
      // A healthy voice pack records no diagnostics of its own.
      expect(registry.diagnostics.filter(d => d.message.includes('voice'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('warns and drops a broken voice.json without rejecting the pet', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'mumbler'), { recursive: true })
      writeFileSync(join(petsDir, 'mumbler', 'pet.json'), JSON.stringify({ id: 'mumbler', displayName: 'Mumbler', spritesheetPath: 'spritesheet.webp' }), 'utf8')
      writeFileSync(join(petsDir, 'mumbler', 'spritesheet.webp'), 'webp', 'utf8')
      writeFileSync(join(petsDir, 'mumbler', 'voice.json'), '{ not json', 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('mumbler')).toBeDefined()
      expect(registry.byId('mumbler')!.voice).toBeUndefined()
      expect(registry.diagnostics.some(d => d.level === 'warning' && d.message.includes('voice pack is not valid JSON'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads the global .voice.json override from the DSH_HOME pets dir', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'plain'), { recursive: true })
      writeFileSync(join(petsDir, 'plain', 'pet.json'), JSON.stringify({ id: 'plain', displayName: 'Plain', spritesheetPath: 'spritesheet.webp' }), 'utf8')
      writeFileSync(join(petsDir, 'plain', 'spritesheet.webp'), 'webp', 'utf8')
      writeFileSync(join(petsDir, '.voice.json'), JSON.stringify({
        status: { done: ['全局完工'] },
        panel: { labels: { hide: '全局藏' } },
      }), 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: petsDir })
      expect(registry.globalVoice?.overrides.status?.done).toEqual(['全局完工'])
      expect(registry.globalVoice?.panel?.labels).toEqual({ hide: '全局藏' })
      // The dotfile itself is never scanned as a pet directory.
      expect(registry.entries.map(e => e.id)).toEqual(['plain'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('serves the merged panel chrome (per-pet over global, per slot)', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'plain'), { recursive: true })
      writeFileSync(join(petsDir, 'plain', 'pet.json'), JSON.stringify({ id: 'plain', displayName: 'Plain', spritesheetPath: 'spritesheet.webp' }), 'utf8')
      writeFileSync(join(petsDir, 'plain', 'spritesheet.webp'), 'webp', 'utf8')
      writeFileSync(join(petsDir, 'plain', 'voice.json'), JSON.stringify({
        panel: { labels: { feed: '宠物投喂' }, stats: { treats: '宠物鱼干 {n}' } },
      }), 'utf8')
      writeFileSync(join(petsDir, '.voice.json'), JSON.stringify({
        panel: { labels: { feed: '全局投喂', hide: '全局藏' } },
      }), 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: petsDir })
      const entry = registry.byId('plain')
      expect(entry).toBeDefined()
      const view = petEntryView(entry!, registry.globalVoice)
      // The pet's own slot wins; untouched global slots layer underneath.
      expect(view.panel?.labels).toEqual({ feed: '宠物投喂', hide: '全局藏' })
      expect(view.panel?.stats?.treats).toBe('宠物鱼干 {n}')
      // A pack-less pet would receive the global panel as-is.
      const bare = resolvePetManifest({ id: 'bare', displayName: 'Bare', spritesheetPath: 'spritesheet.webp' }, join(tmpdir(), 'bare'))
      expect(petEntryView(bare!, registry.globalVoice).panel?.labels).toEqual({ feed: '全局投喂', hide: '全局藏' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips an oversized voice.json with a warning instead of reading it', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'loud'), { recursive: true })
      writeFileSync(join(petsDir, 'loud', 'pet.json'), JSON.stringify({ id: 'loud', displayName: 'Loud', spritesheetPath: 'spritesheet.webp' }), 'utf8')
      writeFileSync(join(petsDir, 'loud', 'voice.json'), '{ ' + 'x'.repeat(PET_SCAN_JSON_CAP) + ' }', 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('loud')!.voice).toBeUndefined()
      expect(registry.warnings.some(w => w.includes('scan ceiling'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a non-regular voice.json with a warning', () => {
    const root = tempDir()
    try {
      const petsDir = join(root, 'pets')
      mkdirSync(join(petsDir, 'odd', 'voice.json'), { recursive: true })
      writeFileSync(join(petsDir, 'odd', 'pet.json'), JSON.stringify({ id: 'odd', displayName: 'Odd', spritesheetPath: 'spritesheet.webp' }), 'utf8')
      const registry = loadPetRegistry({ packageRoot: join(root, 'none'), petsDir, dshPetsDir: '' })
      expect(registry.byId('odd')!.voice).toBeUndefined()
      expect(registry.warnings.some(w => w.includes('not a regular file'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
describe('status decorations (pet-center M5, #567)', () => {
  /** A minimal valid PNG header (signature + IHDR) with the given size. */
  function pngHeader(width: number, height: number): Buffer {
    const buf = Buffer.alloc(26)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(13, 8)      // IHDR chunk length
    buf.write('IHDR', 12)         // chunk type
    buf.writeUInt32BE(width, 16)  // width
    buf.writeUInt32BE(height, 20) // height
    return buf
  }

  /** A strip whose pixel geometry matches baseManifest() (64x48 cell, 4 cols). */
  function matchingStrip(): Buffer {
    return pngHeader(64 * 4, 48)
  }

  function writeDecoration(dir: string, name: string, manifest: Record<string, unknown>, strip: Buffer | string = 'whale-frames.png'): void {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'decoration.json'), JSON.stringify(manifest), 'utf8')
    writeFileSync(join(dir, name, manifest.entry as string), strip)
  }

  const baseManifest = () => ({
    decorationManifestVersion: 1,
    id: 'whale',
    displayName: '喷水鲸鱼',
    license: 'MIT',
    entry: 'whale-frames.png',
    cell: { width: 64, height: 48 },
    columns: 4,
    phases: { idle: 'hide', thinking: { from: 0, to: 3 } },
  })

  it('scans built-in decorations and exposes the browser view fields', () => {
    const root = tempDir()
    try {
      const assets = join(root, 'assets')
      writeDecoration(join(assets, 'decorations'), 'whale', baseManifest(), matchingStrip())
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const entry = registry.decorationById?.('whale')
      expect(entry).toBeDefined()
      expect(entry!.entryUrl).toBe('/api/pet/decoration/whale/whale-frames.png')
      expect(entry!.servable).toEqual(['decoration.json', 'whale-frames.png'])
      expect(entry!.phases.thinking).toEqual({ from: 0, to: 3 })
      // The pet entries list is untouched by decorations.
      expect(registry.entries).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lets a user decoration override the built-in by id', () => {
    const root = tempDir()
    try {
      writeDecoration(join(root, 'assets', 'decorations'), 'whale', baseManifest(), matchingStrip())
      const dsh = join(root, 'dsh')
      writeDecoration(join(dsh, 'decorations'), 'whale', { ...baseManifest(), displayName: '家用鲸鱼' }, matchingStrip())
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: dsh })
      expect(registry.decorationById?.('whale')?.id).toBe('whale')
      expect(registry.warnings.some(w => w.includes('user decoration whale overrides'))).toBe(true)
      expect(registry.decorationById?.('whale')?.entryUrl).toBe('/api/pet/decoration/whale/whale-frames.png')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('warns and skips a broken descriptor without disturbing pets', () => {
    const root = tempDir()
    try {
      mkdirSync(join(root, 'assets', 'decorations', 'broken'), { recursive: true })
      writeFileSync(join(root, 'assets', 'decorations', 'broken', 'decoration.json'), '{ not json', 'utf8')
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      expect(registry.decorations).toEqual([])
      expect(registry.diagnostics.some(d => d.level === 'error' && d.message.includes('broken'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips an oversized decoration.json with a warning instead of reading it', () => {
    const root = tempDir()
    try {
      mkdirSync(join(root, 'assets', 'decorations', 'huge'), { recursive: true })
      writeFileSync(join(root, 'assets', 'decorations', 'huge', 'decoration.json'), '{ ' + 'x'.repeat(PET_SCAN_JSON_CAP) + ' }', 'utf8')
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      expect(registry.decorations).toEqual([])
      expect(registry.warnings.some(w => w.includes('scan ceiling'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists a decoration with a missing strip and warns about the file', () => {
    const root = tempDir()
    try {
      const dir = join(root, 'assets', 'decorations', 'ghost')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'decoration.json'), JSON.stringify(baseManifest()), 'utf8')
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      // The entry id comes from the descriptor (the directory name is free).
      expect(registry.decorationById?.('whale')).toBeDefined()
      expect(registry.warnings.some(w => w.includes('strip file missing'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('warns and keeps a decoration whose strip geometry mismatches the descriptor', () => {
    const root = tempDir()
    try {
      // Declared 64x48 cell x 4 columns = 256x48; the file is only 128x48
      // (2 frames worth) — the client would silently render half the frames.
      const dir = join(root, 'assets', 'decorations', 'short')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'decoration.json'), JSON.stringify(baseManifest()), 'utf8')
      writeFileSync(join(dir, 'whale-frames.png'), pngHeader(128, 48))
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      // Warn-and-keep: the entry still lists (mirroring the missing-strip
      // discipline) and the warning names the mismatch.
      expect(registry.decorationById?.('whale')).toBeDefined()
      expect(registry.warnings.some(w => w.includes('does not match cell'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not warn when a matching strip is undecodable (non-image bytes)', () => {
    const root = tempDir()
    try {
      const dir = join(root, 'assets', 'decorations', 'opaque')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'decoration.json'), JSON.stringify(baseManifest()), 'utf8')
      // Unrecognized bytes: the header reader returns undefined, so the scan
      // stays silent (cannot verify != mismatch). Only the missing-file check
      // applies.
      writeFileSync(join(dir, 'whale-frames.png'), Buffer.from('not-an-image'))
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      expect(registry.decorationById?.('whale')).toBeDefined()
      expect(registry.warnings.some(w => w.includes('does not match cell'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
