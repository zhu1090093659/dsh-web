/**
 * Subtask lineage: the depth gate, the ancestry/descendant queries, the
 * outstanding-descendant decision one run request makes, the deferred
 * settlement of a historical run group, and the execution-target inheritance a
 * subtask resolves at run time.
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

/**
 * Reusable lineage index over ONE task list: the id lookup and the direct
 * children per parent. A caller that runs several lineage queries over the same
 * ledger (the link-subtask candidate gate runs one per task) builds this once
 * instead of rescanning the list per query.
 */
export interface LineageIndex {
  readonly byId: ReadonlyMap<string, TaskRecord>
  readonly childrenByParent: ReadonlyMap<string, readonly TaskRecord[]>
}

/** Build the reusable index for a task list (ledger order preserved). */
export function buildLineageIndex(tasks: readonly TaskRecord[]): LineageIndex {
  const byId = new Map<string, TaskRecord>()
  const childrenByParent = new Map<string, TaskRecord[]>()
  for (const task of tasks) {
    byId.set(task.id, task)
    if (task.parentId === undefined) continue
    const siblings = childrenByParent.get(task.parentId)
    if (siblings === undefined) childrenByParent.set(task.parentId, [task])
    else siblings.push(task)
  }
  return { byId, childrenByParent }
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
export function ancestorChain(tasks: readonly TaskRecord[], task: TaskRecord, lineage?: LineageIndex): TaskRecord[] {
  const index = lineage?.byId ?? indexOf(tasks)
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
export function taskDepth(tasks: readonly TaskRecord[], id: string, lineage?: LineageIndex): number {
  const task = (lineage?.byId ?? indexOf(tasks)).get(id)
  return task === undefined ? 0 : ancestorChain(tasks, task, lineage).length
}

/** Direct subtasks of a task, in ledger order. */
export function directSubtasks(tasks: readonly TaskRecord[], id: string, lineage?: LineageIndex): TaskRecord[] {
  if (lineage !== undefined) return [...(lineage.childrenByParent.get(id) ?? [])]
  return tasks.filter(task => task.parentId === id)
}

/**
 * Descendants of a task in breadth-first order, bounded by maxSubtaskDepth
 * total depth. The visited set keeps a malformed ledger from looping.
 */
export function descendantTasks(tasks: readonly TaskRecord[], id: string, maxSubtaskDepth: number, lineage?: LineageIndex): TaskRecord[] {
  const visited = new Set<string>([id])
  const found: TaskRecord[] = []
  let frontier = [id]
  for (let depth = 1; depth <= maxSubtaskDepth && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const parentId of frontier) {
      const children = lineage === undefined
        ? tasks.filter(task => task.parentId === parentId)
        : lineage.childrenByParent.get(parentId) ?? []
      for (const task of children) {
        if (visited.has(task.id)) continue
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
export function subtreeHeight(tasks: readonly TaskRecord[], id: string, visited: ReadonlySet<string> = new Set<string>(), lineage?: LineageIndex): number {
  if (visited.has(id)) return 0
  const seen = new Set([...visited, id])
  const children = directSubtasks(tasks, id, lineage)
  if (children.length === 0) return 0
  let height = 0
  for (const child of children) height = Math.max(height, 1 + subtreeHeight(tasks, child.id, seen, lineage))
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
  lineage?: LineageIndex,
): ParentLinkCheck {
  const child = lineage === undefined ? tasks.find(task => task.id === childId) : lineage.byId.get(childId)
  if (child === undefined) return { ok: false, reason: 'unknown-task' }
  if (parentId === null || parentId === '') return { ok: true }
  if (parentId === childId) return { ok: false, reason: 'self-parent' }
  const parent = lineage === undefined ? tasks.find(task => task.id === parentId) : lineage.byId.get(parentId)
  if (parent === undefined) return { ok: false, reason: 'unknown-parent' }
  if (parent.archivedAt !== undefined) return { ok: false, reason: 'archived-parent' }
  if (descendantTasks(tasks, childId, SUBTASK_DEPTH_MAX, lineage).some(task => task.id === parentId)) return { ok: false, reason: 'cycle' }
  const depth = taskDepth(tasks, parentId, lineage) + 1 + subtreeHeight(tasks, childId, new Set<string>(), lineage)
  if (depth > maxSubtaskDepth) return { ok: false, reason: 'depth-exceeded' }
  return { ok: true }
}

/**
 * The tasks one run request opens executions for: the requested card ALONE.
 *
 * Running a card never expands into its subtask tree. The card's own session
 * reads its subtasks through the board tools and dispatches subagents itself,
 * so a parent run opens exactly one session. Clicking a subtask runs that
 * subtask as its own root, again without expanding its own descendants. The
 * lineage queries around this one answer questions about the tree the card's
 * agent works with (who is still outstanding, what a historical run group
 * still holds open) — never who gets a session from the Host.
 * @param tasks - the ledger.
 * @param rootId - the task the run request named.
 * @returns the one card this run opens an execution for, or [] when unknown.
 */
export function cascadeTargets(tasks: readonly TaskRecord[], rootId: string): TaskRecord[] {
  const root = tasks.find(task => task.id === rootId)
  return root === undefined ? [] : [root]
}

/**
 * A task together with every descendant within the configured depth: the
 * subtree a lineage gate (archive, restore, force-close) has to walk.
 */
export function subtreeTasks(tasks: readonly TaskRecord[], id: string, maxSubtaskDepth: number): TaskRecord[] {
  const root = tasks.find(task => task.id === id)
  return root === undefined ? [] : [root, ...descendantTasks(tasks, id, maxSubtaskDepth)]
}

/**
 * Whether a card still has work outstanding: anything outside the `done`
 * column. It keys on the column alone, so it covers both a subtask that ran
 * and one an operator moved to done by hand.
 */
export function isOutstanding(task: TaskRecord): boolean {
  return task.status !== 'done'
}

/**
 * The descendants of a card that still have work outstanding, in breadth-first
 * order: the cards its own session is expected to dispatch. An archived
 * descendant is off the board and cannot be dispatched, so it is not listed.
 */
export function outstandingDescendants(
  tasks: readonly TaskRecord[],
  rootId: string,
  maxSubtaskDepth: number,
): TaskRecord[] {
  return descendantTasks(tasks, rootId, maxSubtaskDepth)
    .filter(task => task.archivedAt === undefined && isOutstanding(task))
}

/**
 * Whether any descendant of this card still sits outside the `done` column.
 * This is the ONE decision behind both the forced agent preset and the dispatch
 * section of the execution prompt: a card whose tree still holds work runs as
 * the autonomous dispatcher.
 */
export function hasOutstandingDescendants(
  tasks: readonly TaskRecord[],
  rootId: string,
  maxSubtaskDepth: number,
): boolean {
  return outstandingDescendants(tasks, rootId, maxSubtaskDepth).length > 0
}

/**
 * Agent preset a run with unfinished subtasks is forced under. The id comes
 * from packages/dsh-liangshen (its own `LIANGSHEN_PRESET_ID`); the force is
 * applied at launch and never written into a card's `mode` field.
 */
export const LIANGSHEN_PRESET_ID = 'liangshen'

/**
 * The tool a legacy Agent Teams runtime registers, and the one fingerprint
 * this board reads off a deployment: the pre-#7519 generation registers
 * `spawn_teammate` and replaces `send_message` / `list_agents` /
 * `interrupt_agent` with team-scoped variants, so children exist but are
 * unreachable. The current runtime adds a shared task board instead and reuses
 * the coordination tools, so those three names prove nothing and are never
 * gated on (the criterion is the same one
 * `packages/dsh-liangshen/presets/liangshen/dispatcher-rules.mjs` states).
 */
export const LEGACY_AGENT_TEAMS_TOOL = 'spawn_teammate'

/**
 * The failure text the Host records when a run would have been forced under
 * the dispatcher preset on a deployment that cannot orchestrate.
 *
 * A finished sentence rather than a code (the shape `core/workspace-target.ts`
 * gives its missing-workspace refusal): the ledger stores it as the
 * execution's failure text, the agent tools serve it to a model, and any
 * client prints it verbatim. It names the fix, not the mechanism. The launch
 * is refused before any session exists, because the dispatcher preset would
 * otherwise stop and wait for a human reply that an unattended run never
 * brings.
 */
export const LEGACY_AGENT_TEAMS_REASON = 'this deployment runs the legacy Agent Teams runtime, which cannot dispatch a card that has unfinished subtasks under the ' + LIANGSHEN_PRESET_ID + ' preset; disable that runtime and restart the Host, or finish the subtasks before running'

/**
 * Whether a recorded failure text is the legacy-runtime refusal, which the
 * browser half renders in the reader's own language.
 * @param reason - the execution's recorded failure text.
 * @returns true when that run was refused for a deployment that cannot orchestrate.
 */
export function isLegacyAgentTeamsReason(reason: string): boolean {
  return reason === LEGACY_AGENT_TEAMS_REASON
}

/**
 * Whether a card belongs to a run's dispatch set: the card the request named,
 * or a card whose work is still outstanding. Kept for the browser's subtask
 * preview; the Host run itself opens the clicked card alone
 * ({@link cascadeTargets}).
 * @param task - the candidate card.
 * @param rootId - the task the run request named.
 * @returns false when this card is finished and left alone.
 */
export function joinsCascadeRun(task: TaskRecord, rootId: string): boolean {
  return task.id === rootId || isOutstanding(task)
}

/** One still-open execution belonging to a stored run group. */
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
 * still open: the parent's remaining waiters. A stored multi-member group (a
 * run the Host opened before it stopped spreading one run across a subtree)
 * folds once this list is empty and the parent's own outcome is known.
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
 * Fold a stored run-group parent's own outcome and its children's outcomes into
 * one verdict: failure dominates, then cancellation, then success. The error
 * text is the first failure, falling back to the first cancellation.
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
 * Workspace, agent preset, model and reasoning effort inherit the ancestor's
 * PIN only — a handover bundle is a per-card continuation artefact and is never
 * inherited. The permission inherits the ancestor's EFFECTIVE binding, and its
 * human confirmation travels with it, so a subtask of an already-confirmed
 * elevated card is runnable while a subtask's own unconfirmed binding stays
 * gated.
 */
export function resolveExecutionTargets(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  maxSubtaskDepth: number = SUBTASK_DEPTH_MAX,
): TaskRecord {
  if (task.parentId === undefined) return task
  const chain = [task, ...ancestorChain(tasks, task).slice(0, maxSubtaskDepth)]
  const first = (key: 'workspaceId' | 'mode' | 'model' | 'reasoningEffort', candidates: readonly TaskRecord[]): string | undefined => {
    for (const candidate of candidates) {
      const value = candidate[key]
      if (value !== undefined) return value
    }
    return undefined
  }
  // The model pin is the boundary of the effort: an effort is only ever taken
  // from the card the model came from, or from the card that pinned it below
  // that one. A card with a model of its own thus sends NO effort when it stores
  // none — the model's own default — instead of quietly running at an ancestor
  // level chosen for a different model, even when both models declare that
  // level. A card with no model of its own still inherits the nearest model
  // together with the nearest level pinned at or below it.
  const boundary = chain.findIndex(candidate => candidate.model !== undefined)
  const effortChain = boundary === -1 ? chain : chain.slice(0, boundary + 1)
  const own = effectiveTaskPermission(task)
  // An own binding (pin or handover) keeps its own confirmation stamp; only an
  // absent one borrows the ancestor's binding AND that ancestor's stamp.
  const owner = own === undefined
    ? chain.slice(1).find(candidate => effectiveTaskPermission(candidate) !== undefined)
    : undefined
  return {
    ...task,
    workspaceId: first('workspaceId', chain),
    mode: first('mode', chain),
    model: first('model', chain),
    reasoningEffort: first('reasoningEffort', effortChain),
    permission: own ?? (owner === undefined ? undefined : effectiveTaskPermission(owner)),
    permissionConfirmedAt: own === undefined ? owner?.permissionConfirmedAt : task.permissionConfirmedAt,
  }
}
