/**
 * Shared fixture for host-side tests: a fake DSH home (sessions dirs,
 * projcache) plus duck-typed faces for the session feed, workspace registry
 * (with real durable-state semantics), and the live session store.
 * @module tests/fixtures.ts
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LedgerDocument } from '../src/host/ledger.ts'
import type { InventorySources } from '../src/host/inventory.ts'

export interface FeedItem {
  sessionId: string
  updatedAt: number
  running?: boolean
  blank?: boolean
  parentSessionId?: string
  origin?: string
  cwd?: string
}

export interface FixtureWorkspace {
  id: string
  path: string
  title: string
  sessionIds: string[]
}

export interface FakeRegistryState {
  initialized: boolean
  workspaceIds: string[]
  archivedSessionIds: string[]
}

export interface FakeHost {
  home: string
  feedItems: FeedItem[]
  liveIds: string[]
  persistedIds: string[]
  /** Sessions whose `inspect` should fail (unreadable preview). */
  brokenIds: string[]
  registry: {
    state: FakeRegistryState
    workspaces: FixtureWorkspace[]
    list(): FixtureWorkspace[]
    get archivedSessionIds(): string[]
    archiveSession(id: string): Promise<void>
    unarchiveSession(id: string): Promise<void>
    mutatedWorkspaces: string[]
  }
  sources(): InventorySources
  ledger: LedgerDocument
}

export function createFakeHost(options: {
  feedItems?: FeedItem[]
  workspaces?: FixtureWorkspace[]
  liveIds?: string[]
  persistedIds?: string[]
  brokenIds?: string[]
  archivedSessionIds?: string[]
  dirs?: string[]
} = {}): FakeHost {
  const home = mkdtempSync(join(tmpdir(), 'dsh-session-archive-'))
  const sessionsRoot = join(home, 'sessions')
  mkdirSync(sessionsRoot, { recursive: true })
  const project = join(sessionsRoot, '--Users-demo--')
  mkdirSync(project, { recursive: true })
  for (const id of options.dirs ?? []) {
    const dir = join(project, id.startsWith('session-') ? id.slice('session-'.length) : id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.alloc(64, 7))
  }
  const storages = join(home, 'storages')
  mkdirSync(storages, { recursive: true })

  const feedItems = options.feedItems ?? []
  const persistedIds = options.persistedIds ?? []
  const brokenIds = options.brokenIds ?? []
  const state: FakeRegistryState = {
    initialized: true,
    workspaceIds: (options.workspaces ?? []).map((workspace) => workspace.id),
    archivedSessionIds: [...(options.archivedSessionIds ?? [])],
  }
  const workspaces = (options.workspaces ?? []).map((workspace) => {
    const record: FixtureWorkspace & {
      mutate?(fn: (record: FixtureWorkspace) => FixtureWorkspace): Promise<void>
    } = { ...workspace }
    record.mutate = async (fn) => {
      const next = fn({ id: record.id, path: record.path, title: record.title, sessionIds: [...record.sessionIds] })
      record.path = next.path
      record.title = next.title
      record.sessionIds = [...next.sessionIds]
      mutatedWorkspaces.push(record.id)
    }
    return record
  })
  const mutatedWorkspaces: string[] = []

  const known = (id: string): boolean =>
    feedItems.some((item) => item.sessionId === id) || persistedIds.includes(id)

  const registry = {
    state,
    workspaces,
    mutatedWorkspaces,
    list(): FixtureWorkspace[] {
      return workspaces
    },
    get archivedSessionIds(): string[] {
      return [...state.archivedSessionIds]
    },
    async archiveSession(id: string): Promise<void> {
      if (!known(id)) throw new Error(`WorkspaceUnknownSessionError: ${id}`)
      if (!state.archivedSessionIds.includes(id)) state.archivedSessionIds = [...state.archivedSessionIds, id]
    },
    // The 0.1.6 cohort added this public verb; it is idempotent for an id that
    // is not archived, exactly like the host implementation.
    async unarchiveSession(id: string): Promise<void> {
      state.archivedSessionIds = state.archivedSessionIds.filter((entry) => entry !== id)
    },
  }

  const host: FakeHost = {
    home,
    feedItems,
    liveIds: options.liveIds ?? [],
    persistedIds,
    brokenIds,
    registry,
    ledger: { version: 1, entries: {} },
    sources() {
      return {
        feed: {
          async list() {
            return { items: feedItems }
          },
        },
        registry: registry as unknown as InventorySources['registry'],
        dshHome: home,
        ledger: host.ledger,
      }
    },
  }
  return host
}

/** Write a projcache index file with the given session entries. */
export function writeProjcache(home: string, sessions: Record<string, { title?: string; createdAt?: number; cwd?: string }>): void {
  const payload = {
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: {
      sessions: Object.fromEntries(
        Object.entries(sessions).map(([id, entry]) => [
          id,
          {
            ...(entry.createdAt !== undefined || entry.cwd !== undefined
              ? { identity: { ...(entry.createdAt !== undefined ? { createdAt: entry.createdAt } : {}), ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}) } }
              : {}),
            rows: { ...(entry.title !== undefined ? { title: { ver: 1, seq: 1, val: entry.title } } : {}) },
          },
        ]),
      ),
    },
  }
  writeFileSync(join(home, 'storages', 'session_projcache.json'), JSON.stringify(payload))
}

/** Write one per-session projection-cache file (version 4 record shape). */
export function writeProjcacheSessionFile(home: string, id: string, entry: { title?: string; createdAt?: number; cwd?: string }): void {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  const payload = {
    version: 4,
    record: {
      identity: {
        ...(entry.createdAt !== undefined ? { createdAt: entry.createdAt } : {}),
        ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
      },
      rows: { ...(entry.title !== undefined ? { title: { ver: 4, seq: 1, val: entry.title } } : {}) },
    },
  }
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(payload))
}

/** The fake host context the ArchiveService reads through ctx.get(...) and
 * direct property access (`ctx.workspaceRegistry`). Service faces are stable
 * objects, so callers can monkey-patch methods between get() calls. */
export function fakeContext(host: FakeHost): unknown {
  const sessionController = {
    async list() {
      return { items: host.feedItems }
    },
    async inspect(sessionId: string) {
      if (host.brokenIds.includes(sessionId)) throw new Error('unreadable log')
      const item = host.feedItems.find((entry) => entry.sessionId === sessionId)
      return {
        meta: { createdAt: item?.updatedAt ?? 0, cwd: item?.cwd },
        events: [
          { type: 'user/message', data: { text: 'hello' } },
          { type: 'assistant/message', data: { content: 'world' } },
        ],
      }
    },
  }
  const liveStore = {
    list: () => host.liveIds.map((id) => ({ id })),
    get: (id: string) => (host.liveIds.includes(id) ? { id } : undefined),
  }
  return {
    workspaceRegistry: host.registry,
    sessions: liveStore,
    get(name: string): unknown {
      if (name === 'sessionController') return sessionController
      if (name === 'workspaceRegistry') return host.registry
      if (name === 'sessions') return liveStore
      return undefined
    },
  }
}
