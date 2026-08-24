import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FsLike } from './fs.ts'

let atomicWriteSequence = 0

/** Error codes that mean another process temporarily holds the destination. */
const LOCK_ERROR_CODES = new Set(['EPERM', 'EACCES'])

function isLockError(error: unknown): boolean {
  return LOCK_ERROR_CODES.has((error as { code?: unknown })?.code as string)
}

/**
 * Rename with bounded retry on transient lock errors. Windows refuses to
 * rename over an open destination whose handle lacks FILE_SHARE_DELETE, so a
 * momentarily-held target (editor, indexer, antivirus, in-process watcher)
 * surfaces as EPERM/EACCES; a short retry usually clears it. Non-lock errors
 * propagate immediately.
 */
async function renameWithRetry(renameFn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFn()
      return
    } catch (error) {
      if (!isLockError(error) || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
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
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  try {
    await writeFile(temporary, serialized, { mode })
    await renameWithRetry(() => rename(temporary, path))
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    // Windows prevents rename-over-open-file while another handle holds the
    // destination without FILE_SHARE_DELETE. After the retries above are
    // exhausted, degrade to a direct overwrite so a transient lock cannot
    // abort the whole sync; a direct write failure still propagates.
    if (isLockError(error)) await writeFile(path, serialized, { mode })
    else throw error
  }
}

/** Atomically replace a JSON document through an injected filesystem. */
export async function writeJsonAtomicFs(fs: FsLike, path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${atomicWriteSequence += 1}`
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  try {
    await fs.writeText(temporary, serialized)
    await renameWithRetry(() => fs.rename(temporary, path))
  } catch (error) {
    await fs.remove(temporary).catch(() => undefined)
    // Same degrade-to-direct-write as above: a transient destination lock
    // on Windows must not abort the policy sync permanently.
    if (isLockError(error)) await fs.writeText(path, serialized)
    else throw error
  }
}

export async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const { appendFile } = await import('node:fs/promises')
  await appendFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}
