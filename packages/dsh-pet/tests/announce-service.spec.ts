import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { PetService } from '../src/service.ts'
import { loadPetRegistry } from '../src/registry.ts'

/**
 * Service-level tests for the announcement bubble (dsh-usage linkage):
 * announce() stores the last valid payload, view() exposes it while fresh
 * and drops it once its TTL passes. Rendering itself is covered by the
 * client bundle; parseAnnouncement's bounds live in announce.spec.ts.
 */

const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

let dir: string
let service: PetService

const BALANCE_PAYLOAD = {
  source: 'dsh-usage',
  kind: 'balance' as const,
  title: 'DeepSeek',
  amount: '¥110.00',
  tone: 'ok' as const,
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-announce-'))
  const assets = join(dir, 'assets', 'whale')
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(assets, 'pet.json'), JSON.stringify({
    id: 'whale-girl', displayName: '鲸鱼娘', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  writeFileSync(join(assets, 'spritesheet.webp'), WEBP_BYTES)

  const ctx = new Context()
  const registry = loadPetRegistry({ packageRoot: dir, petsDir: '', dshPetsDir: '' })
  service = new PetService(ctx, { persistDir: join(dir, 'home'), registry })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const viewAnnouncement = async () => (await service.state()).announcement

describe('PetService.announce + view TTL', () => {
  it('stores a valid announcement and exposes it in the state view', async () => {
    expect(service.announce(BALANCE_PAYLOAD)).toEqual({ ok: true })
    expect(await viewAnnouncement()).toMatchObject({ source: 'dsh-usage', kind: 'balance', title: 'DeepSeek' })
  })

  it('keeps the last valid announcement (last-write-wins) and drops malformed ones', async () => {
    expect(service.announce({ kind: 'balance', title: 'missing source' })).toEqual({ ok: false })
    expect(await viewAnnouncement()).toMatchObject({ title: 'DeepSeek' })

    expect(service.announce({ ...BALANCE_PAYLOAD, title: 'Kimi', amount: '$5.00' })).toEqual({ ok: true })
    expect(await viewAnnouncement()).toMatchObject({ title: 'Kimi', amount: '$5.00' })
  })

  it('stops exposing the announcement once its ttl has passed', async () => {
    expect(service.announce({ ...BALANCE_PAYLOAD, ttlMs: 1000 })).toEqual({ ok: true })
    expect(await viewAnnouncement()).toBeDefined()

    await sleep(1100)
    expect(await viewAnnouncement()).toBeUndefined()
  })
})
