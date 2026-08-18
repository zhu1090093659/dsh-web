/**
 * SFTP transfers: upload (file or recursive tree), single-file download, and
 * remote directory listing. Every channel is opened once per operation and
 * released exactly once so sshd's MaxSessions cap is never exhausted.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
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
      else if (stat.isFile()) files.push(relative(root, full))
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
    let files: string[]
    if (stat.isDirectory()) {
      if (!recursive) throw new Error('\'' + localPath + '\' is a directory — enable recursive upload')
      files = walkLocalDir(local)
      await ensureRemoteDir(sftp, remotePath)
    } else {
      files = ['']
      await ensureRemoteDir(sftp, dirname(remotePath))
    }
    let bytes = 0
    for (const rel of files) {
      const src = rel === '' ? local : join(local, rel)
      // Remote paths always use forward slashes; normalize any OS separators.
      const remoteRel = rel.split(/[\\/]/).join('/')
      const dst = rel === '' ? remotePath : remotePath.replace(/\/$/, '') + '/' + remoteRel
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

/** Create a remote directory chain (stat-then-mkdir per segment). */
function ensureRemoteDir(sftp: SFTPWrapper, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const segments = remote.replace(/^\/+/, '').split('/').filter(segment => segment !== '')
    const walk = (index: number): void => {
      if (index >= segments.length) {
        resolve()
        return
      }
      const current = '/' + segments.slice(0, index + 1).join('/')
      sftp.stat(current, (statError) => {
        if (statError === undefined) {
          walk(index + 1)
          return
        }
        // Statting a missing path fails; mkdir it (idempotent because the
        // stat check runs first — some sftp servers throw on EEXIST).
        sftp.mkdir(current, (mkdirError) => {
          if (mkdirError !== undefined) {
            reject(mkdirError)
            return
          }
          walk(index + 1)
        })
      })
    }
    walk(0)
  })
}

/** One fastPut/fastGet transfer with throttled progress (the two directions share everything but the verb). */
function fastTransfer(sftp: SFTPWrapper, kind: 'put' | 'get', src: string, dst: string, concurrency: number, onProgress?: (progress: TransferProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // Progress frames name the destination on upload, the source on download;
    // the final size comes from the local side of the transfer.
    const file = kind === 'put' ? dst : src
    const finalSize = (): number => statSync(kind === 'put' ? src : dst).size
    let last = 0
    let lastEmit = 0
    const started = Date.now()
    if (kind === 'put') {
      onProgress?.({ phase: 'transferring', file, transferred: 0, total: statSync(src).size, percent: 0 })
    }
    const step = (transferred: number, _chunk: number, total: number): void => {
      const now = Date.now()
      // Throttle: high-speed links fire one callback per chunk; the UI only
      // needs ~10 frames per second.
      if (now - lastEmit < 100 && transferred < total) return
      lastEmit = now
      const elapsed = (now - started) / 1000
      onProgress?.({
        phase: 'transferring',
        file,
        transferred,
        total,
        percent: total > 0 ? Math.round((transferred / total) * 1000) / 10 : 0,
        speedBps: elapsed > 0 ? Math.round((transferred - last) / elapsed) : undefined,
      })
      last = transferred
    }
    const done = (error: unknown): void => {
      if (error !== undefined) {
        onProgress?.({ phase: 'error', file, transferred: 0, total: 0, percent: 0, error: String(error) })
        reject(error)
      } else {
        onProgress?.({ phase: 'done', file, transferred: finalSize(), total: finalSize(), percent: 100 })
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