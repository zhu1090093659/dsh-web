import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ConfigStore, DEFAULT_DESKTOP_CONFIG, migrateDesktopConfig } from './config-store.ts'

describe('desktop config V7 migration', () => {
  it('migrates the frozen V6 fixture without losing surface or model preferences', async () => {
    const fixture = JSON.parse(await readFile(
      new URL('../../../tests/fixtures/desktop-config-v6.json', import.meta.url),
      'utf8',
    )) as unknown

    expect(migrateDesktopConfig(fixture)).toEqual({
      schemaVersion: 7,
      hostId: 'standalone',
      surface: {
        visible: false, locked: true, alwaysOnTop: false, scale: 1.25,
        position: { x: -420, y: 82 },
      },
      renderer: {
        rendererId: 'builtin:sprite2d', modelId: 'local:lian', quality: 'balanced',
        modelAliases: { 'local:lian': '小狮子', 'imported:boba': '波霸' },
      },
      standalone: { lastWebOrigin: 'http://localhost:4080' },
    })
  })

  it('normalizes V7 idempotently while retaining an unavailable model request', () => {
    const value = {
      schemaVersion: 7,
      hostId: 'dshcode',
      surface: {
        visible: false, locked: true, alwaysOnTop: false, scale: 1.5,
        position: { x: 12.4, y: -8.6, displayId: 'monitor-2' },
      },
      renderer: {
        rendererId: 'extension:live2d', modelId: 'imported:temporarily-missing', quality: 'high',
        modelAliases: { 'imported:temporarily-missing': '等她回来' },
      },
      standalone: { lastWebOrigin: 'http://localhost:4090/' },
    }
    const first = migrateDesktopConfig(value)

    expect(first).toMatchObject({
      hostId: 'dshcode',
      surface: { position: { x: 12, y: -9, displayId: 'monitor-2' } },
      renderer: {
        rendererId: 'extension:live2d', modelId: 'imported:temporarily-missing', quality: 'high',
        modelAliases: { 'imported:temporarily-missing': '等她回来' },
      },
      standalone: { lastWebOrigin: 'http://localhost:4090' },
    })
    expect(migrateDesktopConfig(first)).toEqual(first)
  })

  it('migrates the removed 50% and 75% scales back to 100%', () => {
    for (const scale of [0.5, 0.75]) {
      expect(migrateDesktopConfig({
        ...DEFAULT_DESKTOP_CONFIG,
        surface: { ...DEFAULT_DESKTOP_CONFIG.surface, scale },
      }).surface.scale).toBe(1)
    }
  })

  it.each([1, 2, 3, 4, 5])('keeps legacy version %s readable', (schemaVersion) => {
    const migrated = migrateDesktopConfig({
      schemaVersion,
      visible: false,
      locked: true,
      alwaysOnTop: false,
      webDshUrl: 'http://localhost:4080',
      pixelModelId: 'local:lian',
      pixelModelNames: { 'local:lian': '小狮子' },
      position: { x: 4, y: 5 },
    })

    expect(migrated.schemaVersion).toBe(7)
    expect(migrated.surface.locked).toBe(true)
    expect(migrated.surface.position).toEqual({ x: 4, y: 5 })
    expect(migrated.renderer.modelId).toBe(schemaVersion >= 3 ? 'local:lian' : 'builtin:whale')
  })

  it('drops malformed fields without discarding the valid V7 envelope', () => {
    expect(migrateDesktopConfig({
      schemaVersion: 7,
      hostId: '../unsafe',
      surface: { locked: 'yes', alwaysOnTop: 'yes', scale: 10, position: { x: 'secret', y: Number.NaN } },
      renderer: {
        rendererId: 'bad', modelId: 42, quality: 'ultra',
        modelAliases: { '../unsafe': 'Bad', 'local:lian': ' '.repeat(4) },
      },
      standalone: { lastWebOrigin: 'file:///invalid' },
    })).toEqual(DEFAULT_DESKTOP_CONFIG)
  })

  it('falls back for an unknown schema version', () => {
    expect(migrateDesktopConfig({ schemaVersion: 99, locked: true })).toEqual(DEFAULT_DESKTOP_CONFIG)
  })

  it('serializes repeated atomic V7 saves on Windows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-pet-config-'))
    const filePath = join(directory, 'config.json')
    const store = new ConfigStore(filePath)
    const next = migrateDesktopConfig({
      schemaVersion: 7,
      hostId: 'standalone',
      surface: { visible: false, locked: true, alwaysOnTop: true, scale: 1.5, position: { x: 42, y: -9 } },
      renderer: {
        rendererId: 'builtin:sprite2d', modelId: 'imported:boba', quality: 'low',
        modelAliases: { 'imported:boba': '波霸' },
      },
      standalone: { lastWebOrigin: 'http://localhost:4080' },
    })
    await store.save(DEFAULT_DESKTOP_CONFIG)
    await store.save(next)

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(next)
    await expect(store.load()).resolves.toEqual(next)
  })
})
