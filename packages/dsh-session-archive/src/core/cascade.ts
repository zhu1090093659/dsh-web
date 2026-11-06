/**
 * Family cascade and delete planning over inventory rows. Pure logic shared
 * by the host (authoritative plan) and the browser half (confirm-dialog
 * preview), so the numbers a user confirms are computed by the same rules
 * the host enforces.
 * @module @linxin666/dsh-session-archive/core/cascade
 */

import type { ArchiveSessionRow, DeletePlanView, OpResult } from './types.ts'

/** All descendants of one id via the `childIds` edges (excluding the id itself). */
export function descendantsOf(rows: readonly ArchiveSessionRow[], id: string): string[] {
  const childIds = new Map<string, readonly string[]>()
  for (const row of rows) childIds.set(row.id, row.childIds)
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

/**
 * Authoritative delete plan. Rules:
 * - A direct id missing from the inventory is skipped as `not-found`.
 * - A direct id that is itself protected is skipped with its own reason; its
 *   family is left untouched.
 * - A family (direct id plus all descendants) containing ANY protected member
 *   is skipped whole with `family-protected` — never a half-deleted family.
 * - Every id appears at most once in `skipped`; a directly selected protected
 *   id keeps its own reason even when a relative's family also covers it.
 * - Everything else in the union of safe families is deleted.
 */
export function planDelete(
  rows: readonly ArchiveSessionRow[],
  directIds: readonly string[],
  protectedReason: ReadonlyMap<string, string>,
): DeletePlanView {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const targets = new Set<string>()
  const skipped: OpResult[] = []
  const skippedIds = new Set<string>()
  const directSet = new Set(directIds)
  const seenDirect = new Set<string>()
  /** Record one skip once: an id reachable through several families stays single. */
  const pushSkipped = (entry: OpResult): void => {
    if (skippedIds.has(entry.id)) return
    skippedIds.add(entry.id)
    skipped.push(entry)
  }
  for (const id of directIds) {
    if (seenDirect.has(id)) continue
    seenDirect.add(id)
    const row = byId.get(id)
    if (row === undefined) {
      pushSkipped({ id, status: 'skipped', reason: 'not-found' })
      continue
    }
    const ownReason = protectedReason.get(id)
    if (ownReason !== undefined) {
      pushSkipped({ id, status: 'skipped', reason: ownReason as OpResult['reason'] })
      continue
    }
    const family = [id, ...descendantsOf(rows, id)]
    const blocker = family.find((member) => protectedReason.has(member))
    if (blocker !== undefined) {
      for (const member of family) {
        if (targets.has(member) || skippedIds.has(member)) continue
        // A directly selected protected member reports its own reason in its
        // own iteration; the coarser family entry must not claim it first.
        if (directSet.has(member) && protectedReason.has(member)) continue
        pushSkipped({ id: member, status: 'skipped', reason: 'family-protected', detail: `${blocker}:${protectedReason.get(blocker)}` })
      }
      continue
    }
    for (const member of family) targets.add(member)
  }
  let totalBytes = 0
  for (const id of targets) {
    const size = byId.get(id)?.sizeBytes
    if (typeof size === 'number') totalBytes += size
  }
  return {
    direct: [...seenDirect],
    descendants: [...targets].filter((id) => !seenDirect.has(id)),
    skipped,
    targets: [...targets],
    totalBytes,
  }
}

/**
 * Precedence among the protection facts that can cover one session, ordered
 * exactly like the host's authoritative map: a live-store attachment outranks
 * the feed's `running` flag, the session being viewed outranks an attachment,
 * and an in-flight operation outranks everything else. {@link planDelete}
 * reports one reason per id, so the browser half must resolve a conflict the
 * same way or its skip list would disagree with the host's.
 */
const PROTECTION_RANK: Record<string, number> = { running: 1, attached: 2, current: 3, 'in-flight': 4 }

/**
 * Protected-reason map for preview surfaces. `running` and `current` are facts
 * the browser half observes itself; `attached` and `in-flight` come from the
 * row's {@link ArchiveSessionRow.hostProtectedReason}, which an older host does
 * not send — those rows simply stay unprotected here, and the host still
 * refuses them authoritatively.
 */
export function clientProtectedReason(
  rows: readonly ArchiveSessionRow[],
  currentSessionId: string | undefined,
): Map<string, string> {
  const map = new Map<string, string>()
  const mark = (id: string, reason: string): void => {
    const held = map.get(id)
    if (held !== undefined && (PROTECTION_RANK[held] ?? 0) >= (PROTECTION_RANK[reason] ?? 0)) return
    map.set(id, reason)
  }
  for (const row of rows) {
    if (row.running) mark(row.id, 'running')
    if (row.hostProtectedReason !== undefined) mark(row.id, row.hostProtectedReason)
  }
  if (currentSessionId !== undefined && currentSessionId !== '') mark(currentSessionId, 'current')
  return map
}

/**
 * True when the host protects every selected session. The batch delete
 * affordance is disabled in exactly that case: a selection the host would skip
 * whole has nothing left to act on.
 */
export function selectionFullyProtected(
  ids: readonly string[],
  protectedReason: ReadonlyMap<string, string>,
): boolean {
  return ids.length > 0 && ids.every((id) => protectedReason.has(id))
}
