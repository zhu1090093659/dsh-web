import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { afterEach, describe, expect, it } from 'vitest'

import { PetService } from '../src/service.ts'

class MemorySettings extends SettingsProvider {
  private memoryDocument: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.memoryDocument))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.memoryDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
})

async function setup(): Promise<{ ctx: Context; service: PetService; dir: string }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings)
  ctx.settings.register('pet' as SettingsNamespace, z.object({
    enabled: z.boolean().default(true),
    visible: z.boolean().default(true),
    size: z.number().default(160),
    right: z.number().default(24),
    bottom: z.number().default(20),
    petId: z.string().default('whale-girl'),
    desktopEnabled: z.boolean().default(false),
    desktopVisible: z.boolean().default(true),
    desktopAlwaysOnTop: z.boolean().default(true),
    desktopLocked: z.boolean().default(false),
    desktopScale: z.number().min(1).max(2).default(1),
  }))
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-desktop-settings-'))
  return { ctx, service: new PetService(ctx, { persistDir: dir }), dir }
}

describe('desktop settings service seam', () => {
  it('describes and revision-fences the narrow pet namespace', async () => {
    const { service, dir } = await setup()
    try {
      const initial = await service.settingsView()
      expect(initial).toMatchObject({
        value: { desktopEnabled: false, desktopScale: 1 },
        revision: 0,
        writable: true,
      })
      const changed = await service.mutateSettings([
        { op: 'set', path: ['desktopEnabled'], value: true },
      ], initial.revision)
      expect(changed).toMatchObject({
        value: { desktopEnabled: true },
        user: { desktopEnabled: true },
        revision: 1,
      })
      await expect(service.mutateSettings([
        { op: 'set', path: ['desktopEnabled'], value: false },
      ], initial.revision)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists a native surface patch and returns the shared companion view', async () => {
    const { service, dir } = await setup()
    try {
      const result = await service.setDesktopSettings({
        enabled: true,
        visible: false,
        alwaysOnTop: false,
        locked: true,
        scale: 1.5,
      })
      expect(result).toEqual({
        ok: true,
        companion: {
          enabled: true,
          visible: false,
          alwaysOnTop: false,
          locked: true,
          scale: 1.5,
        },
      })
      expect(await service.settingsView()).toMatchObject({
        value: {
          desktopEnabled: true,
          desktopVisible: false,
          desktopAlwaysOnTop: false,
          desktopLocked: true,
          desktopScale: 1.5,
        },
      })
      expect((await service.state()).companion).toEqual(result.companion)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges concurrent partial surface updates without restoring stale fields', async () => {
    const { service, dir } = await setup()
    try {
      await Promise.all([
        service.setDesktopSettings({ visible: false }),
        service.setDesktopSettings({ scale: 1.75 }),
      ])

      expect(await service.settingsView()).toMatchObject({
        value: { desktopVisible: false, desktopScale: 1.75 },
      })
      expect((await service.state()).companion).toMatchObject({
        visible: false,
        scale: 1.75,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
