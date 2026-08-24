import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { dirname } from 'node:path'
import type { FsLike } from './fs.ts'

let atomicWriteSequence = 0

const RETRY_CODES = new Set(['EPERM', 'EACCES'])
const RENAME_RETRIES = 3
const RENAME_RETRY_DELAY_MS = 50

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!RETRY_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      if (attempt < RENAME_RETRIES - 1) {
        await delay(RENAME_RETRY_DELAY_MS)
      } else {
        throw error
      }
    }
  }
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // In-process-unique staging name: the host may run two writes for the same
  // document concurrently (e.g. startup policy sync racing another one); with
  // pid + Date.now() alone they would share a temp file and the second rename
  // would fail with ENOENT, aborting the whole load.
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${atomicWriteSequence += 1}`
  const content = `${JSON.stringify(value, null, 2)}\n`
  try {
    await writeFile(temporary, content, { mode })
    await renameWithRetry(temporary, path)
  } catch (error) {
    // Rename exhausted all retries (Windows EPERM / EACCES when the target is
    // held by another handle) -- fall back to a direct overwrite so the
    // policy / state update is not lost.  The write is no longer atomic with
    // respect to a crash, but that is strictly better than losing the update.
    if (RETRY_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
      try {
        await writeFile(path, content, { mode })
        await rm(temporary, { force: true }).catch(() => undefined)
        return
      } catch { /* fall through to original cleanup + rethrow */ }
    }
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Atomically replace a JSON document through an injected filesystem. */
export async function writeJsonAtomicFs(fs: FsLike, path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${atomicWriteSequence += 1}`
  try {
    await fs.writeText(temporary, `${JSON.stringify(value, null, 2)}\n`)
    await fs.rename(temporary, path)
  } catch (error) {
    await fs.remove(temporary).catch(() => undefined)
    throw error
  }
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}
