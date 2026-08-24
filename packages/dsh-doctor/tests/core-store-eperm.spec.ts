/**
 * Tests for the EPERM retry + direct-write fallback added to writeJsonAtomic.
 *
 * ESM namespace objects are sealed, so vi.spyOn(fsp, 'rename') cannot
 * redefine the property.  We use vi.mock with a hoisted factory that wraps the
 * real implementation and injects EPERM failures on demand.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// ---------- controllable rename mock ----------------------------------------
const renameControl = { fail: 0 }

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (renameControl.fail > 0) {
        renameControl.fail -= 1
        const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException
        err.code = 'EPERM'
        err.errno = -4048
        throw err
      }
      return actual.rename(...args)
    },
  }
})

// Re-import *after* the mock is installed so the module picks up the mock.
const { writeJsonAtomic } = await import('../src/core/store.ts')

describe('writeJsonAtomic EPERM rename retry + fallback', () => {
  let dir = ''
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-store-eperm-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })
  afterEach(() => { renameControl.fail = 0 })

  it('succeeds without retry when rename does not fail', async () => {
    const path = join(dir, 'no-fail.json')
    await writeJsonAtomic(path, { ok: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ok: true })
  })

  it('retries a transient EPERM rename and succeeds on the third attempt', async () => {
    renameControl.fail = 2
    const path = join(dir, 'retry-ok.json')
    await writeJsonAtomic(path, { retried: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ retried: true })
    // No leftover temp files.
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(dir)).filter((e) => e.includes('.tmp-'))).toEqual([])
  })

  it('falls back to direct write when all 3 rename retries fail with EPERM', async () => {
    // 3 retries exhausted => EPERM thrown => catch block falls back to writeFile.
    renameControl.fail = 999
    const path = join(dir, 'fallback.json')
    await writeJsonAtomic(path, { fallback: true })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ fallback: true })
    // Temp file should have been cleaned up by the fallback path.
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(dir)).filter((e) => e.includes('.tmp-'))).toEqual([])
    // Reset so afterAll cleanup works.
    renameControl.fail = 0
  })
})
