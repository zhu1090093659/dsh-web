/**
 * SFTP transfers: upload (file or recursive tree), single-file download, and
 * remote directory listing. Every channel is opened once per operation and
 * released exactly once so sshd's MaxSessions cap is never exhausted.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve as resolvePath } from 'node:path'
import { Client, type SFTPWrapper } from 'ssh2'
import type { RemoteDirEntry, TransferProgress } from '../protocol.ts'
import { withClient, type PoolEngine } from './connection-pool.ts'

/** Walk a local directory, collecting relative paths of every file. */
export function walkLocalDir(root: string): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      // lstat, not stat: a symlink must never be followed — a link cycle
      // (ln -s . self) recurses forever under stat, and a link to a file
      // would silently upload the target's bytes.
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) visit(full)
      else if (stat.isFile()) files.push(relative(root, full).replaceAll('\\', '/'))
    }
  }
  visit(root)
  return files
}

/** Upload one local file (or directory tree) to a remote path. */
export async function upload(
  engine: PoolEngine,
  alias: string,
  localPath: string,
  remotePath: string,
  recursive: boolean,
  onProgress?: (progress: TransferProgress) => void,
): Promise<{ bytes: number; files: number }> {
  // Remote paths must be absolute: the mkdir chain and fastPut must agree
  // on one resolution (relative paths previously created dirs at the root).
  if (!remotePath.startsWith('/')) {
    throw new Error('remotePath must be an absolute path (got \'' + remotePath + '\')')
  }
  const local = resolvePath(localPath)
  if (!existsSync(local)) throw new Error('local path not found: \'' + localPath + '\'')
  return withClient(engine, alias, (client) => withSftp(client, async (sftp) => {
    const stat = statSync(local)
    const ensuredDirs = new Set<string>()
    let files: string[]
    if (stat.isDirectory()) {
      if (!recursive) throw new Error('\'' + localPath + '\' is a directory — enable recursive upload')
      files = walkLocalDir(local)
      await ensureRemoteDir(sftp, remotePath, ensuredDirs)
    } else {
      files = ['']
      await ensureRemoteDir(sftp, posix.dirname(remotePath), ensuredDirs)
    }
    let bytes = 0
    const baseRemote = remotePath.replace(/\/$/, '')
    for (const rel of files) {
      const src = rel === '' ? local : join(local, rel)
      // Remote paths always use forward slashes; normalize any OS separators.
      const remoteRel = rel.split(/[\\/]/).join('/')
      const dst = rel === '' ? remotePath : baseRemote + '/' + remoteRel
      if (rel !== '') await ensureRemoteDir(sftp, posix.dirname(dst), ensuredDirs)
      await fastPut(sftp, src, dst, engine.opts.sftpConcurrency, onProgress)
      bytes += statSync(src).size
    }
    return { bytes, files: files.length }
  }))
}

/** Download one remote file to a local path. */
export async function download(
  engine: PoolEngine,
  alias: string,
  remotePath: string,
  localPath: string,
  onProgress?: (progress: TransferProgress) => void,
): Promise<{ bytes: number }> {
  return withClient(engine, alias, (client) => withSftp(client, async (sftp) => {
    const stat = await new Promise<{ isDirectory: () => boolean }>((resolve, reject) => {
      sftp.stat(remotePath, (error, stats) => error !== undefined ? reject(error) : resolve(stats))
    })
    if (stat.isDirectory()) {
      throw new Error('\'' + remotePath + '\' is a directory — directory download is not supported yet (download individual files)')
    }
    const local = resolvePath(localPath)
    if (!existsSync(dirname(local))) mkdirSync(dirname(local), { recursive: true })
    await fastGet(sftp, remotePath, local, engine.opts.sftpConcurrency, onProgress)
    return { bytes: statSync(local).size }
  }))
}

/** List a remote directory (file browser). */
export async function ls(engine: PoolEngine, alias: string, path: string): Promise<RemoteDirEntry[]> {
  return withClient(engine, alias, (client) => withSftp(client, async (sftp) => {
    return await new Promise((resolve, reject) => {
      sftp.readdir(path, (error, list) => {
        if (error !== undefined) {
          reject(error)
          return
        }
        const entries: RemoteDirEntry[] = list.map(item => ({
          name: item.filename,
          type: item.attrs.isDirectory() ? 'dir' : item.attrs.isFile() ? 'file' : 'other',
          size: item.attrs.size,
          mtimeMs: item.attrs.mtime * 1000,
          mode: item.attrs.mode,
        }))
        resolve(entries)
      })
    })
  }))
}

/**
 * Open one SFTP channel, run the operation, and release the channel exactly
 * once when the operation settles (success or error). ssh2 keeps each
 * subsystem channel open until end(); without this, every transfer leaks a
 * channel until sshd's MaxSessions cap makes all later opens fail.
 */
