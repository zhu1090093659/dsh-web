/**
 * Remote close/reopen synchronization against the contract-level fake board.
 * These cases assert durable card state and event provenance rather than HTTP
 * calls: the remote state may guide a close cycle, but never interrupts a run
 * or fabricates an execution result.
 */
import { describe, expect, it } from 'vitest'
import type { TaskBoardExtension, TaskBoardExtensionHost } from '../src/core/contract.ts'
import type { ExecutionRecord, TaskRecord, TaskStatus } from '../src/core/task-record.ts'
import { normalizeGitHubMetadata, readTaskGitHubMetadata, type GitHubRepoConfig } from '../src/core/types.ts'
import { GitHubApiClient } from '../src/host/client.ts'
import { GitHubSyncService } from '../src/host/service.ts'
import { FakeBoard } from './support/fake-board.ts'
import { FakeGitHubBackend, issueFixture } from './support/fake-github.ts'

const REPO: GitHubRepoConfig = { owner: 'deepseek-ai', repository: 'dsh', inclusionLabel: 'dsh' }

function faceOf(board: FakeBoard): TaskBoardExtensionHost {
  let face: TaskBoardExtensionHost | undefined
  const stub: TaskBoardExtension = { id: 'github', apiVersion: 1, start: host => { face = host } }
  board.admit(stub)
  if (face === undefined) throw new Error('the fake board did not start the provider')
  return face
}

function makeService(board: FakeBoard, backend: FakeGitHubBackend): GitHubSyncService {
  return new GitHubSyncService({
    host: faceOf(board),
    client: new GitHubApiClient({ token: 'test-token', fetch: backend.fetch }),
    repositories: [REPO],
    now: () => 100,
  })
}

function onlyCard(board: FakeBoard): TaskRecord {
  const cards = [...board.records.values()]
  expect(cards).toHaveLength(1)
  return cards[0]!
}

async function importOpenIssue(board: FakeBoard, backend: FakeGitHubBackend, service: GitHubSyncService): Promise<TaskRecord> {
  backend.issues = [issueFixture(10, ['dsh', 'bug'])]
  await service.syncRepository('deepseek-ai', 'dsh')
  return onlyCard(board)
}

