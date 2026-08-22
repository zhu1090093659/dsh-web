import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FsLike } from './fs.ts'

let atomicWriteSequence = 0

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode })
  await rename(temporary, path)
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
