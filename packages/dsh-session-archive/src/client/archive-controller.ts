/**
 * The browser-side controller: owns the API client and the store, runs the
 * chunked batch pipelines (family-partitioned for delete), computes the
 * confirm-dialog delete plan with the same core rules the host enforces, and
 * drives preview/auto-preview fetches.
 * @module @linxin666/dsh-session-archive/client/archive-controller
 */

import type { ArchiveSessionRow, BatchResponse, DeletePlanView, OpResult } from '../core/types.ts'
import { clientProtectedReason, planDelete } from '../core/cascade.ts'
import { createArchiveApi, type ArchiveApi } from './api.ts'
import { createArchiveStore, type ArchiveStoreInstance, type BatchKind } from './archive-store.ts'

/** Max sessions per HTTP chunk: bounded work per request, no per-row spam. */
const CHUNK_SIZE = 200

export interface ArchiveControllerDeps {
  api?: ArchiveApi
  store?: ArchiveStoreInstance
  /**
   * The client sessions face: the main-view Session resolver and the feed
   * refresh. The Client Session Controller carries no global selection since
   * 0.1.6-alpha.2, so the wiring resolves the main-view Session and this port
   * takes the resolved id rather than the catalog shape.
   */
  sessions?: {
    current?: () => string | undefined
    refresh?: () => Promise<void>
  }
}

/** Partition delete targets into family-intact chunks of at most CHUNK_SIZE. */
export function chunkDeleteTargets(rows: readonly ArchiveSessionRow[], targets: readonly string[]): string[][] {
  const childIds = new Map<string, readonly string[]>()
  for (const row of rows) childIds.set(row.id, row.childIds)
  const descendants = (id: string): string[] => {
    const seen = new Set<string>()
    const queue = [...(childIds.get(id) ?? [])]
    while (queue.length > 0) {
      const current = queue.pop() as string
      if (seen.has(current)) continue
      seen.add(current)
      for (const child of childIds.get(current) ?? []) {
        if (!seen.has(child)) queue.push(child)
      }
    }
    return [...seen]
  }
  const assigned = new Set<string>()
  const chunks: string[][] = []
  let current: string[] = []
  for (const id of targets) {
    if (assigned.has(id)) continue
    const family = [id, ...descendants(id).filter((member) => !assigned.has(member))]
    for (const member of family) assigned.add(member)
    if (current.length > 0 && current.length + family.length > CHUNK_SIZE) {
      chunks.push(current)
      current = []
    }
    current.push(...family)
    if (current.length >= CHUNK_SIZE) {
      chunks.push(current)
      current = []
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Plain fixed-size chunking for archive/unarchive. */
export function chunkPlain(ids: readonly string[], size = CHUNK_SIZE): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size))
  return chunks
}

export class ArchiveController {
  readonly store: ArchiveStoreInstance
  private readonly api: ArchiveApi
  private readonly sessions?: ArchiveControllerDeps['sessions']

  constructor(deps: ArchiveControllerDeps = {}) {
    this.api = deps.api ?? createArchiveApi()
    this.store = deps.store ?? createArchiveStore().create()
    this.sessions = deps.sessions
  }

  /** The main-view Session id from the sessions face, when available. */
  getCurrentSessionId(): string | undefined {
    try {
      return this.sessions?.current?.()
    } catch {
      return undefined
    }
  }

  private currentSessionId(): string | undefined {
    return this.getCurrentSessionId()
  }

  async load(): Promise<void> {
    const actions = this.store.actions
    actions.setStatus('loading', null)
    try {
      const inventory = await this.api.inventory()
      actions.setInventory(inventory)
    } catch (error) {
      actions.setStatus('error', error instanceof Error ? error.message : String(error))
    }
  }

  /** The delete plan the confirm dialog shows, from the current snapshot. */
  planDeleteFor(directIds: readonly string[]): { plan: DeletePlanView; totalBytes: number } {
    const inventory = this.store.getSnapshot().inventory
    const rows = inventory?.rows ?? []
    const protectedReason = clientProtectedReason(rows, this.currentSessionId())
    const plan = planDelete(rows, directIds, protectedReason)
    return { plan, totalBytes: plan.totalBytes }
  }

