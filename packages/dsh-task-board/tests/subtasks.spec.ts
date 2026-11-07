/**
 * Subtask lineage: the depth gate, the inheritance a subtask resolves at run
 * time, the subtree archive/restore/delete rules, and the one card a run opens
 * plus the outstanding descendants its own session dispatches.
 */
import { describe, expect, it } from 'vitest'
import { parseActionEnvelope } from '../src/protocol.ts'
import {
  DEFAULT_SUBTASK_DEPTH,
  LEGACY_AGENT_TEAMS_REASON,
  LEGACY_AGENT_TEAMS_TOOL,
  LIANGSHEN_PRESET_ID,
  SUBTASK_DEPTH_MAX,
  ancestorChain,
  cascadeTargets,
  checkParentLink,
  combineCascadeOutcome,
  directSubtasks,
  hasOutstandingDescendants,
  isLegacyAgentTeamsReason,
  joinsCascadeRun,
  normalizeSubtaskDepth,
  outstandingDescendants,
  resolveExecutionTargets,
  subtreeHeight,
  subtreeTasks,
  taskDepth,
} from '../src/core/subtask.ts'
import { createTask, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'
import { applyArchiveTask, applyRestoreTask } from '../src/core/use-cases/task-archive.ts'
import { applyCreateTask } from '../src/core/use-cases/task-create.ts'
import { applyDeleteTask } from '../src/core/use-cases/task-delete.ts'
import { applySetParent } from '../src/core/use-cases/task-parent.ts'

const NOW = 1_700_000_000_000

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: id, description: '', prompt: id }, NOW, id), ...overrides }
}

describe('subtask depth gate', () => {
  it('user creating a subtask under a root task gets one level of subtasks', () => {
    // Given one root task on the board
    const tasks = [task('root')]

    // When the user creates a subtask under it
    const result = applyCreateTask(tasks, { title: 'child', description: '', prompt: 'p', parentId: 'root' }, NOW, 'child')

    // Then the new task carries the parent link at depth one
    expect(result.task?.parentId).toBe('root')
    expect(result.tasks).toHaveLength(2)
    expect(taskDepth(result.tasks, 'child')).toBe(1)
  })

  it('user creating a subtask of a subtask is refused at the default depth of one', () => {
    // Given a root with one subtask, at the deployment default of one level
    const first = applyCreateTask([task('root')], { title: 'child', description: '', prompt: 'p', parentId: 'root' }, NOW, 'child')
    expect(DEFAULT_SUBTASK_DEPTH).toBe(1)

    // When the user tries to create a subtask of that subtask
    const second = applyCreateTask([...first.tasks], { title: 'grand', description: '', prompt: 'p', parentId: 'child' }, NOW, 'grand')

    // Then the ledger is untouched and the refusal names the limit
    expect(second.task).toBeUndefined()
    expect(second.tasks).toHaveLength(2)
    expect(second.error).toContain('depth limit (1)')
  })

  it('operator raising the limit to three allows a three-level tree and refuses a fourth', () => {
    // Given a deployment configured for the maximum depth
    let tasks: readonly TaskRecord[] = [task('l0')]
    for (const [id, parent] of [['l1', 'l0'], ['l2', 'l1'], ['l3', 'l2']] as const) {
      const created = applyCreateTask(tasks, { title: id, description: '', prompt: 'p', parentId: parent }, NOW, id, SUBTASK_DEPTH_MAX)
      tasks = created.tasks
    }

    // When the operator's tree is already three levels deep
    const overflow = applyCreateTask(tasks, { title: 'l4', description: '', prompt: 'p', parentId: 'l3' }, NOW, 'l4', SUBTASK_DEPTH_MAX)

    // Then the third level exists and the fourth is refused
    expect(taskDepth(tasks, 'l3')).toBe(3)
    expect(tasks).toHaveLength(4)
    expect(overflow.error).toContain('depth limit (3)')
  })

  it('operator clamping an unsupported configured depth keeps the guard tight', () => {
    // Given configuration values outside the supported range
    // When the operator's value is normalized
    // Then unusable values narrow to the default and in-range values survive
    expect(normalizeSubtaskDepth(undefined)).toBe(DEFAULT_SUBTASK_DEPTH)
    expect(normalizeSubtaskDepth(0)).toBe(1)
    expect(normalizeSubtaskDepth(9)).toBe(SUBTASK_DEPTH_MAX)
    expect(normalizeSubtaskDepth(2.7)).toBe(2)
  })

  it('user attaching an existing task under its own subtask is refused as a cycle', () => {
    // Given a root with a subtask
    const tasks = [task('root'), task('child', { parentId: 'root' })]

    // When the user tries to re-parent the root under its own subtask
    const result = applySetParent(tasks, 'root', 'child', NOW, DEFAULT_SUBTASK_DEPTH)

    // Then the cycle is refused and the ledger keeps the original links
    expect(result.applied).toBe(false)
    expect(result.error).toContain('own subtask')
    expect(result.tasks).toBe(tasks)
    expect(checkParentLink(tasks, 'root', 'child', SUBTASK_DEPTH_MAX).reason).toBe('cycle')
  })

  it('user linking a task under an archived parent is refused', () => {
    // Given an archived task on the board
    const tasks = [task('root'), task('archived', { archivedAt: NOW }), task('free')]

    // When the user tries to link the free task under the archived card
    const result = applySetParent(tasks, 'free', 'archived', NOW, SUBTASK_DEPTH_MAX)

    // Then the link is refused and the task stays a root
    expect(result.applied).toBe(false)
    expect(result.error).toContain('archived')
    expect(result.tasks.find(entry => entry.id === 'free')?.parentId).toBeUndefined()
  })

  it('user detaching a subtask returns it to the root board', () => {
    // Given a root with a subtask
    const tasks = [task('root'), task('child', { parentId: 'root' })]

    // When the user detaches the subtask
    const result = applySetParent(tasks, 'child', null, NOW, DEFAULT_SUBTASK_DEPTH)

    // Then the link is gone and the task is a root again
    expect(result.applied).toBe(true)
    expect(result.tasks.find(entry => entry.id === 'child')?.parentId).toBeUndefined()
    expect(taskDepth(result.tasks, 'child')).toBe(0)
  })
})

