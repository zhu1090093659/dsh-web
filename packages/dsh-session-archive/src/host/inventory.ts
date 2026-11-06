/**
 * Inventory assembly: one pass over the authoritative session feed (host
 * SessionController — cold sessions included, agents never activated), the
 * workspace registry (membership + archive set), the projection-cache index
 * plus per-session projection-cache files (titles, creation facts — the
 * index only covers recent sessions), the on-disk session directories
 * (sizes, sessions missing from the feed), and the plugin's own archive-time
 * ledger. The result is the single document the browser half renders and
 * plans against.
 * @module @linxin666/dsh-session-archive/host/inventory
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArchiveIssueCode, ArchiveSessionRow, WorkspaceView } from '../core/types.ts'
import type { LedgerDocument, LedgerSource } from './ledger.ts'
import { canonicalSessionId, indexSessionDirs, type SessionDirIndex } from './session-files.ts'

/** Minimal duck-typed face of the host SessionController feed. */
export interface SessionFeedFace {
  list(request: unknown, signal: AbortSignal): Promise<{
    items?: readonly {
      sessionId?: string
      updatedAt?: number
      running?: boolean
      blank?: boolean
      parentSessionId?: string
      origin?: string
      cwd?: string
    }[]
  }>
}

/** Minimal duck-typed face of the host WorkspaceRegistry. */
export interface WorkspaceRegistryFace {
  list(): readonly { id: string; path: string; title: string; sessionIds: readonly string[] }[]
  archivedSessionIds: readonly string[]
}

export interface InventorySources {
  feed: SessionFeedFace | undefined
  registry: WorkspaceRegistryFace | undefined
  dshHome: string
  ledger: LedgerDocument
  /**
   * Optional per-id cache for the per-session projection-cache files the
   * fallback reads; the service passes one so repeated inventory passes do
   * not re-read unchanged files.
   */
  projcacheFiles?: Map<string, ProjcacheFileEntry | null>
  /**
   * Optional prebuilt sessions-root index. The service passes one so nearby
   * passes (a batch request each chunk plus the refresh that follows it) reuse
   * the same directory walk instead of re-walking an unchanged tree; absent
   * means this pass walks the tree itself.
   */
  dirIndex?: SessionDirIndex
  /**
   * Optional parsed projection-cache index. The service passes one for the
   * same reason as {@link dirIndex}: every pass would otherwise re-read and
   * re-parse the whole index document, which is the dominant remaining cost of
   * a pass whose directory walk was already reused; absent means this pass
   * reads and parses the file itself.
   */
  projcacheIndex?: ProjcacheIndex
  /**
   * Optional host-side protection facts the browser half cannot observe: live
   * SessionStore members (`attached`) and sessions a mutating operation owns
   * (`in-flight`). The service passes one so the served rows say why the host
   * will refuse to delete them; absent means rows carry no
   * {@link ArchiveSessionRow.hostProtectedReason}, exactly as before the field
   * existed.
   */
  hostProtectedReason?: ReadonlyMap<string, 'attached' | 'in-flight'>
}

/** Enrichment facts from one per-session projection-cache file. */
export interface ProjcacheFileEntry {
  title?: string
  createdAt?: number
  cwd?: string
}

/** Title/createdAt/cwd enrichment rows from the harness projection cache. */
export interface ProjcacheIndex {
  sessions: Record<string, {
    identity?: { createdAt?: number; cwd?: string }
    rows?: { title?: { val?: unknown }; goal?: { val?: unknown } }
  }>
}

/**
 * Read and parse the aggregate projection-cache index. A missing or
 * unparseable file degrades to an empty index rather than failing the pass.
 */
export function readProjcacheIndex(dshHome: string): ProjcacheIndex {
  const path = join(dshHome, 'storages', 'session_projcache.json')
  if (!existsSync(path)) return { sessions: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tables?: { sessions?: ProjcacheIndex['sessions'] } }
    return { sessions: parsed.tables?.sessions ?? {} }
  } catch {
    return { sessions: {} }
  }
}

