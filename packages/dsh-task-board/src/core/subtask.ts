/**
 * Subtask lineage: the depth gate, the ancestry/descendant queries, the
 * cascade participant set one run request opens, the deferred settlement of a
 * cascade parent, and the execution-target inheritance a subtask resolves at
 * run time.
 *
 * Framework-free (no cordis, no runtime imports) so every rule is
 * unit-testable in isolation. The Host ledger is the only authority; the
 * browser mirrors these predicates to enable or disable controls, never to
 * decide them.
 */
import type { ExecutionOutcome, ExecutionRecord, TaskRecord } from './tasks.ts'

/** Lowest configurable subtask depth. */
export const SUBTASK_DEPTH_MIN = 1
/** Highest configurable subtask depth. */
export const SUBTASK_DEPTH_MAX = 3
/** Deployment default: one level of subtasks, and no subtask of a subtask. */
export const DEFAULT_SUBTASK_DEPTH = 1

/**
 * Clamp a configured depth into the supported range. Anything unusable
 * (absent, non-numeric, not finite) falls back to the default, so a bad
 * configuration narrows the tree instead of lifting the guard.
 */
export function normalizeSubtaskDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SUBTASK_DEPTH
  const depth = Math.trunc(value)
  if (depth < SUBTASK_DEPTH_MIN) return SUBTASK_DEPTH_MIN
  if (depth > SUBTASK_DEPTH_MAX) return SUBTASK_DEPTH_MAX
  return depth
}

/** Whether an unknown value is a settled execution outcome. */
export function isExecutionOutcome(value: unknown): value is ExecutionOutcome {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled'
}

function indexOf(tasks: readonly TaskRecord[]): Map<string, TaskRecord> {
  return new Map(tasks.map(task => [task.id, task]))
}

/**
 * Nearest-first ancestor chain of a task. The walk is cycle-safe and bounded
 * by the ledger size rather than by the deployment maximum: a chain stored
 * under a larger limit survives that limit being lowered, and restore and
 * inheritance must still see all of it.
 */
export function ancestorChain(tasks: readonly TaskRecord[], task: TaskRecord): TaskRecord[] {
  const index = indexOf(tasks)
  const chain: TaskRecord[] = []
  const seen = new Set<string>([task.id])
  let current = task.parentId === undefined ? undefined : index.get(task.parentId)
  while (current !== undefined && chain.length < tasks.length) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    current = current.parentId === undefined ? undefined : index.get(current.parentId)
  }
  return chain
}

/** Root-to-task depth: a root task is 0, its subtask 1, and so on. */
export function taskDepth(tasks: readonly TaskRecord[], id: string): number {
  const task = indexOf(tasks).get(id)
  return task === undefined ? 0 : ancestorChain(tasks, task).length
}

/** Direct subtasks of a task, in ledger order. */
export function directSubtasks(tasks: readonly TaskRecord[], id: string): TaskRecord[] {
  return tasks.filter(task => task.parentId === id)
}

/**
 * Descendants of a task in breadth-first order, bounded by maxSubtaskDepth
 * total depth. The visited set keeps a malformed ledger from looping.
 */
export function descendantTasks(tasks: readonly TaskRecord[], id: string, maxSubtaskDepth: number): TaskRecord[] {
  const visited = new Set<string>([id])
  const found: TaskRecord[] = []
  let frontier = [id]
  for (let depth = 1; depth <= maxSubtaskDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const parentId of frontier) {
      for (const task of tasks) {
        if (task.parentId !== parentId || visited.has(task.id)) continue
        visited.add(task.id)
        found.push(task)
        next.push(task.id)
      }
    }
    frontier = next
  }
  return found
}

/**
 * Height of a task's own subtree (0 for a leaf), bounded by the hard maximum.
 * The visited set makes the walk terminate on a cyclic hand-edited ledger
 * instead of recursing until the stack overflows.
 */
