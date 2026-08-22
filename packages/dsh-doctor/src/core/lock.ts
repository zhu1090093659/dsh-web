/**
 * Advisory lock manager for repair operations.
 *
 * Locks are directories under the capsule locks root with a token.json
 * inside; directory creation is atomic, so concurrent acquirers cannot both
 * win. Stale detection uses the token's heartbeat plus a pid-alive probe;
 * stealing renames the whole lock dir aside and retries once.
 */
import { join } from 'node:path'
import type { FsLike } from './fs.ts'
import { locksDir } from './paths.ts'
import type { LockScope, LockState, LockToken } from './types.ts'

export class LockError extends Error {
  readonly code: 'LOCK_HELD' | 'LOCK_STALE' | 'LOCK_LOST' | 'LOCK_ERROR'
  readonly scope: LockScope
  readonly key: string
  constructor(code: 'LOCK_HELD' | 'LOCK_STALE' | 'LOCK_LOST' | 'LOCK_ERROR', scope: LockScope, key: string, detail: string) {
    super('lock ' + scope + ':' + key + ': ' + detail)
    this.name = 'LockError'
    this.code = code
    this.scope = scope
    this.key = key
  }
}

export interface LockManagerDeps {
  fs: FsLike
  home: string
  /** Process id recorded in the token; defaults to 0 (tests). */
  pid?: number
  /** Host name recorded in the token; defaults to 'local'. */
  host?: string
  /** Milliseconds clock for heartbeat and staleness checks. */
  clock(): number
  /** ISO timestamp for token.startedAt. */
  iso(): string
  /** Alive probe for stale detection; defaults to 'always dead'. */
  pidAlive?(pid: number): boolean
  /** Sleep injection for polling loops; defaults to a real timer. */
  sleep?(ms: number): Promise<void>
}

export interface AcquireOptions {
  intent: string
  timeoutMs?: number
  staleMs?: number
  heartbeatMs?: number
}

export interface LockHandle {
  readonly scope: LockScope
  readonly key: string
  readonly path: string
  release(): Promise<void>
  touch(now: number): Promise<void>
}

export interface LockManager {
  acquire(scope: LockScope, profile: string | undefined, options: AcquireOptions): Promise<LockHandle>
  status(scope: LockScope, profile: string | undefined): Promise<LockState>
  release(handle: LockHandle): Promise<void>
}

const DEFAULT_STALE_MS = 15000
const DEFAULT_TIMEOUT_MS = 30000
const lockKey = (scope: LockScope, profile: string | undefined): string => (scope === 'global' ? 'global' : 'profile/' + profile)