  async confirmDelete(directIds: readonly string[]): Promise<void> {
    const { plan } = this.planDeleteFor(directIds)
    const directSet = new Set(directIds)
    const strong = plan.targets.length > 50
    this.store.actions.setConfirmDelete({
      ids: [...directIds],
      total: plan.targets.length,
      descendants: plan.targets.filter((id) => !directSet.has(id)).length,
      skippedProtected: plan.skipped.length,
      totalBytes: plan.totalBytes,
      strong,
    })
  }

  /** Execute one batch kind over explicit ids, updating progress per chunk. */
  async runBatch(kind: BatchKind, directIds: readonly string[]): Promise<void> {
    const inventory = this.store.getSnapshot().inventory
    const rows = inventory?.rows ?? []
    const actions = this.store.actions
    actions.setConfirmDelete(null)

    let plannedTargets: readonly string[]
    let chunks: string[][]
    let chunkTotals: number[] | undefined
    let preSkipped: readonly OpResult[] = []
    if (kind === 'delete') {
      const protectedReason = clientProtectedReason(rows, this.currentSessionId())
      const plan = planDelete(rows, directIds, protectedReason)
      plannedTargets = plan.targets
      preSkipped = plan.skipped
      chunks = chunkDeleteTargets(rows, plannedTargets)
      chunkTotals = chunks.map((chunk) => chunk.length)
    } else {
      plannedTargets = [...new Set(directIds)]
      chunks = chunkPlain(plannedTargets)
    }
    actions.startBatch(kind, plannedTargets.length + preSkipped.length)
    if (preSkipped.length > 0) actions.batchChunk(preSkipped, 0)
    let freed = 0
    let failure: string | null = null
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index]
        let response: BatchResponse
        try {
          if (kind === 'archive') response = await this.api.archive(chunk, this.currentSessionId())
          else if (kind === 'unarchive') response = await this.api.unarchive(chunk)
          else response = await this.api.deleteSessions(chunk, this.currentSessionId(), chunkTotals?.[index] ?? chunk.length)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          actions.batchChunk(chunk.map((id) => ({ id, status: 'failed' as const, reason: 'error' as const, detail })), 0)
          if (failure === null) failure = detail
          continue
        }
        actions.batchChunk(response.results, response.freedBytes)
        freed += response.freedBytes
      }
    } finally {
      actions.finishBatch(failure, freed)
      await this.load()
      if (kind === 'delete' || kind === 'unarchive') {
        // The official sidebar/segment surfaces key off the sessions feed and
        // workspace archive set; a refresh keeps them in step after our writes.
        try {
          await this.sessions?.refresh?.()
        } catch {
          // Feed refresh is best-effort.
        }
      }
    }
  }

  /** Retry only the failed ids of the last batch, same kind. */
  async retryFailed(): Promise<void> {
    const batch = this.store.getSnapshot().batch
    if (batch === null || batch.running) return
    const failedIds = batch.results.filter((result) => result.status === 'failed').map((result) => result.id)
    if (failedIds.length === 0) return
    await this.runBatch(batch.kind, failedIds)
  }

  async openPreview(id: string): Promise<void> {
    const actions = this.store.actions
    actions.setPreview({ id, status: 'loading' })
    try {
      const data = await this.api.preview(id)
      actions.setPreview({ id, status: 'ready', data })
    } catch (error) {
      actions.setPreview({ id, status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  async refreshAutoPreview(): Promise<void> {
    const actions = this.store.actions
    actions.setAutoPreview(null, true)
    try {
      const preview = await this.api.autoPreview()
      actions.setAutoPreview(preview, false)
    } catch {
      actions.setAutoPreview(null, false)
    }
  }

  async runAuto(kind: 'archive' | 'delete'): Promise<void> {
    try {
      await this.api.autoRun(kind, this.currentSessionId())
    } catch {
      // Busy/HTTP failures surface through the refreshed run stats.
    }
    await this.load()
    await this.refreshAutoPreview()
  }
}

export type { OpResult }
