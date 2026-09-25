/**
 * Cascade runs and deferred settlement on the Host ledger: one run request
 * opens an execution per subtree member under a shared run group, a parent
 * settles only after its own turn and its subtasks have settled, and the
 * lineage/depth gates hold at the Host boundary.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { promptText } from '../src/host-runner.ts'
import { DEFAULT_SUBTASK_DEPTH, SUBTASK_DEPTH_MAX, teammateName } from '../src/core/subtask.ts'
import { createTask, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-subtask-'))
  roots.push(root)
  return root
}

/** Seed one root with two idle subtasks through the real create action. */
function seedTree(ledger: HostTaskLedger): void {
  ledger.applyRequest('seed-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root' } })
  ledger.applyRequest('seed-a', { kind: 'create', id: 'a', input: { title: 'a', description: '', prompt: 'a', parentId: 'root' } })
  ledger.applyRequest('seed-b', { kind: 'create', id: 'b', input: { title: 'b', description: '', prompt: 'b', parentId: 'root' } })
}

function latest(task: TaskRecord | undefined): ExecutionRecord | undefined {
  return task?.executions.at(-1)
}

function find(ledger: HostTaskLedger, id: string): TaskRecord | undefined {
  return ledger.state().tasks.find(task => task.id === id)
}

describe('cascade run groups', () => {
  it('user running a parent opens one execution per subtask under a shared run group', () => {
    // Given a root with two idle subtasks
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)

    // When the user runs the parent
    const result = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })

    // Then the root runs first, every participant shares one group, and all cards are running
    const runs = result.runs ?? []
    expect(runs.map(run => run.task.id)).toEqual(['root', 'a', 'b'])
    expect(new Set(runs.map(run => run.execution.runGroupId)).size).toBe(1)
    expect(ledger.state().tasks.map(task => task.status)).toEqual(['running', 'running', 'running'])
  })

  it('user sees the parent stay running until the last subtask settles', () => {
    // Given a running cascade whose parent turn already settled
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)
    ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })
    const rootExecution = latest(find(ledger, 'root'))?.id
    const aExecution = latest(find(ledger, 'a'))?.id
    const bExecution = latest(find(ledger, 'b'))?.id
    if (rootExecution === undefined || aExecution === undefined || bExecution === undefined) throw new Error('cascade did not open every execution')
    ledger.settle('root', rootExecution, 'succeeded')

    // When one subtask settles and one is still running
    ledger.settle('a', aExecution, 'succeeded')

    // Then the parent is still running and the settled subtask is done
    expect(find(ledger, 'root')?.status).toBe('running')
    expect(find(ledger, 'a')?.status).toBe('done')

    // When the last subtask settles
    ledger.settle('b', bExecution, 'succeeded')

    // Then the parent leaves running with the group verdict
    expect(find(ledger, 'root')?.status).toBe('done')
    expect(latest(find(ledger, 'root'))?.endedAt).toBe(NOW)
  })

  it('user sees a failed subtask fail the parent cascade', () => {
    // Given a running cascade
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)
    ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })
    const aExecution = latest(find(ledger, 'a'))?.id
    const bExecution = latest(find(ledger, 'b'))?.id
    const rootExecution = latest(find(ledger, 'root'))?.id
    if (aExecution === undefined || bExecution === undefined || rootExecution === undefined) throw new Error('cascade did not open every execution')

    // When a subtask fails and the rest succeed
    ledger.settle('a', aExecution, 'failed', 'agent turn ended with an error')
    ledger.settle('b', bExecution, 'succeeded')
    ledger.settle('root', rootExecution, 'succeeded')

    // Then the parent carries the failure and its message
    const parent = find(ledger, 'root')
    expect(parent?.status).toBe('failed')
    expect(latest(parent)?.error).toBe('agent turn ended with an error')
  })

  it('user sees a cascade parent settle once its subtasks finished before it did', () => {
    // Given a running cascade whose subtasks settle first
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)
    ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })
    const aExecution = latest(find(ledger, 'a'))?.id
    const bExecution = latest(find(ledger, 'b'))?.id
    const rootExecution = latest(find(ledger, 'root'))?.id
    if (aExecution === undefined || bExecution === undefined || rootExecution === undefined) throw new Error('cascade did not open every execution')
    ledger.settle('a', aExecution, 'succeeded')
    ledger.settle('b', bExecution, 'succeeded')

    // When the parent turn settles last
    ledger.settle('root', rootExecution, 'succeeded')

    // Then the parent finalizes immediately
    expect(find(ledger, 'root')?.status).toBe('done')
  })

  it('operator running a parent leaves an already running subtask out of the group', () => {
    // Given a subtask that is already running on its own
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)
    ledger.applyRequest('run-a', { kind: 'run', taskId: 'a' })

    // When the operator runs the parent
    const result = ledger.applyRequest('run-root', { kind: 'run', taskId: 'root' })

    // Then the cascade covers the root and the idle subtask only
    expect((result.runs ?? []).map(run => run.task.id)).toEqual(['root', 'b'])
    expect(find(ledger, 'a')?.executions).toHaveLength(1)
  })
})

