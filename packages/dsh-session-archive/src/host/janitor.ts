/**
 * The dsh-session-archive host service. Owns the archive-time ledger, the
 * batch archive/restore/physical-delete pipelines, the automatic policy
 * cycles, and the scheduler. Mutating operations serialize through one
 * operation lock; every per-session step is failure-isolated so one broken
 * session never aborts a batch; physical deletion follows the strict order
 * archive markers -> workspace rows -> storage (rdb rows, files) -> projection
 * cache -> ledger, so an interrupted batch can only ever leave a session
 * present-but-unlisted (retryable), never half-deleted.
 * @module @linxin666/dsh-session-archive/host/janitor
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  autoArchiveCandidates,
  autoDeleteSeedCandidates,
} from '../core/auto-rules.ts'
import { planDelete } from '../core/cascade.ts'
import { resolveAutoConfig, type ResolvedAutoConfig } from '../core/config.ts'
import type {
  ArchiveSessionRow,
  AutoPreviewView,
  AutoStateView,
  BatchResponse,
  InventoryView,
  OpResult,
  RunStats,
  SessionPreviewView,
  WorkspaceView,
} from '../core/types.ts'
import { buildInventory, ledgerEntryFor, readProjcacheIndex, type InventorySources, type ProjcacheFileEntry } from './inventory.ts'
import {
  capEntries,
  deserializeAutoState,
  deserializeLedger,
  writeJsonAtomic,
  type AutoStateDocument,
  type LedgerDocument,
} from './ledger.ts'
import { canonicalSessionId, deleteRdbSession, isSessionRdb, rdbDbPaths, removeSessionDir } from './session-files.ts'
import { dshHome as resolveDshHome } from '../dsh-home.ts'
import { archiveSession, removeFromWorkspaceRows, unarchiveSessions, unarchiveSeamAvailable } from './workspace-store.ts'

/** Thrown when the caller's expected delete total disagrees with the host plan. */
export class PlanMismatchError extends Error {
  readonly plan: ReturnType<typeof planDelete>
  constructor(plan: ReturnType<typeof planDelete>) {
    super('delete plan mismatch')
    this.plan = plan
  }
}

/** Thrown when another mutating operation holds the lock. */
export class BusyError extends Error {
  constructor() {
    super('another archive operation is running')
  }
}

/** Optional face of the live session store (`ctx.sessions`), used defensively. */
interface LiveStoreFace {
  list?(): unknown[]
  get?(id: string): unknown
}

export interface ArchiveServiceOptions {
  dshHome?: string
}

const PREVIEW_MESSAGE_CAP = 6
const PREVIEW_TEXT_CAP = 400

export class ArchiveService {
  private readonly ctx: Context
  private readonly dshHome: string
  private readonly ledgerPath: string
  private readonly statePath: string

  private ledger: LedgerDocument = { version: 1, entries: {} }
  private autoState: AutoStateDocument = { version: 1 }
  private config: ResolvedAutoConfig = resolveAutoConfig(undefined)
  /** Per-session projection-cache file facts, memoized across inventory passes. */
  private readonly projcacheFiles = new Map<string, ProjcacheFileEntry | null>()

