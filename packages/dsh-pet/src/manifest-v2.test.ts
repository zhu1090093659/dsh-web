import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KNOWN_LIVE2D,
  KNOWN_SPRITE2D,
  KNOWN_TOP_LEVEL,
  PET_MANIFEST_V2,
  PET_RENDERER_KINDS,
  parsePetManifest,
  safeManifestPath,
} from './manifest-v2.ts'
import { petPackageRoot } from './registry.ts'

/** Minimal valid v2 sprite2d manifest. */
function v2Sprite(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    petManifestVersion: 2,
    id: 'harbor-cat',
    displayName: 'Harbor Cat',
    license: 'CC0-1.0',
    renderer: 'sprite2d',
    sprite2d: { spritesheetPath: 'spritesheet.webp' },
    ...overrides,
  }
}

/** Minimal valid v2 live2d manifest. */
function v2Live2d(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    petManifestVersion: 2,
    id: 'haru',
    displayName: 'Haru',
    license: 'Live2D-Sample-Model',
    renderer: 'live2d',
    live2d: {
      model: 'haru.model3.json',
      motions: { idle: 'Idle', thinking: 'Think', done: 'Happy' },
    },
    ...overrides,
  }
}

describe('safeManifestPath', () => {
  it('accepts plain relative paths', () => {
    expect(safeManifestPath('spritesheet.webp')).toBe('spritesheet.webp')
    expect(safeManifestPath('motions/idle.motion3.json')).toBe('motions/idle.motion3.json')
  })
  it('rejects traversal, absolute, backslash and URL forms', () => {
    expect(safeManifestPath('../evil.png')).toBeUndefined()
    expect(safeManifestPath('/etc/passwd')).toBeUndefined()
    expect(safeManifestPath('a\\b.png')).toBeUndefined()
    expect(safeManifestPath('https://evil.example/x.png')).toBeUndefined()
    expect(safeManifestPath('a/bad name.png')).toBeUndefined()
    expect(safeManifestPath('.')).toBeUndefined()
    expect(safeManifestPath('a/./b.png')).toBeUndefined()
    expect(safeManifestPath('')).toBeUndefined()
    expect(safeManifestPath(42)).toBeUndefined()
  })
})

describe('parsePetManifest v1 compat read', () => {
  it('maps a bare Codex manifest onto a sprite2d v2 shape with a migration hint', () => {
    const result = parsePetManifest({ id: 'whale-girl', displayName: '鲸鱼娘' }, 'assets/whale')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migrated).toBe('v1-compat')
    expect(result.manifest.renderer).toBe('sprite2d')
    expect(result.manifest.sprite2d?.spritesheetPath).toBe('spritesheet.webp')
    const warnings = result.diagnostics.filter(d => d.level === 'warning').map(d => d.message)
    expect(warnings.some(m => m.includes('v1 compat read'))).toBe(true)
    expect(warnings.some(m => m.includes('license'))).toBe(true)
  })

  it('preserves v1 geometry, tracks, sequences and remarks verbatim', () => {
    const v1 = {
      id: 'whale-girl',
      displayName: 'Whale Girl',
      spritesheetPath: 'atlas/main.webp',
      cell: { width: 192, height: 208 },
      columns: 8,
      frames: [6, 8, 8, 4, 5, 8, 6, 6, 6],
      tracks: { idle: { durations: [400, 400] } },
      sequences: { idle: ['idle', 'waving', 'idle', 'waiting', 'idle'] },
      remarks: { tap: ['hi'] },
      spriteVersionNumber: 2,
    }
    const result = parsePetManifest(v1, 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.sprite2d).toMatchObject({
      spritesheetPath: 'atlas/main.webp',
      cell: { width: 192, height: 208 },
      columns: 8,
      frames: [6, 8, 8, 4, 5, 8, 6, 6, 6],
      atlasRows: 11,
    })
    expect(result.manifest.sequences?.idle).toHaveLength(5)
    expect(result.manifest.remarks).toEqual({ tap: ['hi'] })
  })

  it('rejects a v1 manifest with an unsafe spritesheetPath', () => {
    const result = parsePetManifest({ id: 'bad', spritesheetPath: '../evil.webp' }, 'mem')
    expect(result.ok).toBe(false)
  })

  it('rejects a v1 manifest without a usable id', () => {
    expect(parsePetManifest({ displayName: 'No Id' }, 'mem').ok).toBe(false)
    expect(parsePetManifest({ id: 'Bad_Id' }, 'mem').ok).toBe(false)
  })
})