export function subtreeHeight(tasks: readonly TaskRecord[], id: string, visited: ReadonlySet<string> = new Set<string>()): number {
  if (visited.has(id)) return 0
  const seen = new Set([...visited, id])
  const children = directSubtasks(tasks, id)
  if (children.length === 0) return 0
  let height = 0
  for (const child of children) height = Math.max(height, 1 + subtreeHeight(tasks, child.id, seen))
  return Math.min(height, SUBTASK_DEPTH_MAX)
}

/** Why a parent link was refused; also the source of the Host error text. */
export type ParentLinkRejection =
  | 'unknown-task'
  | 'unknown-parent'
  | 'archived-parent'
  | 'self-parent'
  | 'cycle'
  | 'depth-exceeded'

export interface ParentLinkCheck {
  /** True when the link (or the detachment) may be stored. */
  ok: boolean
  /** Why it was refused; absent when ok. */
  reason?: ParentLinkRejection
}

/**
 * Whether childId may be attached under parentId. A null parent detaches and
 * is always allowed for a known task. Otherwise the link must name an
 * on-board task that is neither the child itself nor one of its descendants,
 * and the resulting depth (parent depth + 1 + the child own subtree height)
 * must stay within maxSubtaskDepth.
 */
export function checkParentLink(
  tasks: readonly TaskRecord[],
  childId: string,
  parentId: string | null,
  maxSubtaskDepth: number,
): ParentLinkCheck {
  const child = tasks.find(task => task.id === childId)
  if (child === undefined) return { ok: false, reason: 'unknown-task' }
  if (parentId === null || parentId === '') return { ok: true }
  if (parentId === childId) return { ok: false, reason: 'self-parent' }
  const parent = tasks.find(task => task.id === parentId)
  if (parent === undefined) return { ok: false, reason: 'unknown-parent' }
  if (parent.archivedAt !== undefined) return { ok: false, reason: 'archived-parent' }
  if (descendantTasks(tasks, childId, SUBTASK_DEPTH_MAX).some(task => task.id === parentId)) return { ok: false, reason: 'cycle' }
  const depth = taskDepth(tasks, parentId) + 1 + subtreeHeight(tasks, childId)
  if (depth > maxSubtaskDepth) return { ok: false, reason: 'depth-exceeded' }
  return { ok: true }
}

/**
 * The tasks one run request opens executions for: the requested task first,
 * then its on-board descendants within the configured depth. Archived tasks
 * never run; a participant that already has an open execution is skipped by
 * the caller, which cannot start it twice.
 */
export function cascadeTargets(
  tasks: readonly TaskRecord[],
  rootId: string,
  maxSubtaskDepth: number,
): TaskRecord[] {
  const root = tasks.find(task => task.id === rootId)
  if (root === undefined) return []
  return [root, ...descendantTasks(tasks, rootId, maxSubtaskDepth)]
}

/** One still-open execution belonging to a cascade run group. */
export interface OpenCascadeChild {
  taskId: string
  execution: ExecutionRecord
}

/** The open execution of a task inside a run group, if it still exists. */
export function openGroupExecution(task: TaskRecord, runGroupId: string): ExecutionRecord | undefined {
  return task.executions.find(execution => execution.runGroupId === runGroupId && execution.endedAt === undefined)
}

/**
 * The direct subtasks of parentTaskId whose execution in this run group is
 * still open: the parent remaining waiters. The parent may settle once this
 * list is empty and its own outcome is known.
 */
export function pendingCascadeChildren(
  tasks: readonly TaskRecord[],
  parentTaskId: string,
  runGroupId: string,
): OpenCascadeChild[] {
  const pending: OpenCascadeChild[] = []
  for (const task of tasks) {
    if (task.parentId !== parentTaskId) continue
    const execution = openGroupExecution(task, runGroupId)
    if (execution !== undefined) pending.push({ taskId: task.id, execution })
  }
  return pending
}

/**
 * Fold a cascade parent own outcome and its children outcomes into one
 * verdict: failure dominates, then cancellation, then success. The error text
 * is the first failure, falling back to the first cancellation.
 */