describe('subtask target inheritance', () => {
  it('user creating a subtask inherits the parent targets and can override each one', () => {
    // Given a parent pinned to a workspace, preset, permission, and model
    const parent = task('root', { workspaceId: 'ws-1', mode: 'preset-1', permission: 'workspace-write', model: 'p/m' })

    // When the user creates one subtask without targets and one with overrides
    const inherited = applyCreateTask([parent], { title: 'a', description: '', prompt: 'p', parentId: 'root' }, NOW, 'a')
    const overridden = applyCreateTask([parent], { title: 'b', description: '', prompt: 'p', parentId: 'root', model: 'other/model' }, NOW, 'b')

    // Then both copy the parent contract and the second keeps its own model,
    // while the PERMISSION stays unresolvable-on-card: it is inherited live at
    // launch, so detaching the subtask cannot leave a copied elevated binding
    expect(inherited.task).toMatchObject({ workspaceId: 'ws-1', mode: 'preset-1', model: 'p/m' })
    expect(inherited.task?.permission).toBeUndefined()
    expect(overridden.task).toMatchObject({ workspaceId: 'ws-1', model: 'other/model' })
    expect(overridden.task?.permission).toBeUndefined()
    expect(resolveExecutionTargets(inherited.task as TaskRecord, [parent, inherited.task as TaskRecord]).permission).toBe('workspace-write')
  })

  it('operator keeping an inherited binding on the parent card cannot mint a confirmed subtask', () => {
    // Given a confirmed elevated permission on the parent
    const parent = task('root', { permission: 'danger-full-access', permissionConfirmedAt: NOW })

    // When the user creates a subtask without its own permission
    const inherited = applyCreateTask([parent], { title: 'a', description: '', prompt: 'p', parentId: 'root' }, NOW, 'a')
    const child = inherited.task as TaskRecord

    // Then the card carries no binding of its own...
    expect(child.permission).toBeUndefined()
    expect(child.permissionConfirmedAt).toBeUndefined()

    // ...the launch resolves the attached parent's live binding and stamp...
    expect(resolveExecutionTargets(child, [parent, child])).toMatchObject({
      permission: 'danger-full-access',
      permissionConfirmedAt: NOW,
    })

    // ...and the same card detached keeps nothing to run on
    const detached = applySetParent([parent, child], 'a', null, NOW, DEFAULT_SUBTASK_DEPTH)
    const rootless = (detached.tasks as TaskRecord[]).find(entry => entry.id === 'a') as TaskRecord
    expect(rootless.parentId).toBeUndefined()
    expect(resolveExecutionTargets(rootless, detached.tasks).permission).toBeUndefined()
  })

  it('user clearing a subtask target falls back to the nearest ancestor at run time', () => {
    // Given a root with a pinned model and a subtask that cleared its own
    const root = task('root', { model: 'p/m', workspaceId: 'ws-1' })
    const child = task('child', { parentId: 'root', model: undefined, workspaceId: undefined })

    // When the execution targets are resolved for the subtask
    const resolved = resolveExecutionTargets(child, [root, child])

    // Then the ancestor value is used and the stored record is untouched
    expect(resolved.model).toBe('p/m')
    expect(resolved.workspaceId).toBe('ws-1')
    expect(child.model).toBeUndefined()
  })

  it('user creating a subtask of a continuation card resolves the bundle permission at launch', () => {
    // Given a parent whose handover bundle pins an elevated permission
    const parent = task('root', {
      handover: { references: [], permission: 'danger-full-access', bundledAt: NOW },
      permissionConfirmedAt: NOW,
    })

    // When the user creates a subtask without its own permission
    const inherited = applyCreateTask([parent], { title: 'a', description: '', prompt: 'p', parentId: 'root' }, NOW, 'a')

    // Then nothing is copied onto the card, the bundle references stay with the
    // parent, and the launch still resolves the bundle's binding live
    expect(inherited.task?.permission).toBeUndefined()
    expect(inherited.task?.permissionConfirmedAt).toBeUndefined()
    expect(inherited.task?.handover).toBeUndefined()
    expect(resolveExecutionTargets(inherited.task as TaskRecord, [parent, inherited.task as TaskRecord]).permission).toBe('danger-full-access')
  })

  it('operator resolving a subtask that pins its own bundle permission keeps its own gate', () => {
    // Given a confirmed elevated parent and a subtask whose own bundle pins a permission
    const root = task('root', { permission: 'danger-full-access', permissionConfirmedAt: NOW })
    const child = task('child', {
      parentId: 'root',
      handover: { references: [], permission: 'workspace-write', bundledAt: NOW },
    })

    // When the effective targets are resolved
    const resolved = resolveExecutionTargets(child, [root, child])

    // Then the subtask's own binding wins and it does NOT borrow the parent's confirmation
    expect(resolved.permission).toBe('workspace-write')
    expect(resolved.permissionConfirmedAt).toBeUndefined()
  })

  it('operator resolving an unset subtask permission takes the ancestor confirmation', () => {
    // Given a subtask without its own permission under a confirmed elevated root
    const root = task('root', { permission: 'danger-full-access', permissionConfirmedAt: NOW })
    const child = task('child', { parentId: 'root' })

    // When the effective targets are resolved
    const resolved = resolveExecutionTargets(child, [root, child])

    // Then the elevated permission arrives together with its confirmation stamp
    expect(resolved.permission).toBe('danger-full-access')
    expect(resolved.permissionConfirmedAt).toBe(NOW)
  })
})