/** Create a lock manager rooted under the capsule locks dir. */
export function createLockManager(deps: LockManagerDeps): LockManager {
  const fs = deps.fs
  const root = locksDir(deps.home)
  const pid = deps.pid ?? 0
  const host = deps.host ?? 'local'
  const now = deps.clock
  const iso = deps.iso
  const pidAlive = deps.pidAlive ?? (() => false)
  const sleep = deps.sleep ?? (async (ms: number) => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  })

  const acquire = async (scope: LockScope, profile: string | undefined, options: AcquireOptions): Promise<LockHandle> => {
    const key = lockKey(scope, profile)
    const path = join(root, key.replace(/\//g, '__'))
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const deadline = now() + timeoutMs
    for (;;) {
      let exists: boolean
      try {
        exists = await fs.exists(path)
      } catch (error) {
        throw new LockError('LOCK_ERROR', scope, key, String(error))
      }
      if (!exists) {
        try {
          const claimed = await claim(scope, key, path, options.intent)
          if (claimed !== undefined) return claimed
        } catch (error) {
          throw new LockError('LOCK_ERROR', scope, key, String(error))
        }
      } else {
        const observed = await readTokenOrNull(path)
        if (isTokenStale(observed, staleMs)) {
          // The owner may refresh or be replaced after the first observation.
          // Revalidate the same lease immediately before moving the directory.
          const confirmed = await readTokenOrNull(path)
          if (!isSameStaleLease(observed, confirmed, staleMs)) {
            if (now() >= deadline) {
              if (confirmed !== undefined) throw new LockError('LOCK_HELD', scope, key, 'held by pid ' + confirmed.pid + ' (intent ' + confirmed.intent + ')')
              throw new LockError('LOCK_STALE', scope, key, 'lock ownership changed while checking staleness')
            }
            await sleep(100)
            continue
          }
          const stealTo = path + '.stale-' + String(now())
          try {
            await fs.rename(path, stealTo)
          } catch (error) {
            const released = isMissingError(error) || await fs.exists(path).then((exists) => !exists, () => false)
            if (isExistsError(error) || released) {
              // Another acquirer stole, created, or released; continue polling.
              continue
            } else {
              throw new LockError('LOCK_STALE', scope, key, 'stale lock could not be displaced: ' + String(error))
            }
          }
          const displaced = await readTokenOrNull(stealTo)
          if (!isSameStaleLease(confirmed, displaced, staleMs)) {
            const occupied = await fs.exists(path).catch(() => true)
            if (!occupied) {
              try {
                await fs.rename(stealTo, path)
              } catch (error) {
                throw new LockError('LOCK_STALE', scope, key, 'lock refreshed during takeover and could not be restored: ' + String(error))
              }
            } else {
              throw new LockError('LOCK_STALE', scope, key, 'lock refreshed during takeover after the canonical path was reclaimed')
            }
            await sleep(100)
            continue
          }
          if (displaced?.released === true) await fs.remove(stealTo, { recursive: true }).catch(() => undefined)
          try {
            const claimed = await claim(scope, key, path, options.intent)
            if (claimed !== undefined) return claimed
          } catch (error) {
            throw new LockError('LOCK_STALE', scope, key, 'stale lock was displaced but replacement failed: ' + String(error))
          }
        }
      }
      if (now() >= deadline) {
        const state = await readTokenOrNull(path)
        if (state !== undefined) throw new LockError('LOCK_HELD', scope, key, 'held by pid ' + state.pid + ' (intent ' + state.intent + ')')
        throw new LockError('LOCK_STALE', scope, key, 'lock present without a readable token')
      }
      await sleep(100)
    }
  }

  const buildToken = (intent: string): LockToken => ({
    pid,
    host,
    intent,
    startedAt: iso(),
    heartbeatAt: now(),
    nonce: Math.random().toString(36).slice(2, 10),
  })

  const claim = async (scope: LockScope, key: string, path: string, intent: string): Promise<LockHandle | undefined> => {
    const token = buildToken(intent)
    const temporary = path + '.claim-' + String(pid) + '-' + token.nonce
    let temporaryCreated = false
    try {
      await fs.mkdir(root, { recursive: true })
      await fs.mkdir(temporary)
      temporaryCreated = true
      await fs.writeText(join(temporary, 'token.json'), JSON.stringify(token, undefined, 2) + String.fromCharCode(10))
      await fs.rename(temporary, path)
      temporaryCreated = false
      return makeHandle(scope, key, path, token.nonce)
    } catch (error) {
      if (temporaryCreated) await fs.remove(temporary, { recursive: true }).catch(() => undefined)
      const targetExists = await fs.exists(path).catch(() => false)
      if (isExistsError(error) || targetExists) return undefined
      throw error
    }
  }

  const isTokenStale = (token: LockToken | undefined, staleMs: number): boolean => {
    if (token === undefined) return true
    if (token.released === true) return true
    if (!pidAlive(token.pid)) return true
    return now() - token.heartbeatAt > staleMs
  }

  const isSameStaleLease = (observed: LockToken | undefined, confirmed: LockToken | undefined, staleMs: number): boolean => {
    if (observed === undefined) return confirmed === undefined
    return confirmed !== undefined && confirmed.nonce === observed.nonce && isTokenStale(confirmed, staleMs)
  }

  let touchSequence = 0

  const makeHandle = (scope: LockScope, key: string, path: string, nonce: string): LockHandle => {
    let released = false
    let operationQueue = Promise.resolve()

    const ownedToken = async (): Promise<LockToken> => {
      if (released) throw new LockError('LOCK_LOST', scope, key, 'lock handle has already been released')
      const token = await readTokenOrNull(path)
      if (token === undefined) throw new LockError('LOCK_LOST', scope, key, 'lock dir or token vanished')
      if (token.nonce !== nonce) throw new LockError('LOCK_LOST', scope, key, 'lock ownership moved to a different nonce')
      if (token.released === true) throw new LockError('LOCK_LOST', scope, key, 'lock lease has already been released')
      return token
    }

    const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = operationQueue
      let unlock!: () => void
      operationQueue = new Promise<void>((resolve) => { unlock = resolve })
      await previous
      try {
        return await operation()
      } finally {
        unlock()
      }
    }

    const publishOwnedToken = async (token: LockToken, kind: 'touch' | 'release'): Promise<void> => {
      const temporary = join(path, 'token.' + nonce + '.' + kind + '-' + String(touchSequence += 1))
      try {
        await fs.writeText(temporary, JSON.stringify(token, undefined, 2) + String.fromCharCode(10))
        // Bind publication to the same directory generation. If takeover
        // moved it aside, this check fails and the temporary moves with it.
        await ownedToken()
        await fs.rename(temporary, join(path, 'token.json'))
      } catch (error) {
        const current = await readTokenOrNull(path)
        if (current === undefined || current.nonce !== nonce || current.released === true) {
          throw new LockError('LOCK_LOST', scope, key, 'lock ownership changed while publishing ' + kind)
        }
        throw error
      } finally {
        await fs.remove(temporary).catch(() => undefined)
      }
    }

    return {
      scope,
      key,
      path,
      async touch(at: number) {
        await runExclusive(async () => {
          const token = await ownedToken()
          await publishOwnedToken({ ...token, heartbeatAt: at }, 'touch')
        })
      },
      async release() {
        await runExclusive(async () => {
          if (released) return
          const token = await ownedToken()
          // Never recursively delete the canonical path: a stale takeover can
          // replace it between any check and deletion. Publishing a released
          // lease uses the same generation-bound atomic update as touch().
          await publishOwnedToken({ ...token, heartbeatAt: now(), released: true }, 'release')
          released = true
        })
      },
    }
  }

  const status = async (scope: LockScope, profile: string | undefined): Promise<LockState> => {
    const key = lockKey(scope, profile)
    const path = join(root, key.replace(/\//g, '__'))
    const token = await readTokenOrNull(path)
    if (token === undefined || token.released === true) return { scope, key, path, held: false }
    return { scope, key, path, held: true, token }
  }

  const release = async (handle: LockHandle): Promise<void> => {
    await handle.release()
  }

  async function readTokenOrNull(path: string): Promise<LockToken | undefined> {
    try {
      const text = await fs.readText(join(path, 'token.json'))
      return JSON.parse(text) as LockToken
    } catch (error) {
      if (isMissingError(error)) return undefined
      return undefined
    }
  }

  return { acquire, status, release }
}

function isExistsError(error: unknown): boolean {
  const code = (error as { code?: string }).code
  return code === 'EEXIST' || (error instanceof Error && /exists/i.test(error.message))
}

function isMissingError(error: unknown): boolean {
  const code = (error as { code?: string }).code
  return code === 'ENOENT'
}