export function combineCascadeOutcome(
  entries: readonly { result: ExecutionOutcome; error?: string }[],
): { result: ExecutionOutcome; error: string | undefined } {
  let result: ExecutionOutcome = 'succeeded'
  let error: string | undefined
  for (const entry of entries) {
    if (entry.result === 'failed') {
      if (result !== 'failed') error = undefined
      result = 'failed'
      if (error === undefined && entry.error !== undefined && entry.error !== '') error = entry.error
      continue
    }
    if (entry.result === 'cancelled') {
      if (result === 'succeeded') result = 'cancelled'
      if (error === undefined && entry.error !== undefined && entry.error !== '') error = entry.error
    }
  }
  return error === undefined ? { result, error: undefined } : { result, error }
}

/**
 * The permission a task would actually run under: its handover bundle's pin
 * wins over the plain pin field, exactly as the runner resolves it.
 */
export function effectiveTaskPermission(task: TaskRecord): TaskRecord['permission'] {
  return task.handover?.permission ?? task.permission
}

/**
 * Resolve the execution targets a (sub)task actually runs with: its own value
 * wins, and an unset target inherits the nearest ancestor up to the root.
 * Workspace, agent preset and model inherit the ancestor's PIN only — a
 * handover bundle is a per-card continuation artefact and is never inherited.
 * The permission inherits the ancestor's EFFECTIVE binding, and its human
 * confirmation travels with it, so a subtask of an already-confirmed elevated
 * card is runnable while a subtask's own unconfirmed binding stays gated.
 */
/**
 * FNV-1a (32-bit) rendered as eight lower-case hex characters. A pure,
 * dependency-free digest keeps this module inside the browser program, which
 * may not import `node:crypto`; the name only needs a stable, well-spread
 * discriminator, not a cryptographic one.
 * @param value - the string to digest.
 * @returns eight lower-case hex characters.
 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The immutable teammate name for one team-mode member. Teammate names are
 * lower-kebab-case, at most 64 characters and unique for the lifetime of the
 * Team, so BOTH discriminators are appended:
 *
 * - the run-group token, so two runs of the same tree never collide;
 * - a digest of the member's own identity, so two members of the SAME run never
 *   collide. A title with no ASCII word characters (a CJK title, for example)
 *   slugs to the empty string, and every such title would otherwise share the
 *   one generic prefix inside its run — the second spawn is then refused with
 *   `TEAM_MEMBER_NAME_TAKEN`. Two members may also share a title outright, so
 *   the discriminator is derived from the member identity rather than the title.
 *
 * @param title - the member task's title.
 * @param token - the run group id (the task id when no group is recorded).
 * @param memberId - the member's stable identity: its task id.
 * @returns the teammate name handed to the Agent Teams service.
 */
export function teammateName(title: string, token: string, memberId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '')
  const suffix = token.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()
  return `${slug === '' ? 'subtask' : slug}-${suffix === '' ? 'run' : suffix}-${shortHash(memberId)}`
}

export function resolveExecutionTargets(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  maxSubtaskDepth: number = SUBTASK_DEPTH_MAX,
): TaskRecord {
  if (task.parentId === undefined) return task
  const chain = [task, ...ancestorChain(tasks, task).slice(0, maxSubtaskDepth)]
  const first = (key: 'workspaceId' | 'mode' | 'model'): string | undefined => {
    for (const candidate of chain) {
      const value = candidate[key]
      if (value !== undefined) return value
    }
    return undefined
  }
  const own = effectiveTaskPermission(task)
  // An own binding (pin or handover) keeps its own confirmation stamp; only an
  // absent one borrows the ancestor's binding AND that ancestor's stamp.
  const owner = own === undefined
    ? chain.slice(1).find(candidate => effectiveTaskPermission(candidate) !== undefined)
    : undefined
  return {
    ...task,
    workspaceId: first('workspaceId'),
    mode: first('mode'),
    model: first('model'),
    permission: own ?? (owner === undefined ? undefined : effectiveTaskPermission(owner)),
    permissionConfirmedAt: own === undefined ? owner?.permissionConfirmedAt : task.permissionConfirmedAt,
  }
}