describe('subtree lifecycle', () => {
  it('user archiving a parent archives every subtask with it', () => {
    // Given a root with two subtasks
    const tasks = [task('root'), task('a', { parentId: 'root' }), task('b', { parentId: 'root' })]

    // When the user archives the parent
    const archived = applyArchiveTask(tasks, 'root', NOW, DEFAULT_SUBTASK_DEPTH)

    // Then the whole group leaves the board together
    expect(archived.archived).toBe(true)
    expect(archived.tasks.every(entry => entry.archivedAt === NOW)).toBe(true)
  })

  it('user archiving a group with a running member is refused whole', () => {
    // Given a root whose subtask is still running
    const tasks = [task('root'), task('a', { parentId: 'root', status: 'running' })]

    // When the user archives the parent
    const archived = applyArchiveTask(tasks, 'root', NOW, DEFAULT_SUBTASK_DEPTH)

    // Then nothing is archived, so the running execution keeps its card
    expect(archived.archived).toBe(false)
    expect(archived.tasks.find(entry => entry.id === 'root')?.archivedAt).toBeUndefined()
  })

  it('user restoring a subtask brings its archived parent chain back', () => {
    // Given an archived root whose subtask is also archived
    const tasks = [task('root', { archivedAt: NOW }), task('child', { parentId: 'root', archivedAt: NOW })]

    // When the user restores the subtask
    const restored = applyRestoreTask(tasks, 'child', NOW + 1, DEFAULT_SUBTASK_DEPTH)

    // Then both are on the board again
    expect(restored.archived).toBe(true)
    expect(restored.tasks.every(entry => entry.archivedAt === undefined)).toBe(true)
    expect(directSubtasks(restored.tasks, 'root')).toHaveLength(1)
  })

  it('user deleting a parent that still has subtasks is blocked', () => {
    // Given a root with a subtask
    const tasks = [task('root'), task('child', { parentId: 'root' })]

    // When the user deletes the parent
    const removed = applyDeleteTask(tasks, undefined, 'root')

    // Then the ledger is unchanged and the block is reported
    expect(removed.blocked).toBe(true)
    expect(removed.tasks).toHaveLength(2)
  })

  it('user deleting a subtask leaves the parent on the board', () => {
    // Given a root with a subtask
    const tasks = [task('root'), task('child', { parentId: 'root' })]

    // When the user deletes the subtask
    const removed = applyDeleteTask(tasks, 'child', 'child')

    // Then only the subtask is gone and the selection is cleared
    expect(removed.blocked).toBe(false)
    expect(removed.tasks.map(entry => entry.id)).toEqual(['root'])
    expect(removed.selectionCleared).toBe(true)
  })
})