describe('lineage gates at the Host boundary', () => {
  it('user creating a subtask of a subtask is refused at the configured depth', () => {
    // Given a deployment limited to one subtask level
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { maxSubtaskDepth: DEFAULT_SUBTASK_DEPTH })
    seedTree(ledger)

    // When the user tries to create a subtask under a subtask
    // Then the Host refuses it and the ledger keeps three tasks
    expect(() => ledger.applyRequest('create-c', {
      kind: 'create', id: 'c', input: { title: 'c', description: '', prompt: 'c', parentId: 'a' },
    })).toThrow('depth limit (1)')
    expect(ledger.state().tasks).toHaveLength(3)
  })

  it('user linking and detaching a task through the Host moves the parent link', () => {
    // Given a root and a free task
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root' } })
    ledger.applyRequest('create-free', { kind: 'create', id: 'free', input: { title: 'free', description: '', prompt: 'free' } })

    // When the user links the free task and then detaches it
    const linked = ledger.applyRequest('link-1', { kind: 'set-parent', taskId: 'free', parentId: 'root' })
    expect(linked.state.tasks.find(task => task.id === 'free')?.parentId).toBe('root')
    const detached = ledger.applyRequest('link-2', { kind: 'set-parent', taskId: 'free', parentId: null })

    // Then the link is gone again
    expect(detached.state.tasks.find(task => task.id === 'free')?.parentId).toBeUndefined()
  })

  it('user detaching a running participant is refused so the cascade keeps its group', () => {
    // Given a cascade that is still in flight
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)
    ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })

    // When the user tries to detach a running participant
    // Then the Host refuses and the group stays intact
    expect(() => ledger.applyRequest('detach', { kind: 'set-parent', taskId: 'a', parentId: null }))
      .toThrow('running task cannot be re-parented')
    expect(find(ledger, 'a')?.parentId).toBe('root')
  })

  it('user deleting a parent that still has subtasks is refused by the Host', () => {
    // Given a root with subtasks
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)

    // When the user deletes the parent
    // Then the delete is refused and the tasks survive
    expect(() => ledger.applyRequest('delete-root', { kind: 'delete', taskId: 'root' })).toThrow('subtasks')
    expect(ledger.state().tasks).toHaveLength(3)
  })

  it('user archiving a parent takes its subtasks off the board with it', () => {
    // Given a root with two subtasks
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)

    // When the user archives the parent
    const archived = ledger.applyRequest('archive-root', { kind: 'archive', taskId: 'root' })

    // Then every member carries the archive stamp
    expect(archived.state.tasks.every(task => task.archivedAt === NOW)).toBe(true)
  })
})

