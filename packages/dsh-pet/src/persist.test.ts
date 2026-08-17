import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AFFINITY_MAX, emptyAffinity } from './affinity.ts'
import { defaultTreatConfig, emptyTreatLedger } from './treats.ts'
import {
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
        affinity: { ...emptyAffinity(), points: 42, pets: 3, feeds: 1, turns: 10 },
        treats: { ...emptyTreatLedger(), treats: 7, lastTreatGrantAt: 1234, turnsAtLastTreatGrant: 9 },
        display: { visible: false, size: 200, right: 10, bottom: 40 },
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