describe('hand-edited lineage safety', () => {
  it('operator measuring a cyclic ledger terminates with a bounded walk', () => {
    // Given a hand-edited ledger carrying a two-task cycle
    const tasks = [task('b', { parentId: 'c' }), task('c', { parentId: 'b' }), task('a')]

    // When the operator measures the cycle and checks a new link against it
    // Then both walks terminate with bounded answers
    expect(subtreeHeight(tasks, 'b')).toBe(2)
    expect(checkParentLink(tasks, 'a', 'b', SUBTASK_DEPTH_MAX).ok).toBe(true)
  })

  it('user restoring a deep task brings its whole archived ancestor chain back', () => {
    // Given an archived four-level chain stored while the limit was higher
    const tasks = [
      task('l0', { archivedAt: NOW }),
      task('l1', { parentId: 'l0', archivedAt: NOW }),
      task('l2', { parentId: 'l1', archivedAt: NOW }),
      task('l3', { parentId: 'l2', archivedAt: NOW }),
    ]

    // When the user restores the deepest task at the default limit of one
    const restored = applyRestoreTask(tasks, 'l3', NOW + 1, DEFAULT_SUBTASK_DEPTH)

    // Then every ancestor is on the board again
    expect(restored.archived).toBe(true)
    expect(restored.tasks.every(entry => entry.archivedAt === undefined)).toBe(true)
    expect(ancestorChain(restored.tasks, restored.tasks[3]).map(entry => entry.id)).toEqual(['l2', 'l1', 'l0'])
  })

  it('user detaching a subtask with an open execution is refused', () => {
    // Given a subtask whose execution has not settled yet
    const execution: ExecutionRecord = {
      id: 'e1', sessionId: 's1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined,
    }
    const tasks = [task('root'), task('child', { parentId: 'root', status: 'running', executions: [execution] })]

    // When the user detaches it
    const result = applySetParent(tasks, 'child', null, NOW, DEFAULT_SUBTASK_DEPTH)

    // Then the link is frozen until the run settles
    expect(result.applied).toBe(false)
    expect(result.error).toContain('running')
    expect(result.tasks.find(entry => entry.id === 'child')?.parentId).toBe('root')
  })
})