describe('permission gates on a cascade', () => {
  it('user running a parent whose subtask has an unconfirmed elevated permission is refused', () => {
    // Given a subtask pinned above the session default without a confirmation
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'read-only' })
    ledger.applyRequest('create-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root' } })
    ledger.applyRequest('create-child', {
      kind: 'create', id: 'child', input: { title: 'child', description: '', prompt: 'child', parentId: 'root', permission: 'danger-full-access' },
    })

    // When the user runs the parent
    // Then the whole cascade is refused before anything starts
    expect(() => ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })).toThrow('confirmation-required')
    expect(ledger.state().tasks.every(task => task.status === 'todo')).toBe(true)
  })

  it('operator due schedule opens the whole tree and shares one run group', () => {
    // Given a scheduled root with an idle subtask
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create-root', {
      kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', schedule: { enabled: true, cron: '* * * * *' } },
    })
    ledger.applyRequest('create-child', { kind: 'create', id: 'child', input: { title: 'child', description: '', prompt: 'child', parentId: 'root' } })

    // When the schedule comes due
    const opened = ledger.openScheduled('root', NOW + 60_000, NOW)

    // Then both run under one group
    expect(opened.map(run => run.task.id)).toEqual(['root', 'child'])
    expect(new Set(opened.map(run => run.execution.runGroupId)).size).toBe(1)
  })

  it('operator due schedule is refused while a subtask permission is unconfirmed', () => {
    // Given a scheduled root whose subtask is pinned above the session default
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'read-only' })
    ledger.applyRequest('create-root', {
      kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', schedule: { enabled: true, cron: '* * * * *' } },
    })
    ledger.applyRequest('create-child', {
      kind: 'create', id: 'child', input: { title: 'child', description: '', prompt: 'child', parentId: 'root', permission: 'danger-full-access' },
    })

    // When the schedule comes due
    const opened = ledger.openScheduled('root', NOW + 60_000, NOW)

    // Then nothing ran, the schedule rolled forward, and the reason is recorded
    expect(opened).toEqual([])
    expect(find(ledger, 'root')?.schedule?.nextRunAt).toBe(NOW + 60_000)
    expect(ledger.state().scheduler.error).toContain('unconfirmed')
  })
})