function titleFromProjcache(entry: NonNullable<ProjcacheIndex['sessions'][string]>): string | undefined {
  const val = entry.rows?.title?.val
  return typeof val === 'string' && val !== '' ? val : undefined
}

/** Wire shape of one per-session projection-cache record (index and file agree). */
interface ProjcacheRecordShape {
  identity?: { createdAt?: unknown; cwd?: unknown }
  rows?: { title?: { val?: unknown } }
}

/**
 * The file names one session's per-session projection cache may carry. The
 * harness names the file from the id form it is holding, so a session's cache
 * lives under the canonical `session-<id>` spelling or the bare one. The
 * canonical spelling is tried first: it is what every archive id already is,
 * so a cache written under it costs exactly one read. `scrubProjcache` deletes
 * under both spellings for the same reason.
 */
function projcacheSpellings(id: string): readonly string[] {
  const canonical = canonicalSessionId(id)
  const bare = canonical.startsWith('session-') ? canonical.slice('session-'.length) : canonical
  return bare === canonical ? [canonical] : [canonical, bare]
}

/** Parse one projection-cache file; unreadable or shapeless files yield undefined. */
async function readProjcacheEntry(path: string): Promise<ProjcacheFileEntry | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { record?: ProjcacheRecordShape } & ProjcacheRecordShape
    const record: ProjcacheRecordShape = parsed.record ?? parsed
    const title = typeof record.rows?.title?.val === 'string' && record.rows.title.val !== '' ? record.rows.title.val : undefined
    const createdAt = typeof record.identity?.createdAt === 'number' ? record.identity.createdAt : undefined
    const cwd = typeof record.identity?.cwd === 'string' && record.identity.cwd !== '' ? record.identity.cwd : undefined
    if (title === undefined && createdAt === undefined && cwd === undefined) return undefined
    return {
      ...(title !== undefined ? { title } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * Fallback enrichment from one per-session projection-cache file
 * (`storages/session_projcache/sessions/<id>.json`). The aggregate index
 * only covers recent sessions, so older/archived rows fall back to these
 * files for title/createdAt/cwd. Tolerant of version and shape drift; a
 * missing or unreadable file yields undefined.
 */
export async function readProjcacheFile(dshHome: string, id: string, cache?: InventorySources['projcacheFiles']): Promise<ProjcacheFileEntry | undefined> {
  if (cache !== undefined && cache.has(id)) {
    return cache.get(id) ?? undefined
  }
  const dir = join(dshHome, 'storages', 'session_projcache', 'sessions')
  let entry: ProjcacheFileEntry | undefined
  for (const spelling of projcacheSpellings(id)) {
    entry = await readProjcacheEntry(join(dir, `${spelling}.json`))
    if (entry !== undefined) break
  }
  if (cache !== undefined) cache.set(id, entry ?? null)
  return entry
}

export interface BuiltInventory {
  rows: ArchiveSessionRow[]
  workspaces: WorkspaceView[]
  archivedSessionIds: string[]
  dirIndex: SessionDirIndex
  /**
   * Canonical row id -> the id the harness natively uses for the session.
   * Harness installs mix id spellings (feed, archive set, and store may hold
   * bare uuids while other rows carry `session-<uuid>`); every id this module
   * emits is canonical, and harness-facing calls must pass the native form.
   */
  nativeIds: Record<string, string>
}

/** Ledger entry for a session under either id spelling; canonical wins. */
export function ledgerEntryFor(ledger: LedgerDocument, canonicalId: string, nativeId?: string): { archivedAt: number; source: LedgerSource } | undefined {
  return ledger.entries[canonicalId] ?? (nativeId !== undefined && nativeId !== canonicalId ? ledger.entries[nativeId] : undefined)
}

/**
 * Build the full inventory. Rows exist only for sessions the feed lists or
 * the sessions root contains — projection-cache or ledger entries alone never
 * conjure a row (no ghosts). Rows from the feed carry reliable last-activity
 * times; disk-only rows are flagged `unreadable` metadata.
 */
export async function buildInventory(sources: InventorySources, signal: AbortSignal): Promise<BuiltInventory> {
  const now = Date.now()
  interface Draft {
    id: string
    title?: string
    createdAt?: number
    cwd?: string
    lastActivityAt?: number
    lastActivityReliable: boolean
    running: boolean
    blank: boolean
    origin?: 'subagent'
    parentId?: string
    fromFeed: boolean
    hasDir: boolean
  }
  const drafts = new Map<string, Draft>()
  const nativeIds: Record<string, string> = {}
  const add = (id: string): Draft => {
    let draft = drafts.get(id)
    if (draft === undefined) {
      draft = {
        id,
        lastActivityReliable: false,
        running: false,
        blank: false,
        fromFeed: false,
        hasDir: false,
      }
      drafts.set(id, draft)
    }
    return draft
  }

  if (sources.feed !== undefined) {
    try {
      const response = await sources.feed.list({}, signal)
      for (const item of response.items ?? []) {
        if (typeof item.sessionId !== 'string' || item.sessionId === '') continue
        // The feed mixes id spellings (bare uuids beside `session-<uuid>`);
        // canonicalize and remember the native form for harness-facing calls.
        const id = canonicalSessionId(item.sessionId)
        if (id !== item.sessionId && nativeIds[id] === undefined) nativeIds[id] = item.sessionId
        const draft = add(id)
        draft.fromFeed = true
        draft.running = item.running === true
        draft.blank = item.blank === true
        if (typeof item.updatedAt === 'number') {
          draft.lastActivityAt = item.updatedAt
          draft.lastActivityReliable = true
        }
        if (typeof item.cwd === 'string' && item.cwd !== '') draft.cwd = item.cwd
        if (typeof item.parentSessionId === 'string' && item.parentSessionId !== '') draft.parentId = canonicalSessionId(item.parentSessionId)
        if (item.origin === 'subagent') draft.origin = 'subagent'
      }
    } catch (error) {
      if (signal.aborted) throw error
      // A failing feed degrades to disk+projcache discovery; rows keep the
      // `unreadable` flag so the UI says the metadata is incomplete.
    }
  }

  const dirIndex = sources.dirIndex ?? indexSessionDirs(join(sources.dshHome, 'sessions'))
  for (const id of dirIndex.byId.keys()) add(id).hasDir = true

  const projcache = sources.projcacheIndex ?? readProjcacheIndex(sources.dshHome)
  for (const [id, entry] of Object.entries(projcache.sessions)) {
    const draft = drafts.get(id)
    if (draft === undefined) continue
    if (draft.title === undefined) draft.title = titleFromProjcache(entry)
    if (draft.createdAt === undefined && typeof entry.identity?.createdAt === 'number') draft.createdAt = entry.identity.createdAt
    if (draft.cwd === undefined && typeof entry.identity?.cwd === 'string' && entry.identity.cwd !== '') draft.cwd = entry.identity.cwd
  }

  const workspaces: WorkspaceView[] = []
  const workspaceOf = new Map<string, string[]>()
  if (sources.registry !== undefined) {
    try {
      for (const entity of sources.registry.list()) {
        workspaces.push({ id: entity.id, title: entity.title, path: entity.path, sessionIds: [...entity.sessionIds].map(canonicalSessionId) })
        for (const sessionId of entity.sessionIds) {
          const list = workspaceOf.get(canonicalSessionId(sessionId))
          if (list === undefined) workspaceOf.set(canonicalSessionId(sessionId), [entity.id])
          else if (!list.includes(entity.id)) list.push(entity.id)
        }
      }
    } catch {
      // Registry hiccup degrades to workspace-less rows; the feed remains.
    }
  }
  let archivedSessionIds: string[] = []
  if (sources.registry !== undefined) {
    try {
      archivedSessionIds = [...sources.registry.archivedSessionIds]
    } catch {
      archivedSessionIds = []
    }
  }
  // The archive set also mixes spellings; membership checks use canonical ids
  // while the wire keeps the raw list.
  const archivedSet = new Set(archivedSessionIds.map((id) => {
    const canonical = canonicalSessionId(id)
    if (canonical !== id && nativeIds[canonical] === undefined) nativeIds[canonical] = id
    return canonical
  }))
  // Historical archive entries with no storage left (no feed row, no dir)
  // still surface as rows — flagged `no-data` — so the archive view stays
  // complete and the entries can be cleaned through unarchive/delete instead
  // of silently lingering as ghosts.
  for (const id of archivedSet) {
    if (!drafts.has(id)) add(id)
  }

  // Per-session projection-cache files are the fallback enrichment for rows
  // the aggregate index does not cover (older and archived sessions). Files
  // are read only for rows still missing facts and never conjure a row.
  for (const draft of drafts.values()) {
    if (draft.title !== undefined && draft.createdAt !== undefined && draft.cwd !== undefined) continue
    if (signal.aborted) throw new Error('inventory aborted')
    const entry = await readProjcacheFile(sources.dshHome, draft.id, sources.projcacheFiles)
    if (entry === undefined) continue
    if (draft.title === undefined && entry.title !== undefined) draft.title = entry.title
    if (draft.createdAt === undefined && entry.createdAt !== undefined) draft.createdAt = entry.createdAt
    if (draft.cwd === undefined && entry.cwd !== undefined) draft.cwd = entry.cwd
  }

  const childIds = new Map<string, string[]>()
  for (const draft of drafts.values()) {
    if (draft.parentId === undefined) continue
    const list = childIds.get(draft.parentId)
    if (list === undefined) childIds.set(draft.parentId, [draft.id])
    else list.push(draft.id)
  }

  const rows: ArchiveSessionRow[] = []
  for (const draft of drafts.values()) {
    const issues: ArchiveIssueCode[] = []
    if (draft.title === undefined) issues.push('no-title')
    const archived = archivedSet.has(draft.id)
    const ledgerEntry = archived ? ledgerEntryFor(sources.ledger, draft.id, nativeIds[draft.id]) : undefined
    const archivedAt = ledgerEntry?.archivedAt
    // The source only travels with a real archive time: a row without one has
    // nothing to attribute, and the UI keys the "backfilled" marker off it.
    const archivedAtSource = ledgerEntry?.source
    if (archived && archivedAt === undefined) issues.push('no-archive-time')
    if (draft.fromFeed === false) issues.push('unreadable')
    if (draft.fromFeed === false && draft.hasDir === false) issues.push('no-data')
    const childList = childIds.get(draft.id) ?? []
    const sizeBytes = dirIndex.sizes.get(draft.id)
    const hostProtectedReason = sources.hostProtectedReason?.get(draft.id)
    rows.push({
      id: draft.id,
      ...(draft.title !== undefined ? { title: draft.title } : {}),
      ...(draft.createdAt !== undefined ? { createdAt: draft.createdAt } : {}),
      ...(draft.cwd !== undefined ? { cwd: draft.cwd } : {}),
      workspaceIds: workspaceOf.get(draft.id) ?? [],
      archived,
      ...(archivedAt !== undefined ? { archivedAt } : {}),
      ...(archivedAt !== undefined && archivedAtSource !== undefined ? { archivedAtSource } : {}),
      ...(draft.lastActivityAt !== undefined ? { lastActivityAt: draft.lastActivityAt } : {}),
      lastActivityReliable: draft.lastActivityReliable,
      ...(sizeBytes !== undefined ? { sizeBytes } : {}),
      running: draft.running,
      ...(hostProtectedReason !== undefined ? { hostProtectedReason } : {}),
      blank: draft.blank,
      ...(draft.origin !== undefined ? { origin: draft.origin } : {}),
      ...(draft.parentId !== undefined ? { parentId: draft.parentId } : {}),
      childIds: childList,
      childCount: childList.length,
      issues,
    })
  }
  rows.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.id.localeCompare(b.id))
  return { rows, workspaces, archivedSessionIds, dirIndex, nativeIds }
}

export function emptyLedger(): LedgerDocument {
  return { version: 1, entries: {} }
}