describe('the run a card request opens', () => {
  it('operator running a parent opens a run for that card alone, never for its tree', () => {
    // Given a three-level tree
    const tasks = [
      task('root'),
      task('a', { parentId: 'root' }),
      task('b', { parentId: 'root' }),
      task('a1', { parentId: 'a' }),
    ]

    // When the operator opens a run for the root at depth three
    const participants = cascadeTargets(tasks, 'root')

    // Then only the requested card is opened; its subtasks are dispatched from
    // inside its own session
    expect(participants.map(entry => entry.id)).toEqual(['root'])
  })

  it('operator running a subtask gets that subtask as the run root, without its own descendants', () => {
    // Given a three-level tree
    const tasks = [
      task('root'),
      task('a', { parentId: 'root' }),
      task('a1', { parentId: 'a' }),
    ]

    // When the operator runs a subtask directly
    // Then that card is the whole run, and its own child is not opened either
    expect(cascadeTargets(tasks, 'a').map(entry => entry.id)).toEqual(['a'])
    expect(cascadeTargets(tasks, 'missing')).toEqual([])
  })

  it('operator reading a tree sees the subtree the lineage gates walk', () => {
    // Given a three-level tree under the widest depth
    const tasks = [
      task('root'),
      task('a', { parentId: 'root' }),
      task('b', { parentId: 'root' }),
      task('a1', { parentId: 'a' }),
    ]

    // When the subtree is read for a gate
    // Then the card and every descendant are covered, breadth-first
    expect(subtreeTasks(tasks, 'root', SUBTASK_DEPTH_MAX).map(entry => entry.id)).toEqual(['root', 'a', 'b', 'a1'])
  })

  it('operator sees only the unfinished descendants a card still has to dispatch', () => {
    // Given a root whose descendants sit in mixed columns, one of them archived
    const tasks = [
      task('root', { status: 'done' }),
      task('a', { parentId: 'root', status: 'todo' }),
      task('b', { parentId: 'root', status: 'done' }),
      task('c', { parentId: 'root', status: 'failed' }),
      task('d', { parentId: 'root', status: 'todo', archivedAt: NOW }),
    ]

    // When the dispatch set is read
    // Then a finished card is left alone, an archived one cannot be dispatched,
    // and the card's own column never decides it
    expect(outstandingDescendants(tasks, 'root', SUBTASK_DEPTH_MAX).map(entry => entry.id)).toEqual(['a', 'c'])
    expect(hasOutstandingDescendants(tasks, 'root', SUBTASK_DEPTH_MAX)).toBe(true)
    expect(outstandingDescendants([task('root'), task('done', { parentId: 'root', status: 'done' })], 'root', SUBTASK_DEPTH_MAX)).toEqual([])
    expect(hasOutstandingDescendants([task('root')], 'root', SUBTASK_DEPTH_MAX)).toBe(false)
  })

  it('operator sees the dispatch preset name the package that ships it', () => {
    // Given the preset id packages/dsh-liangshen declares for its dispatcher
    // When the board's forced dispatch preset constant is read
    // Then it is that same id, so a forced run composes the preset that package ships
    expect(LIANGSHEN_PRESET_ID).toBe('liangshen')
  })

  it('operator reads the legacy-runtime refusal off the one tool generation that blocks dispatch', () => {
    // Given the tool a legacy Agent Teams runtime registers instead of the
    // coordination tools this mode reuses
    // When the board's compatibility fingerprint and refusal sentence are read
    // Then the fingerprint is exactly that tool, and the sentence names both the
    // forced preset and the fix, and recognizes itself
    expect(LEGACY_AGENT_TEAMS_TOOL).toBe('spawn_teammate')
    expect(LEGACY_AGENT_TEAMS_REASON).toContain(LIANGSHEN_PRESET_ID)
    expect(LEGACY_AGENT_TEAMS_REASON).toContain('legacy Agent Teams')
    expect(LEGACY_AGENT_TEAMS_REASON).toContain('restart the Host')
    expect(isLegacyAgentTeamsReason(LEGACY_AGENT_TEAMS_REASON)).toBe(true)
    expect(isLegacyAgentTeamsReason('agent preset not found: liangshen')).toBe(false)
    expect(isLegacyAgentTeamsReason('')).toBe(false)
  })

  it('operator running a parent whose own column is done still runs that parent', () => {
    // Given a card the operator ran directly and descendants in mixed columns
    const requested = task('root', { status: 'done' })
    const running = task('running-child', { parentId: 'root', status: 'running' })
    const failed = task('failed-child', { parentId: 'root', status: 'failed' })
    const finished = task('done-child', { parentId: 'root', status: 'done' })

    // When the dispatch set is read
    // Then the requested task always joins, and among the descendants only the
    // finished one is left alone
    expect(joinsCascadeRun(requested, 'root')).toBe(true)
    expect(joinsCascadeRun(running, 'root')).toBe(true)
    expect(joinsCascadeRun(failed, 'root')).toBe(true)
    expect(joinsCascadeRun(finished, 'root')).toBe(false)
  })

  it('operator folding a cascade prefers failure over cancellation over success', () => {
    // Given mixed outcomes from one run group
    // When the operator folds them
    // Then failure dominates and its error text survives
    expect(combineCascadeOutcome([
      { result: 'succeeded' },
      { result: 'cancelled', error: 'stopped' },
    ])).toEqual({ result: 'cancelled', error: 'stopped' })
    expect(combineCascadeOutcome([
      { result: 'cancelled', error: 'stopped' },
      { result: 'failed', error: 'agent turn ended with an error' },
    ])).toEqual({ result: 'failed', error: 'agent turn ended with an error' })
    expect(combineCascadeOutcome([{ result: 'succeeded' }])).toEqual({ result: 'succeeded', error: undefined })
  })
})