describe('Agent Team runs', () => {
  it('user opting a task into Agent Team gets a Lead run and one teammate per subtask', () => {
    // Given a team-mode root with two subtasks
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('seed-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', teamRun: true } })
    ledger.applyRequest('seed-a', { kind: 'create', id: 'a', input: { title: 'a', description: '', prompt: 'a', parentId: 'root' } })
    ledger.applyRequest('seed-b', { kind: 'create', id: 'b', input: { title: 'b', description: '', prompt: 'b', parentId: 'root' } })

    // When the user runs it
    const runs = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' }).runs ?? []

    // Then only the root is launched by the Host and the subtasks are teammates
    expect(runs.map(run => [run.task.id, run.dispatch ?? 'session'])).toEqual([
      ['root', 'session'],
      ['a', 'teammate'],
      ['b', 'teammate'],
    ])
  })

  it('operator plain run keeps every member on its own independent session', () => {
    // Given a root without the opt-in
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    seedTree(ledger)

    // When the user runs the parent
    const runs = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' }).runs ?? []

    // Then no run asks for a teammate
    expect(runs.every(run => run.dispatch === undefined)).toBe(true)
  })

  it('operator team run refuses a subtask that pins its own above-default permission', () => {
    // Given a team-mode root whose subtask pins danger-full-access unconfirmed
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'read-only' })
    ledger.applyRequest('seed-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', teamRun: true } })
    ledger.applyRequest('seed-a', {
      kind: 'create', id: 'a', input: { title: 'a', description: '', prompt: 'a', parentId: 'root', permission: 'danger-full-access' },
    })

    // When the user runs it
    // Then the run is refused instead of silently dropping the subtask pin
    expect(() => ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })).toThrow(/team run cannot honor/)
    expect(ledger.state().tasks.every(task => task.status === 'todo')).toBe(true)
  })

  it('operator team run refuses an unconfirmed Lead binding like any other run', () => {
    // Given a team-mode root pinned above the session default without confirmation
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'read-only' })
    ledger.applyRequest('seed-root', {
      kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', teamRun: true, permission: 'danger-full-access' },
    })

    // When the user runs it
    // Then the confirmation gate still refuses the whole run
    expect(() => ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' })).toThrow('confirmation-required')
  })

  it('operator team run under a confirmed Lead lets an inheriting subtask through', () => {
    // Given a team-mode root the human confirmed and a subtask with its own unset permission
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'read-only' })
    ledger.applyRequest('seed-root', {
      kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', teamRun: true, permission: 'danger-full-access' },
    })
    ledger.applyRequest('seed-a', { kind: 'create', id: 'a', input: { title: 'a', description: '', prompt: 'a', parentId: 'root' } })
    ledger.applyRequest('confirm', { kind: 'confirm-permission', taskId: 'root' })

    // When the user runs it
    const runs = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' }).runs ?? []

    // Then the inherited binding is the Lead's own and the teammate is dispatched
    expect(runs.filter(run => run.dispatch === 'teammate').map(run => run.task.id)).toEqual(['a'])
  })

  it('operator team run flattens a deeper tree into teammates of the Lead', () => {
    // Given a two-level team tree stored under a depth limit of two
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { maxSubtaskDepth: 2 })
    ledger.applyRequest('seed-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', teamRun: true } })
    ledger.applyRequest('seed-a', { kind: 'create', id: 'a', input: { title: 'a', description: '', prompt: 'a', parentId: 'root' } })
    ledger.applyRequest('seed-b', { kind: 'create', id: 'b', input: { title: 'b', description: '', prompt: 'b', parentId: 'a' } })

    // When the user runs the root
    const runs = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' }).runs ?? []

    // Then every non-root member is a teammate of that one Lead
    expect(runs.filter(run => run.dispatch === 'teammate').map(run => run.task.id)).toEqual(['a', 'b'])
  })

  it('operator sees the run shape spelled out in the Lead prompt, one teammate per member', () => {
    // Given the members of a team run and the same members of a plain cascade
    const peers = [
      { id: 'a', title: '收集公开数据', name: 'subtask-0a1b2c3d' },
      { id: 'b', title: 'model', name: 'model-0a1b2c3d' },
    ]
    const root = createTask({ title: 'root', description: '', prompt: 'do it' }, NOW, 'root')

    // When each prompt is built
    const team = promptText({ ...root, teamRun: true }, { peers, team: true })
    const cascade = promptText(root, { peers })

    // Then the Lead prompt names the teammates and the cascade prompt the sessions
    expect(team).toContain('Agent Team 的 Lead')
    expect(team).toContain('subtask-0a1b2c3d')
    expect(cascade).toContain('并发开启 2 个独立 DSH 会话')
    expect(cascade).not.toContain('Agent Team 的 Lead')
  })

  it('operator teammate names stay kebab-case and unique per run', () => {
    // Given CJK, mixed-case and short titles with two different run tokens
    // When the names are derived
    // Then each is an ASCII kebab-case name carrying its run token
    expect(teammateName('收集 公开混凝土数据!', 'a1b2c3d4-ffff', 'task-a')).toMatch(/^subtask-a1b2c3d4-[0-9a-f]{8}$/)
    expect(teammateName('Collect Carbon Factors', 'a1b2c3d4-ffff', 'task-a')).toMatch(/^collect-carbon-factors-a1b2c3d4-[0-9a-f]{8}$/)
    expect(teammateName('b', 'zzzz', 'task-a')).not.toBe(teammateName('b', 'yyyy', 'task-a'))
    // The same member and run always render the same name, so a re-derivation
    // (the Lead prompt, then the spawn) agrees with itself.
    expect(teammateName('b', 'zzzz', 'task-a')).toBe(teammateName('b', 'zzzz', 'task-a'))
    // Two different members with the SAME title in one run stay distinct.
    expect(teammateName('b', 'zzzz', 'task-a')).not.toBe(teammateName('b', 'zzzz', 'task-b'))
  })

  it('operator two CJK titles in one run never collide on a teammate name', () => {
    // Given two CJK-only titles that both slug to the generic prefix, in the
    // same run group — the shape that refused the second spawn in production
    // When the names are derived
    // Then the member identity keeps them distinct
    const group = 'e048c604-da23-4ad1-97f4-56913036f820'
    const first = teammateName('多学科术语内容建设', group, 'task-a')
    const second = teammateName('后续内容与平台发展', group, 'task-b')

    // Then neither collides, and both satisfy the service's name contract
    expect(first).not.toBe(second)
    // The name depends on the member identity, not on which title it carries:
    // the title only supplies the prefix, so the same member cannot drift.
    expect(teammateName('后续内容与平台发展', group, 'task-b')).toBe(second)
    for (const name of [first, second]) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(name.length).toBeLessThanOrEqual(64)
      expect(name).not.toBe('lead')
    }
  })

  it('operator cron on a team card refuses when a subtask pins a permission', () => {
    // Given a team-mode scheduled root whose subtask pins above the session default
    const ledger = new HostTaskLedger(tempRoot(), () => NOW, { sessionDefaultPermission: 'read-only' })
    ledger.applyRequest('seed-root', {
      kind: 'create', id: 'root',
      input: { title: 'root', description: '', prompt: 'root', teamRun: true, schedule: { enabled: true, cron: '* * * * *' } },
    })
    ledger.applyRequest('seed-a', {
      kind: 'create', id: 'a', input: { title: 'a', description: '', prompt: 'a', parentId: 'root', permission: 'danger-full-access' },
    })

    // When the schedule comes due
    const opened = ledger.openScheduled('root', NOW + 60_000, NOW)

    // Then nothing ran and the recorded reason names the team-mode limitation
    expect(opened).toEqual([])
    expect(ledger.state().scheduler.error).toContain('team run cannot honor')
  })
})
describe('stored lineage repair', () => {
  it('operator lowering the depth limit keeps the deeper links that were already stored', () => {
    // Given a three-level tree stored while the limit was three
    const root = tempRoot()
    const deep = new HostTaskLedger(root, () => NOW, { maxSubtaskDepth: SUBTASK_DEPTH_MAX })
    deep.applyRequest('create-l0', { kind: 'create', id: 'l0', input: { title: 'l0', description: '', prompt: 'l0' } })
    deep.applyRequest('create-l1', { kind: 'create', id: 'l1', input: { title: 'l1', description: '', prompt: 'l1', parentId: 'l0' } })
    deep.applyRequest('create-l2', { kind: 'create', id: 'l2', input: { title: 'l2', description: '', prompt: 'l2', parentId: 'l1' } })
    deep.dispose()

    // When the operator restarts with a limit of one
    const shallow = new HostTaskLedger(root, () => NOW, { maxSubtaskDepth: 1 })

    // Then the stored links survive while new deeper ones are refused
    expect(find(shallow, 'l2')?.parentId).toBe('l1')
    expect(() => shallow.applyRequest('create-l3', {
      kind: 'create', id: 'l3', input: { title: 'l3', description: '', prompt: 'l3', parentId: 'l2' },
    })).toThrow('depth limit (1)')
    shallow.dispose()
  })

  it('operator importing an on-board child of an archived parent drops only the link', () => {
    // Given an imported document pairing an archived parent with an on-board child
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    const archivedParent: TaskRecord = { ...createTask({ title: 'p', description: '', prompt: 'p' }, NOW, 'p'), archivedAt: NOW }
    const child: TaskRecord = { ...createTask({ title: 'c', description: '', prompt: 'c' }, NOW, 'c'), parentId: 'p' }

    // When the document is imported
    ledger.applyRequest('import-hand', { kind: 'import', sourceId: 'hand', tasks: [archivedParent, child] })

    // Then the child survives as a root instead of pointing off-board
    expect(find(ledger, 'c')?.parentId).toBeUndefined()
    expect(find(ledger, 'p')?.archivedAt).toBe(NOW)
    ledger.dispose()
  })

  it('operator loading a ledger whose parent row vanished drops only the dangling link', () => {
    // Given a stored subtask whose parent row no longer resolves
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('create-parent', { kind: 'create', id: 'parent', input: { title: 'parent', description: '', prompt: 'parent' } })
    ledger.applyRequest('create-child', { kind: 'create', id: 'child', input: { title: 'child', description: '', prompt: 'child', parentId: 'parent' } })
    ledger.dispose()
    const document = JSON.parse(readFileSync(ledger.file, 'utf8')) as { tasks: Array<{ id: string }> }
    document.tasks = document.tasks.filter(task => task.id !== 'parent')
    writeFileSync(ledger.file, JSON.stringify(document))

    // When the Host starts from that document
    const reloaded = new HostTaskLedger(root, () => NOW)

    // Then the task survives as a root instead of being dropped
    expect(find(reloaded, 'child')?.parentId).toBeUndefined()
    expect(find(reloaded, 'child')?.title).toBe('child')
    reloaded.dispose()
  })
})