describe('GitHub remote close synchronization', () => {
  it('operator importing a closed issue gets one auto-done card and repeated syncs stay idempotent', async () => {
    // Given a closed issue that has never had a local card
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    backend.issues = [issueFixture(10, ['dsh', 'bug'])]
    backend.issues[0]!.state = 'closed'
    const service = makeService(board, backend)

    // When the repository is synchronized twice
    await service.syncRepository('deepseek-ai', 'dsh')
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then one card is done by remote close, with no execution or duplicate move
    const task = onlyCard(board)
    expect(task.status).toBe('done')
    expect(task.executions).toEqual([])
    expect(readTaskGitHubMetadata(task)?.remoteClose).toEqual({ state: 'auto-done' })
    expect(board.statusChanges).toEqual([])
  })

  it('operator closing and reopening an existing issue sees only the automatic completion reversed', async () => {
    // Given an existing open card
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const task = await importOpenIssue(board, backend, service)

    // When the issue closes
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the board moves it with explicit provider provenance
    expect(board.records.get(task.id)?.status).toBe('done')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose?.state).toBe('auto-done')
    expect(board.statusChanges.at(-1)).toMatchObject({ status: 'done', initiator: 'github:remote-close' })
    const moveCount = board.statusChanges.length

    // And another closed pass does not move it again
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(board.statusChanges).toHaveLength(moveCount)

    // When the issue reopens
    backend.issues[0]!.state = 'open'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then only that automatic completion returns to todo and the cycle clears
    expect(board.records.get(task.id)?.status).toBe('todo')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose).toBeUndefined()
    expect(board.statusChanges.at(-1)).toMatchObject({ status: 'todo', initiator: 'github:remote-reopen' })
  })

  it('operator who completed a card locally keeps it done when the issue closes and reopens', async () => {
    // Given a card the operator moved to done before the remote close
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const task = await importOpenIssue(board, backend, service)
    service.host.tasks.setStatus(task.id, 'done', 'user')

    // When the issue closes and later reopens
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose).toBeUndefined()
    backend.issues[0]!.state = 'open'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the local completion is not rewritten
    expect(board.records.get(task.id)?.status).toBe('done')
    expect(board.statusChanges.filter(event => event.initiator === 'github:remote-reopen')).toEqual([])
  })

  it('operator moving an auto-done card wins this close cycle but not the next one', async () => {
    // Given a card automatically completed by a remote close
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const task = await importOpenIssue(board, backend, service)
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')

    // When the operator moves it back to todo and the closed issue syncs again
    service.host.tasks.setStatus(task.id, 'todo', 'user')
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the local move wins and is remembered as an override
    expect(board.records.get(task.id)?.status).toBe('todo')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose?.state).toBe('overridden')

    // When the issue reopens and then enters a new close cycle
    backend.issues[0]!.state = 'open'
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(board.records.get(task.id)?.status).toBe('todo')
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the new close auto-completes it again
    expect(board.records.get(task.id)?.status).toBe('done')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose?.state).toBe('auto-done')
  })

  it.each([
    { outcome: 'succeeded', settledStatus: 'done' },
    { outcome: 'failed', settledStatus: 'failed' },
    { outcome: 'cancelled', settledStatus: 'todo' },
  ] as const)('operator closing a running issue sees the $outcome settlement complete only on the next sync', async ({ outcome, settledStatus }) => {
    // Given a running card whose issue closes
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const imported = await importOpenIssue(board, backend, service)
    const openExecution: ExecutionRecord = { id: 'exec-1', startedAt: 110 }
    board.seed({ ...imported, status: 'running', executions: [openExecution] })
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the run is untouched and the close waits for that execution
    expect(board.records.get(imported.id)?.status).toBe('running')
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose).toEqual({ state: 'deferred', executionId: 'exec-1' })

    // When the execution settles and the provider records the actual board column
    const settledExecution: ExecutionRecord = { ...openExecution, result: outcome, settledAt: 120 }
    board.seed({ ...board.records.get(imported.id)!, status: settledStatus as TaskStatus, executions: [settledExecution] })
    await service.handleExecutionSettled(imported.id, settledExecution)
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose).toEqual({
      state: 'settled',
      executionId: 'exec-1',
      settledStatus,
    })

    // Then the next closed sync completes the deferred migration
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(board.records.get(imported.id)?.status).toBe('done')
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose?.state).toBe('auto-done')
  })

  it('operator moving a deferred card after settlement keeps the local move', async () => {
    // Given a deferred close whose failed execution has settled
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const imported = await importOpenIssue(board, backend, service)
    const openExecution: ExecutionRecord = { id: 'exec-1', startedAt: 110 }
    board.seed({ ...imported, status: 'running', executions: [openExecution] })
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')
    const settledExecution: ExecutionRecord = { ...openExecution, result: 'failed', settledAt: 120 }
    board.seed({ ...board.records.get(imported.id)!, status: 'failed', executions: [settledExecution] })
    await service.handleExecutionSettled(imported.id, settledExecution)

    // When the operator changes the settlement column before the next sync
    service.host.tasks.setStatus(imported.id, 'todo', 'user')
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then that change is an override rather than a stale deferred migration
    expect(board.records.get(imported.id)?.status).toBe('todo')
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose?.state).toBe('overridden')
  })

  it('operator reopening before settlement keeps the run and missing settlement evidence never forces a move', async () => {
    // Given a deferred close that reopens before its execution settles
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const imported = await importOpenIssue(board, backend, service)
    const openExecution: ExecutionRecord = { id: 'exec-1', startedAt: 110 }
    board.seed({ ...imported, status: 'running', executions: [openExecution] })
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')
    backend.issues[0]!.state = 'open'
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then the deferral is gone and the run stays put
    expect(board.records.get(imported.id)?.status).toBe('running')
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose).toBeUndefined()

    // And when a separate close cycle lacks its settlement event, the provider
    // treats the changed column as local instead of guessing at a migration
    backend.issues[0]!.state = 'closed'
    await service.syncRepository('deepseek-ai', 'dsh')
    const settledExecution: ExecutionRecord = { ...openExecution, result: 'failed', settledAt: 120 }
    board.seed({ ...board.records.get(imported.id)!, status: 'failed', executions: [settledExecution] })
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(board.records.get(imported.id)?.status).toBe('failed')
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose?.state).toBe('overridden')
  })

  it('operator archiving a card keeps it archived and unchanged by remote close', async () => {
    // Given an archived card
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const imported = await importOpenIssue(board, backend, service)
    board.seed({ ...imported, archivedAt: 90 })
    backend.issues[0]!.state = 'closed'

    // When the closed issue syncs
    await service.syncRepository('deepseek-ai', 'dsh')

    // Then archive history and column are untouched
    expect(board.records.get(imported.id)?.archivedAt).toBe(90)
    expect(board.records.get(imported.id)?.status).toBe('todo')
    expect(readTaskGitHubMetadata(board.records.get(imported.id))?.remoteClose).toBeUndefined()
  })

  it('operator whose provenance write fails gets a retry instead of a false manual Done', async () => {
    // Given an existing open card and a one-shot payload-write failure
    const board = new FakeBoard()
    const backend = new FakeGitHubBackend()
    const service = makeService(board, backend)
    const task = await importOpenIssue(board, backend, service)
    backend.issues[0]!.state = 'closed'
    board.failNextIntegrationWrite = true

    // When the close migration runs, its status move is rolled back with the error
    const failed = await service.syncRepository('deepseek-ai', 'dsh')
    expect(failed.errors).toContain('injected integration write failure')
    expect(board.records.get(task.id)?.status).toBe('todo')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose).toBeUndefined()

    // Then the next healthy pass can retry the complete transition
    await service.syncRepository('deepseek-ai', 'dsh')
    expect(board.records.get(task.id)?.status).toBe('done')
    expect(readTaskGitHubMetadata(board.records.get(task.id))?.remoteClose?.state).toBe('auto-done')
  })

  it('operator reading malformed close provenance gets a safe absent value', () => {
    // Given otherwise valid provider metadata with an invalid close marker
    // When normalization reads that metadata
    const metadata = normalizeGitHubMetadata({
      provider: 'github',
      owner: 'deepseek-ai',
      repository: 'dsh',
      issueNumber: 10,
      issueUrl: 'https://github.com/deepseek-ai/dsh/issues/10',
      remoteLabels: ['dsh'],
      remoteClose: { state: 'settled', settledStatus: 'unknown' },
    })

    // Then the unusable marker is dropped rather than driving a transition
    expect(metadata?.remoteClose).toBeUndefined()
  })
})
