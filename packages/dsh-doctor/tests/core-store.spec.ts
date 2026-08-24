import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeJsonAtomic, writeJsonAtomicFs } from '../src/core/store.ts'
import { createMemoryFs, FsError, type FsLike } from '../src/core/fs.ts'

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

describe('writeJsonAtomicFs lock handling (Windows rename-over-open-file)', () => {
  /** Wrap fs rename so it throws a lock error for the next `fails` calls. */
  function flakyRename(fs: FsLike, fails: number, errorCode = 'EPERM'): FsLike {
    let remaining = fails
    return new Proxy(fs, {
      get(target, prop, receiver) {
        if (prop === 'rename') {
          return async (from: string, to: string) => {
            if (remaining > 0) {
              remaining -= 1
              throw new FsError(errorCode, to)
            }
            return target.rename(from, to)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }

  it('recovers from a transient EPERM via rename retries', async () => {
    const fs = createMemoryFs()
    await writeJsonAtomicFs(flakyRename(fs, 1), '/state/policy.json', { ok: true })
    expect(JSON.parse(await fs.readText('/state/policy.json'))).toEqual({ ok: true })
  })

  it('degrades to a direct overwrite when the destination stays locked', async () => {
    const fs = createMemoryFs()
    await writeJsonAtomicFs(flakyRename(fs, 99), '/state/policy.json', { ok: true })
    expect(JSON.parse(await fs.readText('/state/policy.json'))).toEqual({ ok: true })
    // The staging temp is cleaned up after the fallback direct write.
    const entries = await fs.readdir('/state')
    expect(entries.map((entry) => entry.name)).toEqual(['policy.json'])
  })

  it('propagates non-lock rename errors without falling back', async () => {
    const fs = createMemoryFs()
    await expect(writeJsonAtomicFs(flakyRename(fs, 1, 'EISDIR'), '/state/policy.json', { ok: true }))
      .rejects.toThrow('EISDIR')
  })
})