describe('parsePetManifest v2 fail-closed validation', () => {
  it('accepts a minimal sprite2d manifest and defaults the renderer', () => {
    const { renderer, ...rest } = v2Sprite()
    const result = parsePetManifest(rest, 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migrated).toBeUndefined()
    expect(result.manifest.renderer).toBe('sprite2d')
  })

  it('accepts a full live2d manifest', () => {
    const result = parsePetManifest(v2Live2d({
      live2d: {
        model: 'models/haru.model3.json',
        scale: 1.2,
        translate: { x: 0, y: -10 },
        motions: { idle: 'Idle', tool: 'Work' },
        expressions: { done: 'smile' },
        hitAreas: ['Head', 'Body'],
        lipSync: false,
      },
    }), 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.live2d?.motions.idle).toBe('Idle')
    expect(result.manifest.live2d?.scale).toBe(1.2)
    expect(result.manifest.live2d?.hitAreas).toEqual(['Head', 'Body'])
  })

  it('fails closed on unknown top-level fields', () => {
    const result = parsePetManifest(v2Sprite({ surprise: true }), 'mem')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some(d => d.message.includes('surprise'))).toBe(true)
  })

  it('rejects unknown renderer kinds with a human-readable diagnostic', () => {
    const result = parsePetManifest(v2Sprite({ renderer: 'spine' }), 'mem')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some(d => d.message.includes(PET_RENDERER_KINDS[0]))).toBe(true)
  })

  it('requires license and displayName in v2', () => {
    const { license, ...noLicense } = v2Sprite()
    expect(parsePetManifest(noLicense, 'mem').ok).toBe(false)
    const { displayName, ...noName } = v2Sprite()
    expect(parsePetManifest(noName, 'mem').ok).toBe(false)
  })

  it('requires the conditional block matching the renderer', () => {
    const { sprite2d, ...noBlock } = v2Sprite()
    expect(parsePetManifest(noBlock, 'mem').ok).toBe(false)
    const { live2d, ...noLiveBlock } = v2Live2d()
    expect(parsePetManifest(noLiveBlock, 'mem').ok).toBe(false)
    expect(parsePetManifest(v2Sprite({ live2d: { model: 'x.model3.json', motions: { idle: 'i' } } }), 'mem').ok).toBe(false)
  })

  it('requires live2d.motions.idle and a .model3.json model path', () => {
    const noIdle = v2Live2d()
    ;(noIdle.live2d as Record<string, unknown>).motions = { thinking: 'Think' }
    expect(parsePetManifest(noIdle, 'mem').ok).toBe(false)
    const badModel = v2Live2d()
    ;(badModel.live2d as Record<string, unknown>).model = 'haru.json'
    expect(parsePetManifest(badModel, 'mem').ok).toBe(false)
  })

  it('rejects unsupported manifest versions explicitly', () => {
    expect(parsePetManifest(v2Sprite({ petManifestVersion: 3 }), 'mem').ok).toBe(false)
    expect(parsePetManifest(v2Sprite({ petManifestVersion: '2' }), 'mem').ok).toBe(false)
  })

  it('rejects non-object manifests without throwing', () => {
    expect(parsePetManifest(null, 'mem').ok).toBe(false)
    expect(parsePetManifest([1, 2], 'mem').ok).toBe(false)
    expect(parsePetManifest('pet', 'mem').ok).toBe(false)
  })

  it('keeps sequence content warn-and-drop while structure stays strict', () => {
    const result = parsePetManifest(v2Sprite({
      sequences: {
        idle: ['idle', 'waving', 'idle', 'waiting', 'idle'],
        bogus: ['idle', 'idle', 'idle', 'idle', 'idle'],
        tool: ['running'],
      },
    }), 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.sequences?.idle).toHaveLength(5)
    expect(result.manifest.sequences && 'bogus' in result.manifest.sequences).toBe(false)
    expect(result.manifest.sequences && 'tool' in result.manifest.sequences).toBe(false)
    expect(result.diagnostics.filter(d => d.level === 'warning').length).toBe(2)
  })

  it('rejects out-of-range live2d scale and malformed hitAreas', () => {
    const badScale = v2Live2d()
    ;(badScale.live2d as Record<string, unknown>).scale = 0
    expect(parsePetManifest(badScale, 'mem').ok).toBe(false)
    const badHits = v2Live2d()
    ;(badHits.live2d as Record<string, unknown>).hitAreas = ['Head', '']
    expect(parsePetManifest(badHits, 'mem').ok).toBe(false)
  })
})

describe('constants', () => {
  it('locks the manifest version and renderer kinds', () => {
    expect(PET_MANIFEST_V2).toBe(2)
    expect(PET_RENDERER_KINDS).toEqual(['sprite2d', 'live2d'])
  })
})

describe('schema file drift lock', () => {
  const schema = JSON.parse(readFileSync(
    join(petPackageRoot(import.meta.url), 'contracts', 'pet-manifest-v2.schema.json'),
    'utf8',
  )) as {
    required: string[]
    properties: Record<string, { enum?: string[]; properties?: Record<string, unknown> }>
  }

  it('locks the schema file top-level fields to the validator allow-list', () => {
    expect(new Set(Object.keys(schema.properties))).toEqual(KNOWN_TOP_LEVEL)
  })

  it('locks the required set and the renderer enum', () => {
    expect([...schema.required].sort()).toEqual(['displayName', 'id', 'license', 'petManifestVersion'])
    expect(schema.properties.renderer?.enum).toEqual([...PET_RENDERER_KINDS])
  })

  it('locks the renderer block allow-lists', () => {
    expect(new Set(Object.keys(schema.properties.sprite2d?.properties ?? {}))).toEqual(KNOWN_SPRITE2D)
    expect(new Set(Object.keys(schema.properties.live2d?.properties ?? {}))).toEqual(KNOWN_LIVE2D)
  })

  it('keeps the schema version const in sync', () => {
    const version = (schema.properties.petManifestVersion as { const: number }).const
    expect(version).toBe(PET_MANIFEST_V2)
  })
})