  private loaded = false
  private disposed = false
  /** Fail-fast flag: mutating operations reject with BusyError while held. */
  private lockHeld = false
  /** Sessions currently inside an archive/restore/delete pipeline. */
  private readonly busy = new Set<string>()
  private cycleRunning = false
  private schedulerTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context, options: ArchiveServiceOptions = {}) {
    this.ctx = ctx
    this.dshHome = options.dshHome ?? resolveDshHome()
    this.ledgerPath = join(this.dshHome, 'dsh-session-archive', 'archive-ledger.json')
    this.statePath = join(this.dshHome, 'dsh-session-archive', 'state.json')
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async start(): Promise<void> {
    const [rawLedger, rawState] = await Promise.all([
      this.readFile(this.ledgerPath),
      this.readFile(this.statePath),
    ])
    if (rawLedger !== undefined) {
      try {
        this.ledger = deserializeLedger(rawLedger)
      } catch {
        this.ledger = { version: 1, entries: {} }
      }
    }
    if (rawState !== undefined) {
      try {
        this.autoState = deserializeAutoState(rawState)
      } catch {
        this.autoState = { version: 1 }
      }
    }
    this.loaded = true
    this.armScheduler(true)
  }

  stop(): void {
    this.disposed = true
    if (this.schedulerTimer !== undefined) clearTimeout(this.schedulerTimer)
    this.schedulerTimer = undefined
  }

  applyConfig(raw: unknown): void {
    this.config = resolveAutoConfig(raw as ResolvedAutoConfig)
    if (this.loaded) this.armScheduler(false)
  }

  get autoConfig(): ResolvedAutoConfig {
    return this.config
  }

  /** Read-only ledger view for tests and diagnostics. */
  ledgerSnapshot(): LedgerDocument {
    return this.ledger
  }

  // ------------------------------------------------------------------
  // Persistence helpers
  // ------------------------------------------------------------------

  private readFile(path: string): Promise<string | undefined> {
    return import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8')).catch(() => undefined)
  }

  private async flushLedger(): Promise<void> {
    if (!this.loaded) return
    await writeJsonAtomic(this.ledgerPath, this.ledger).catch(() => {})
  }

  private async flushState(): Promise<void> {
    if (!this.loaded) return
    await writeJsonAtomic(this.statePath, this.autoState).catch(() => {})
  }

  // ------------------------------------------------------------------
  // Sources and protection
  // ------------------------------------------------------------------

  private sources(): InventorySources {
    const feed = this.serviceFace<{ list(request: unknown, signal: AbortSignal): Promise<{ items?: unknown[] }> }>('sessionController')
    const registry = this.serviceFace<{ list(): unknown[]; archivedSessionIds: readonly string[] }>('workspaceRegistry')
    return {
      feed: feed as never,
      registry: registry as never,
      dshHome: this.dshHome,
      ledger: this.ledger,
      projcacheFiles: this.projcacheFiles,
    }
  }

  private serviceFace<T>(name: string): T | undefined {
    try {
      return (this.ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
    } catch {
      return undefined
    }
  }

  /** Live session ids (attached in this host process) — treated as in-use. */
  private liveSessionIds(): Set<string> {
    const store = this.serviceFace<LiveStoreFace>('sessions')
    const ids = new Set<string>()
    if (store === undefined || typeof store.list !== 'function') return ids
    try {
      for (const session of store.list() ?? []) {
        const id = (session as { id?: unknown })?.id
        if (typeof id === 'string') ids.add(canonicalSessionId(id))
      }
    } catch {
      // A failing store read degrades to feed-only protection.
    }
    return ids
  }

  /** Protection map shared by manual delete and auto cycles. */
  private protectedReason(currentSessionId: string | undefined, rows?: readonly ArchiveSessionRow[]): Map<string, string> {
    const map = new Map<string, string>()
    // Live-store members are held open by the running harness process even
    // when the feed reports them idle — a distinct, honest skip reason.
    for (const id of this.liveSessionIds()) map.set(id, 'attached')
    // Feed-reported running agents are protected even when the live store
    // lookup fails or lags.
    if (rows !== undefined) {
      for (const row of rows) {
        if (row.running && !map.has(row.id)) map.set(row.id, 'running')
      }
    }
    // The client reports the current session in the harness's native spelling;
    // rows are canonical.
    if (currentSessionId !== undefined && currentSessionId !== '') map.set(canonicalSessionId(currentSessionId), 'current')
    for (const id of this.busy) map.set(id, 'in-flight')
    return map
  }

  private statsFrom(results: readonly OpResult[], at: number): RunStats {
    let ok = 0
    let skipped = 0
    let failed = 0
    const entries: OpResult[] = []
    for (const result of results) {
      if (result.status === 'ok') ok += 1
      else if (result.status === 'skipped') {
        skipped += 1
        entries.push(result)
      } else {
        failed += 1
        entries.push(result)
      }
    }
    return { at, total: results.length, ok, skipped, failed, entries: capEntries(entries) }
  }

  // ------------------------------------------------------------------
  // Inventory
  // ------------------------------------------------------------------

  async inventory(): Promise<InventoryView> {
    const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
    const workspaces: WorkspaceView[] = built.workspaces
    return {
      generatedAt: Date.now(),
      rows: built.rows,
      workspaces,
      archivedSessionIds: built.archivedSessionIds,
      auto: this.autoView(),
    }
  }

  autoView(): AutoStateView {
    return {
      ...(this.autoState.lastArchiveRun !== undefined ? { lastArchiveRun: this.autoState.lastArchiveRun } : {}),
      ...(this.autoState.lastDeleteRun !== undefined ? { lastDeleteRun: this.autoState.lastDeleteRun } : {}),
      ...(this.autoState.nextCheckAt !== undefined ? { nextCheckAt: this.autoState.nextCheckAt } : {}),
      cycleRunning: this.cycleRunning,
    }
  }

  // ------------------------------------------------------------------
  // Archive / unarchive
  // ------------------------------------------------------------------

  /** Fail-fast mutual exclusion: concurrent mutating callers get BusyError. */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.lockHeld) return Promise.reject(new BusyError())
    this.lockHeld = true
    const run = (async () => fn())()
    const release = (): void => {
      this.lockHeld = false
    }
    run.then(release, release)
    return run
  }

  async archive(ids: readonly string[], source: 'manual' | 'auto', currentSessionId?: string): Promise<BatchResponse> {
    return this.withLock(async () => {
      const results: OpResult[] = []
      const now = Date.now()
      const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
      const byId = new Map(built.rows.map((row) => [row.id, row]))
      for (const id of ids) {
        const row = byId.get(id)
        if (row === undefined) {
          results.push({ id, status: 'skipped', reason: 'not-found' })
          continue
        }
        if (row.archived) {
          results.push({ id, status: 'skipped', reason: 'already-archived' })
          continue
        }
        if (source === 'auto') {
          const protectedMap = this.protectedReason(currentSessionId, built.rows)
          const reason = protectedMap.get(id)
          if (reason !== undefined) {
            results.push({ id, status: 'skipped', reason: reason as OpResult['reason'] })
            continue
          }
        }
        this.busy.add(id)
        try {
          // The registry records the harness's native id spelling; rows and
          // ledger keys stay canonical.
          await archiveSession(this.ctx, built.nativeIds[id] ?? id)
          this.ledger.entries[id] = { archivedAt: now, source }
          results.push({ id, status: 'ok' })
        } catch (error) {
          results.push({ id, status: 'failed', reason: 'error', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) })
        } finally {
          this.busy.delete(id)
        }
      }
      await this.flushLedger()
      return { results, freedBytes: 0 }
    })
  }

  async unarchive(ids: readonly string[]): Promise<BatchResponse> {
    return this.withLock(async () => {
      const results: OpResult[] = []
      const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
      const byId = new Map(built.rows.map((row) => [row.id, row]))
      const toUnarchive: string[] = []
      for (const id of ids) {
        const row = byId.get(id)
        if (row === undefined) {
          results.push({ id, status: 'skipped', reason: 'not-found' })
          continue
        }
        if (!row.archived) {
          results.push({ id, status: 'skipped', reason: 'not-archived' })
          continue
        }
        toUnarchive.push(id)
      }
      try {
        await unarchiveSessions(this.ctx.workspaceRegistry, toUnarchive)
        for (const id of toUnarchive) {
          delete this.ledger.entries[id]
          const native = built.nativeIds[id]
          if (native !== undefined && native !== id) delete this.ledger.entries[native]
          results.push({ id, status: 'ok' })
        }
      } catch (error) {
        for (const id of toUnarchive) {
          results.push({ id, status: 'failed', reason: 'missing-seam', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) })
        }
      }
      await this.flushLedger()
      return { results, freedBytes: 0 }
    })
  }

  // ------------------------------------------------------------------
  // Physical delete
  // ------------------------------------------------------------------

  /**
   * Plan and execute one physical-delete batch. The plan is computed from a
   * fresh inventory with the full protection map; `expectedTotal` (the number
   * the user confirmed) must match or the whole batch aborts with a plan
   * mismatch so the UI can re-confirm.
   */
  async deleteSessions(ids: readonly string[], options: { currentSessionId?: string; expectedTotal?: number; source?: 'manual' | 'auto' } = {}): Promise<BatchResponse> {
    return this.withLock(async () => {
      const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
      const protectedMap = this.protectedReason(options.currentSessionId, built.rows)
      const plan = planDelete(built.rows, ids, protectedMap)
      // A mismatch only matters when the host would delete MORE than the user
      // confirmed. Fewer targets mean the host protected sessions the client
      // did not know about — those surface as skipped results, never as an
      // error that blocks the whole batch.
      if (typeof options.expectedTotal === 'number' && plan.targets.length > options.expectedTotal) {
        throw new PlanMismatchError(plan)
      }
      if (!unarchiveSeamAvailable(this.ctx.workspaceRegistry)) {
        return {
          results: plan.targets.map((id) => ({ id, status: 'failed' as const, reason: 'missing-seam' as const, detail: 'workspace registry seam unavailable' })),
          freedBytes: 0,
        }
      }
      for (const id of plan.targets) this.busy.add(id)
      try {
        return await this.executeDelete(plan, built, options.source ?? 'manual')
      } finally {
        for (const id of plan.targets) this.busy.delete(id)
      }
    })
  }

  /**
   * The deletion pipeline, in the crash-safe order: archive markers, then
   * workspace rows, then per-session storage (rdb rows and files), then the
   * projection cache, then the archive ledger. A crash between steps leaves
   * the session unlisted but present — a retry finishes the job; it never
   * leaves a half-deleted session behind.
   */
  private async executeDelete(
    plan: ReturnType<typeof planDelete>,
    built: Awaited<ReturnType<typeof buildInventory>>,
    source: 'manual' | 'auto',
  ): Promise<BatchResponse> {
    const results = new Map<string, OpResult>()
    const targets = plan.targets
    const sizeById = new Map(built.rows.map((row) => [row.id, row.sizeBytes]))

    // 1. Archive markers (single durable write).
    try {
      await unarchiveSessions(this.ctx.workspaceRegistry, targets)
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 200) : String(error)
      return { results: targets.map((id) => ({ id, status: 'failed' as const, reason: 'missing-seam' as const, detail })), freedBytes: 0 }
    }

    // 2. Workspace rows.
    try {
      await removeFromWorkspaceRows(this.ctx.workspaceRegistry, targets)
    } catch {
      // Row cleanup failure does not stop storage deletion; the projection
      // already drops ids whose header is gone, and the next retry cleans up.
    }

    // 3. Storage: rdb rows and/or the session directory.
    const rdbPaths = rdbDbPaths(this.dshHome).filter((path) => isSessionRdb(path))
    const rowById = new Map(built.rows.map((row) => [row.id, row]))
    const deleted = new Set<string>()
    for (const id of targets) {
      try {
        const native = built.nativeIds[id]
        for (const dbPath of rdbPaths) {
          deleteRdbSession(dbPath, id)
          if (native !== undefined && native !== id) deleteRdbSession(dbPath, native)
        }
        const dir = built.dirIndex.byId.get(id)
        if (dir !== undefined) {
          removeSessionDir(dir, join(this.dshHome, 'sessions'))
        } else if (rdbPaths.length === 0 && rowById.get(id)?.issues.includes('no-data') !== true) {
          // The feed still lists this session but no storage answered —
          // refusing keeps the feed and the disk consistent.
          results.set(id, { id, status: 'failed', reason: 'unreadable', detail: 'no session storage found' })
          continue
        }
        deleted.add(id)
        results.set(id, { id, status: 'ok' })
      } catch (error) {
        results.set(id, { id, status: 'failed', reason: 'error', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      }
    }

    // 4. Projection cache (index entry + per-session file), both spellings.
    await this.scrubProjcache(deleted, built.nativeIds)

    // 5. Archive ledger, both spellings.
    for (const id of deleted) {
      delete this.ledger.entries[id]
      const native = built.nativeIds[id]
      if (native !== undefined && native !== id) delete this.ledger.entries[native]
    }
    await this.flushLedger()

    let freedBytes = 0
    for (const id of deleted) {
      const size = sizeById.get(id)
      if (typeof size === 'number') freedBytes += size
    }
    void source
    // Protected members never entered the target set; surface their skip
    // reasons next to the per-target results.
    return { results: [...plan.skipped, ...targets.map((id): OpResult => results.get(id) ?? { id, status: 'failed', reason: 'error' })], freedBytes }
  }

  /** Best-effort projection-cache scrub; a stale cache entry is cosmetic. */
  private async scrubProjcache(ids: ReadonlySet<string>, nativeIds: Record<string, string> = {}): Promise<void> {
    const indexPath = join(this.dshHome, 'storages', 'session_projcache.json')
    try {
      if (existsSync(indexPath)) {
        const parsed = JSON.parse(this.readSync(indexPath)) as { tables?: { sessions?: Record<string, unknown> } }
        const sessions = parsed.tables?.sessions
        if (sessions !== undefined) {
          for (const id of ids) {
            delete sessions[id]
            const native = nativeIds[id]
            if (native !== undefined && native !== id) delete sessions[native]
          }
          // Awaited so the scrub lands on disk before deleteSessions reports
          // success; a fire-and-forget write raced the caller's readers.
          await writeJsonAtomic(indexPath, parsed)
        }
      }
    } catch {
      // A corrupt index is left alone; the harness owns it.
    }
    const perSessionDir = join(this.dshHome, 'storages', 'session_projcache', 'sessions')
    try {
      for (const id of ids) {
        for (const spelling of [id, nativeIds[id]]) {
          if (spelling === undefined) continue
          const file = join(perSessionDir, `${spelling}.json`)
          if (existsSync(file)) unlinkSync(file)
        }
      }
    } catch {
      // Same best-effort contract.
    }
  }

  private readSync(path: string): string {
    // Small synchronous read for the scrub; failure paths are guarded.
    return readFileSync(path, 'utf8')
  }

  // ------------------------------------------------------------------
  // Automatic policies
  // ------------------------------------------------------------------

  async autoPreview(): Promise<AutoPreviewView> {
    const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
    const now = Date.now()
    const protectedSet = new Set(this.protectedReason(undefined, built.rows).keys())
    const archiveCandidates = this.config.autoArchiveEnabled
      ? autoArchiveCandidates(built.rows, { days: this.config.autoArchiveDays, now, protectedIds: protectedSet })
      : []
    const deleteSeeds = this.config.autoDeleteEnabled
      ? autoDeleteSeedCandidates(built.rows, { retainDays: this.config.autoDeleteDays, now, runStartedAt: now, protectedIds: protectedSet })
      : []
    const plan = planDelete(built.rows, deleteSeeds.map((seed) => seed.id), this.protectedReason(undefined, built.rows))
    let deleteBytes = 0
    for (const id of plan.targets) {
      const size = built.rows.find((row) => row.id === id)?.sizeBytes
      if (typeof size === 'number') deleteBytes += size
    }
    return {
      archiveCandidates,
      deleteCandidates: plan.targets
        .map((id) => {
          const row = built.rows.find((entry) => entry.id === id)
          return { id, archivedAt: row?.archivedAt ?? 0, ...(row?.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes } : {}) }
        }),
      deleteBytes,
    }
  }

  /**
   * Run one automatic cycle now (scheduler tick or manual trigger). The two
   * policies are independent: archive seeds from last-activity, delete seeds
   * from the recorded archive time strictly before this cycle started, so a
   * session archived by this very cycle is never deleted in it.
   */
  async runAutoCycle(kind: 'archive' | 'delete', currentSessionId?: string): Promise<RunStats> {
    return this.withLock(async () => {
      this.cycleRunning = true
      const startedAt = Date.now()
      try {
        if (kind === 'archive') {
          const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
          const protectedSet = new Set(this.protectedReason(currentSessionId, built.rows).keys())
          const candidates = autoArchiveCandidates(built.rows, { days: this.config.autoArchiveDays, now: startedAt, protectedIds: protectedSet })
          const response = await this.archiveInternal(candidates.map((entry) => entry.id), 'auto', currentSessionId)
          const stats = this.statsFrom(response.results, startedAt)
          this.autoState.lastArchiveRun = stats
          await this.flushState()
          return stats
        }
        const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
        const protectedMap = this.protectedReason(currentSessionId, built.rows)
        const protectedSet = new Set(protectedMap.keys())
        const seeds = autoDeleteSeedCandidates(built.rows, { retainDays: this.config.autoDeleteDays, now: startedAt, runStartedAt: startedAt, protectedIds: protectedSet })
        if (seeds.length === 0) {
          const stats: RunStats = { at: startedAt, total: 0, ok: 0, skipped: 0, failed: 0, entries: [] }
          this.autoState.lastDeleteRun = stats
          await this.flushState()
          return stats
        }
        const plan = planDelete(built.rows, seeds.map((seed) => seed.id), protectedMap)
        const response = await this.executeDelete(plan, built, 'auto')
        const stats = this.statsFrom(response.results, startedAt)
        this.autoState.lastDeleteRun = stats
        await this.flushState()
        return stats
      } finally {
        this.cycleRunning = false
      }
    })
  }

  /** Archive without re-acquiring the lock (used inside cycles). */
  private async archiveInternal(ids: readonly string[], source: 'manual' | 'auto', currentSessionId?: string): Promise<BatchResponse> {
    const results: OpResult[] = []
    const now = Date.now()
    for (const id of ids) {
      this.busy.add(id)
      try {
        await archiveSession(this.ctx, id)
        this.ledger.entries[id] = { archivedAt: now, source }
        results.push({ id, status: 'ok' })
      } catch (error) {
        results.push({ id, status: 'failed', reason: 'error', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      } finally {
        this.busy.delete(id)
      }
    }
    await this.flushLedger()
    return { results, freedBytes: 0 }
  }

  // ------------------------------------------------------------------
  // Scheduler
  // ------------------------------------------------------------------

  private armScheduler(catchUp: boolean): void {
    if (this.schedulerTimer !== undefined) clearTimeout(this.schedulerTimer)
    if (this.disposed) return
    const intervalMs = Math.max(15, this.config.checkIntervalMin) * 60_000
    const due = this.autoState.nextCheckAt
    // Catch-up: a persisted next check in the past fires shortly after boot.
    const delay = catchUp && due !== undefined && due <= Date.now()
      ? 2_000
      : Math.max(2_000, due === undefined ? intervalMs : due - Date.now())
    this.autoState.nextCheckAt = Date.now() + delay
    void this.flushState()
    this.schedulerTimer = setTimeout(() => {
      void this.tick()
    }, delay)
  }

  private async tick(): Promise<void> {
    if (this.disposed) return
    const anythingEnabled = this.config.autoArchiveEnabled || this.config.autoDeleteEnabled
    if (anythingEnabled) {
      // runAutoCycle serializes through the lock; a held lock (manual batch)
      // delays this cycle without failing it — catch-up happens next tick.
      const currentSessionId = undefined
      try {
        if (this.config.autoArchiveEnabled) await this.runAutoCycle('archive', currentSessionId)
      } catch (error) {
        if (!(error instanceof BusyError)) {
          this.autoState.lastArchiveRun = {
            at: Date.now(),
            total: 0, ok: 0, skipped: 0, failed: 1,
            entries: [{ id: 'cycle', status: 'failed', reason: 'error', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) }],
          }
          await this.flushState()
        }
      }
      try {
        if (this.config.autoDeleteEnabled) await this.runAutoCycle('delete', currentSessionId)
      } catch (error) {
        if (!(error instanceof BusyError)) {
          this.autoState.lastDeleteRun = {
            at: Date.now(),
            total: 0, ok: 0, skipped: 0, failed: 1,
            entries: [{ id: 'cycle', status: 'failed', reason: 'error', detail: error instanceof Error ? error.message.slice(0, 200) : String(error) }],
          }
          await this.flushState()
        }
      }
    }
    this.autoState.nextCheckAt = Date.now() + Math.max(15, this.config.checkIntervalMin) * 60_000
    await this.flushState()
    this.armScheduler(false)
  }

  // ------------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------------

  async preview(id: string): Promise<SessionPreviewView> {
    const controller = this.serviceFace<{ inspect?(sessionId: string, signal?: AbortSignal): Promise<{ meta?: { createdAt?: number; cwd?: string }; events?: readonly unknown[] }> }>('sessionController')
    const built = await buildInventory(this.sources(), AbortSignal.timeout(30_000))
    const row: ArchiveSessionRow | undefined = built.rows.find((entry) => entry.id === id)
    if (row === undefined) {
      throw new Error('session not found')
    }
    let meta = { createdAt: row.createdAt, cwd: row.cwd }
    let excerpt: SessionPreviewView['excerpt'] = []
    let messageCount = 0
    if (controller !== undefined && typeof controller.inspect === 'function') {
      try {
        // The harness knows the session under its native id spelling.
        const inspect = await controller.inspect(built.nativeIds[id] ?? id, AbortSignal.timeout(15_000))
        if (meta.createdAt === undefined && inspect.meta?.createdAt !== undefined) meta = { ...meta, createdAt: inspect.meta.createdAt }
        if (meta.cwd === undefined && inspect.meta?.cwd !== undefined) meta = { ...meta, cwd: inspect.meta.cwd }
        const messages = extractMessages(inspect.events ?? [])
        messageCount = messages.total
        excerpt = messages.excerpt
      } catch {
        // Preview failure keeps the basic-info view; the UI offers a retry.
      }
    }
    return {
      id,
      ...(row.title !== undefined ? { title: row.title } : {}),
      ...(meta.createdAt !== undefined ? { createdAt: meta.createdAt } : {}),
      ...(meta.cwd !== undefined ? { cwd: meta.cwd } : {}),
      ...(row.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes } : {}),
      messageCount,
      excerpt,
    }
  }
}