describe('restart recovery', () => {
  it('operator restarting the host finalizes a deferred parent whose subtasks were interrupted', () => {
    // Given a cascade where only the parent session was recorded before the crash
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    seedTree(ledger)
    const runs = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' }).runs ?? []
    const rootRun = runs.find(run => run.task.id === 'root')
    if (rootRun === undefined) throw new Error('cascade did not open the root execution')
    ledger.attachSession('root', rootRun.execution.id, 'session-root')
    ledger.settle('root', rootRun.execution.id, 'succeeded')
    ledger.dispose()

    // When the host restarts and cancels the subtasks that never got a session
    const restarted = new HostTaskLedger(root, () => NOW + 1)

    // Then the deferred parent leaves the running column with the group verdict
    expect(find(restarted, 'root')?.status).toBe('todo')
    expect(latest(find(restarted, 'root'))?.endedAt).toBe(NOW + 1)
    expect(find(restarted, 'a')?.executions[0]?.result).toBe('cancelled')
  })

  it('operator restarting the host still settles a deferred parent once its subtasks finish', () => {
    // Given a cascade whose parent turn settled while its subtasks were open
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    seedTree(ledger)
    const runs = ledger.applyRequest('run-1', { kind: 'run', taskId: 'root' }).runs ?? []
    // The Host attaches the launched session before a restart can happen; an
    // interrupted start without one is cancelled by the recovery pass.
    for (const run of runs) ledger.attachSession(run.task.id, run.execution.id, 'session-' + run.task.id)
    const aExecution = latest(find(ledger, 'a'))?.id
    const bExecution = latest(find(ledger, 'b'))?.id
    const rootExecution = latest(find(ledger, 'root'))?.id
    if (aExecution === undefined || bExecution === undefined || rootExecution === undefined) throw new Error('cascade did not open every execution')
    ledger.settle('root', rootExecution, 'succeeded')
    ledger.dispose()

    // When the host restarts and the remaining subtasks settle
    const restarted = new HostTaskLedger(root, () => NOW + 1)
    restarted.settle('a', aExecution, 'succeeded')
    restarted.settle('b', bExecution, 'succeeded')

    // Then the run group survived and the parent finalizes
    expect(find(restarted, 'root')?.status).toBe('done')
    expect(find(restarted, 'a')?.status).toBe('done')
  })
})