async function withSftp<T>(client: Client, run: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const sftp = await sftpChannel(client)
  let ended = false
  const endOnce = (): void => {
    if (ended) return
    ended = true
    try { sftp.end() } catch { /* channel already closed */ }
  }
  // The channel can also close underneath us (peer reset, timeout); the
  // guard makes the finally below a no-op instead of ending it twice.
  sftp.once('close', endOnce)
  try {
    return await run(sftp)
  } finally {
    endOnce()
  }
}

function sftpChannel(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => error !== undefined ? reject(error) : resolve(sftp))
  })
}

function normalizeRemoteDir(remote: string): string {
  const cleaned = remote.replace(/\/+$/, '')
  return cleaned === '' ? '/' : cleaned
}

function recordEnsuredPrefixes(segments: string[], upToIndex: number, ensuredDirs?: Set<string>): void {
  if (ensuredDirs === undefined) return
  for (let index = 0; index <= upToIndex; index += 1) {
    ensuredDirs.add('/' + segments.slice(0, index + 1).join('/'))
  }
}

function statRemote(sftp: SFTPWrapper, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(path, (error) => { resolve(error === undefined) })
  })
}

function mkdirRemote(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, (error) => {
      if (error !== undefined) reject(error)
      else resolve()
    })
  })
}

/** Create a remote directory chain (with a 1-RTT stat fast path and prefix cache). */
export async function ensureRemoteDir(sftp: SFTPWrapper, remote: string, ensuredDirs?: Set<string>): Promise<void> {
  const normalized = normalizeRemoteDir(remote)
  if (normalized === '/' || ensuredDirs?.has(normalized) === true) return
  const segments = normalized.slice(1).split('/').filter(segment => segment !== '')
  if (segments.length === 0) return

  // Fast path: a single stat on a multi-segment path avoids N sequential RTTs
  // when the target directory already exists.
  if (segments.length > 1 && await statRemote(sftp, normalized)) {
    recordEnsuredPrefixes(segments, segments.length - 1, ensuredDirs)
    return
  }

  for (let index = 0; index < segments.length; index += 1) {
    const current = '/' + segments.slice(0, index + 1).join('/')
    if (ensuredDirs?.has(current) === true) continue
    const isLastAfterMissedFastPath = segments.length > 1 && index === segments.length - 1
    if (!isLastAfterMissedFastPath && await statRemote(sftp, current)) {
      ensuredDirs?.add(current)
      continue
    }
    try {
      await mkdirRemote(sftp, current)
    } catch (error) {
      if (!(await statRemote(sftp, current))) throw error
    }
    ensuredDirs?.add(current)
  }
}

/** One fastPut/fastGet transfer with throttled progress (the two directions share everything but the verb). */
export function fastTransfer(sftp: SFTPWrapper, kind: 'put' | 'get', src: string, dst: string, concurrency: number, onProgress?: (progress: TransferProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // Progress frames name the destination on upload, the source on download;
    // the final size comes from the local side of the transfer.
    const file = kind === 'put' ? dst : src
    const finalSize = (): number => statSync(kind === 'put' ? src : dst).size
    let last = 0
    let lastEmit = 0
    const started = Date.now()
    let prevEmit = started
    if (kind === 'put') {
      onProgress?.({ phase: 'transferring', file, transferred: 0, total: statSync(src).size, percent: 0 })
    }
    const step = (transferred: number, _chunk: number, total: number): void => {
      const now = Date.now()
      // Throttle: high-speed links fire one callback per chunk; the UI only
      // needs ~10 frames per second.
      if (now - lastEmit < 100 && transferred < total) return
      lastEmit = now
      const windowSec = (now - prevEmit) / 1000
      onProgress?.({
        phase: 'transferring',
        file,
        transferred,
        total,
        percent: total > 0 ? Math.round((transferred / total) * 1000) / 10 : 0,
        speedBps: windowSec > 0 ? Math.round((transferred - last) / windowSec) : undefined,
      })
      prevEmit = now
      last = transferred
    }
    const done = (error: unknown): void => {
      if (error !== undefined && error !== null) {
        onProgress?.({ phase: 'error', file, transferred: 0, total: 0, percent: 0, error: String(error) })
        reject(error)
      } else {
        const size = finalSize()
        onProgress?.({ phase: 'done', file, transferred: size, total: size, percent: 100 })
        resolve()
      }
    }
    if (kind === 'put') sftp.fastPut(src, dst, { concurrency, step }, done)
    else sftp.fastGet(src, dst, { concurrency, step }, done)
  })
}

function fastPut(sftp: SFTPWrapper, src: string, dst: string, concurrency: number, onProgress?: (progress: TransferProgress) => void): Promise<void> {
  return fastTransfer(sftp, 'put', src, dst, concurrency, onProgress)
}

function fastGet(sftp: SFTPWrapper, src: string, dst: string, concurrency: number, onProgress?: (progress: TransferProgress) => void): Promise<void> {
  return fastTransfer(sftp, 'get', src, dst, concurrency, onProgress)
}