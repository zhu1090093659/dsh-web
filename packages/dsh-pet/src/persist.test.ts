import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AFFINITY_MAX, emptyAffinity } from './affinity.ts'
import { defaultTreatConfig, emptyTreatLedger } from './treats.ts'
import {
  BUBBLE_FONT_MAX_PX,
  BUBBLE_FONT_MIN_PX,
  BUBBLE_SCALE_MAX,
  BUBBLE_SCALE_MIN,
  bubbleScaleFor,
  DEFAULT_PET_ID,
  DISPLAY_INSET_MAX,
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  defaultDisplayConfig,
  emptyPersist,
  loadPetPersist,
  savePetPersist,
} from './persist.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-test-'))
}

describe('loadPetPersist', () => {
  it('reserves enough default space for the hover panel below the pet', () => {
    expect(defaultDisplayConfig.bottom).toBeGreaterThanOrEqual(100)
  })

  it('falls back to defaults when the file is missing', () => {
    const dir = tempDir()
    try {
      expect(loadPetPersist(dir)).toEqual(emptyPersist())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to defaults on corrupt JSON', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), '{ not json', 'utf8')
      expect(loadPetPersist(dir)).toEqual(emptyPersist())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('round-trips a saved persist file', () => {
    const dir = tempDir()
    try {
      const data = {
        petId: 'otter',
        names: { otter: '泡泡', 'whale-girl': '鲸鱼娘' },
        skins: { otter: 'lanhainishang' },
        affinity: { ...emptyAffinity(), points: 42, pets: 3, feeds: 1, turns: 10 },
        treats: { ...emptyTreatLedger(), treats: 7, lastTreatGrantAt: 1234, turnsAtLastTreatGrant: 9 },
        display: { visible: false, size: 200, right: 10, bottom: 40, bubbleScale: 1.25 },
        gameplay: {
          otter: { stats: { hunger: 55.5 }, currencies: { coins: 12 }, mode: 'work' as const, settledAt: 777 },
        },
      }
      savePetPersist(data, dir)
      expect(loadPetPersist(dir)).toEqual(data)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates the legacy flat name onto the legacy pet id', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        name: '泡泡',
        affinity: { points: 5 },
      }), 'utf8')
      const loaded = loadPetPersist(dir)
      expect(loaded.petId).toBe(DEFAULT_PET_ID)
      expect(loaded.names).toEqual({ [DEFAULT_PET_ID]: '泡泡' })
      expect(loaded.affinity.points).toBe(5)
      expect(loaded.affinity.petRejects).toBe(0)
      expect(loaded.affinity.feedRejects).toBe(0)
      expect(loaded.display).toEqual(defaultDisplayConfig)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates the legacy flat name onto the persisted selection when both exist', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        petId: 'otter',
        name: '水獭',
      }), 'utf8')
      const loaded = loadPetPersist(dir)
      expect(loaded.petId).toBe('otter')
      expect(loaded.names).toEqual({ otter: '水獭' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps stored per-pet names when the legacy name is also present', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        name: '旧名字',
        names: { [DEFAULT_PET_ID]: '新名字' },
      }), 'utf8')
      const loaded = loadPetPersist(dir)
      expect(loaded.names[DEFAULT_PET_ID]).toBe('新名字')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sanitizes the per-pet skin map', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        skins: { otter: '  lanhainishang  ', blank: '   ', numeric: 7, '': 'x' },
      }), 'utf8')
      expect(loadPetPersist(dir).skins).toEqual({ otter: 'lanhainishang' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clamps out-of-range and non-numeric fields', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        name: '   ',
        names: { bad: '  ' },
        affinity: {
          points: AFFINITY_MAX + 5000,
          lastPetAt: -5,
          lastFeedAt: 'x',
          pets: -1,
          feeds: 1.5,
          turns: 0,
          petRejects: 4,
          feedRejects: -2,
        },
        treats: { treats: 150, lastTreatGrantAt: -1, turnsAtLastTreatGrant: 0 },
        display: { visible: 'yes', size: -10, right: 1e12, bottom: 20 },
      }), 'utf8')
      const loaded = loadPetPersist(dir)
      expect(loaded.petId).toBe(DEFAULT_PET_ID)
      expect(loaded.names).toEqual({})
      expect(loaded.affinity.points).toBe(AFFINITY_MAX)
      expect(loaded.affinity.lastPetAt).toBe(0)
      expect(loaded.affinity.lastFeedAt).toBe(0)
      expect(loaded.affinity.pets).toBe(0)
      expect(loaded.affinity.feeds).toBe(1.5) // finite numbers pass through
      expect(loaded.affinity.petRejects).toBe(4)
      expect(loaded.affinity.feedRejects).toBe(0)
      expect(loaded.treats.treats).toBe(defaultTreatConfig.maxTreats)
      expect(loaded.treats.lastTreatGrantAt).toBe(0)
      expect(loaded.display.visible).toBe(defaultDisplayConfig.visible)
      expect(loaded.display.size).toBe(DISPLAY_SIZE_MIN) // -10 clamped to min
      expect(loaded.display.right).toBe(DISPLAY_INSET_MAX) // 1e12 clamped to max
      expect(loaded.display.bottom).toBe(20) // finite in-range passes through
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('defaults the bubble scale to the untouched baseline (#1549)', () => {
    const dir = tempDir()
    try {
      expect(loadPetPersist(dir).display.bubbleScale).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clamps a persisted bubble scale into the supported range (#1549)', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({ display: { visible: true, size: 160, right: 0, bottom: 0, bubbleScale: 99 } }), 'utf8')
      expect(loadPetPersist(dir).display.bubbleScale).toBe(BUBBLE_SCALE_MAX)
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({ display: { visible: true, size: 160, right: 0, bottom: 0, bubbleScale: 'big' } }), 'utf8')
      expect(loadPetPersist(dir).display.bubbleScale).toBe(defaultDisplayConfig.bubbleScale)
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({ display: { visible: true, size: 160, right: 0, bottom: 0, bubbleScale: -3 } }), 'utf8')
      expect(loadPetPersist(dir).display.bubbleScale).toBe(BUBBLE_SCALE_MIN)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('follows the pet size and stays inside the readable band (#1549)', () => {
    // The baseline the stylesheet was drawn for: 12px at the default 160px pet.
    expect(bubbleScaleFor({ size: 160, bubbleScale: 1 })).toBe(1)
    // A shrunk pet shrinks the bubble, but never below the floor (the ratio
    // is rounded to two decimals so the same config always paints the same).
    expect(bubbleScaleFor({ size: 100, bubbleScale: 1 })).toBe(0.83)
    expect(bubbleScaleFor({ size: 32, bubbleScale: 1 })).toBe(0.83)
    // An enlarged pet caps the bubble instead of growing it without bound.
    expect(bubbleScaleFor({ size: 1024, bubbleScale: 1 })).toBe(BUBBLE_FONT_MAX_PX / 12)
    // The user's multiplier rides on top of the automatic following.
    expect(bubbleScaleFor({ size: 160, bubbleScale: 2 })).toBe(2)
    expect(bubbleScaleFor({ size: 160, bubbleScale: 0.5 })).toBe(0.83)
  })

  it('keeps the baseline when a host omits or corrupts the bubble scale (#1549)', () => {
    // A host that predates the field serves no bubbleScale. NaN would reach
    // --pet-bubble-scale and collapse every bubble's text to zero.
    expect(bubbleScaleFor({ size: 160 })).toBe(1)
    expect(bubbleScaleFor({ size: 160, bubbleScale: Number.NaN })).toBe(1)
    expect(bubbleScaleFor({ size: Number.NaN, bubbleScale: 1 })).toBe(1)
    // A corrupt size must not leak through either; the multiplier still applies.
    expect(bubbleScaleFor({ size: Number.POSITIVE_INFINITY, bubbleScale: 2 })).toBe(2)
  })

  it('clamps oversized display size to the max', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        display: { visible: true, size: 1e9, right: 0, bottom: 0 },
      }), 'utf8')
      expect(loadPetPersist(dir).display.size).toBe(DISPLAY_SIZE_MAX)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
