import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeJsonAtomic } from '../src/core/store.ts'

describe('writeJsonAtomic concurrent safety', () => {
  let dir = ''
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-store-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('writes and reads back a document', async () => {
    const path = join(dir, 'policy.json')
    await writeJsonAtomic(path, { fullProtection: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ fullProtection: true })
  })

  it('keeps concurrent writes to the same path from aborting the last rename', async () => {
    const path = join(dir, 'policy-concurrent.json')
    // The startup policy sync can run twice in the same tick (the DSH host
    // reevaluates the loaded bundle). Before the in-process sequence stamp
    // both writers staged the same tmp name, so one rename won and the other
    // failed with ENOENT.
    const writes = Array.from({ length: 8 }, (_, seq) => writeJsonAtomic(path, { seq }))
    await expect(Promise.all(writes)).resolves.toEqual(Array(8).fill(undefined))
    const final = JSON.parse(await readFile(path, 'utf8')) as { seq: number }
    expect(final.seq).toBeGreaterThanOrEqual(0)
    expect(final.seq).toBeLessThan(8)
  })

  it('leaves a staged temp file behind only on failure', async () => {
    const path = join(dir, 'policy-rec.json')
    await writeJsonAtomic(path, { ok: true })
    // The staging name is removed by the successful rename; no .tmp-* residue.
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(dir)).filter((entry) => entry.includes('.tmp-'))).toEqual([])
  })
})