/**
 * Tolerant message extraction from session events: user/assistant message
 * events with string or block-array content. Unknown shapes are ignored, so
 * a malformed event never breaks the preview.
 */
export function extractMessages(events: readonly unknown[]): { total: number; excerpt: { role: string; text: string }[] } {
  const excerpt: { role: string; text: string }[] = []
  let total = 0
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const record = event as { type?: unknown; data?: unknown }
    if (typeof record.type !== 'string') continue
    if (record.type !== 'user/message' && record.type !== 'assistant/message') continue
    const text = messageText(record.data)
    if (text === undefined) continue
    total += 1
    if (excerpt.length < PREVIEW_MESSAGE_CAP) {
      excerpt.push({ role: record.type === 'user/message' ? 'user' : 'assistant', text: text.length > PREVIEW_TEXT_CAP ? `${text.slice(0, PREVIEW_TEXT_CAP)}…` : text })
    }
  }
  return { total, excerpt }
}

function messageText(data: unknown): string | undefined {
  if (typeof data === 'string') return data
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as { text?: unknown; content?: unknown; message?: unknown }
  if (typeof record.text === 'string') return record.text
  const content = record.content ?? record.message
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') parts.push(block)
      else if (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string') {
        parts.push((block as { text: string }).text)
      }
    }
    const joined = parts.join('\n').trim()
    return joined === '' ? undefined : joined
  }
  return undefined
}