describe('subtask wire gate', () => {
  it('user creating a subtask sends a parent id the wire gate accepts', () => {
    // Given a create envelope carrying a parent link
    const envelope = {
      requestId: 'r1',
      action: { kind: 'create', id: 'child', input: { title: 'c', description: '', prompt: 'p', parentId: 'root' } },
    }

    // When the Host parses it
    const parsed = parseActionEnvelope(envelope)

    // Then the parent link survives the gate
    expect(parsed?.action).toMatchObject({ kind: 'create', input: { parentId: 'root' } })
  })

  it('user creating a subtask with a blank parent id is refused by the wire gate', () => {
    // Given a create envelope whose parent id is blank
    const envelope = {
      requestId: 'r2',
      action: { kind: 'create', id: 'child', input: { title: 'c', description: '', prompt: 'p', parentId: '   ' } },
    }

    // When the Host parses it
    // Then the envelope is rejected outright
    expect(parseActionEnvelope(envelope)).toBeUndefined()
  })

  it('user linking and detaching a task through the wire carries the parent id', () => {
    // Given a set-parent envelope with a parent and one with a null parent
    const link = { requestId: 'r3', action: { kind: 'set-parent', taskId: 'child', parentId: 'root' } }
    const detach = { requestId: 'r4', action: { kind: 'set-parent', taskId: 'child', parentId: null } }

    // When the Host parses both
    // Then both actions are accepted with their exact parent value
    expect(parseActionEnvelope(link)?.action).toEqual({ kind: 'set-parent', taskId: 'child', parentId: 'root' })
    expect(parseActionEnvelope(detach)?.action).toEqual({ kind: 'set-parent', taskId: 'child', parentId: null })
  })
})
