/**
 * Per-host admission: the ceiling, the queue and its order across a restart.
 *
 * The queue is not stored anywhere of its own — it is the ordered set of cards
 * whose payload carries a queued run — so these cases prove the thing that
 * matters: the same cards, read again by a new process, come back in the same
 * order and nothing is started twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { NOW, createBoard, type BoardHarness } from './support/board.ts'
import { mountEngine } from './support/engine.ts'
import { createScriptedSsh } from './support/fake-ssh.ts'
import { dshOutput } from './support/output.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** The SSH payload the board stored for one card. */
function payloadOf(board: BoardHarness, taskId: string) {
  const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
  return parsed.ok ? parsed.value : undefined
}

/** The run id one card waits on. */
function runOf(board: BoardHarness, taskId: string): string {
  return payloadOf(board, taskId)?.activeRun?.runId ?? ''
}

/** The phase one card's run is in. */
function phaseOf(board: BoardHarness, taskId: string): string | undefined {
  return payloadOf(board, taskId)?.activeRun?.phase
}

describe('per-host admission', () => {
  it('operator running three cards on a host capped at two sees the third wait and then start', async () => {
    // Given a host capped at two and three cards pinned to it
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const workspaces = fakeWorkspaces({ cwd: '/srv/work' })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW, settings: { perHostCap: 2 } })
    cleanups.push(() => { mounted.release() })
    const cards = ['task-1', 'task-2', 'task-3'].map(id => board.createCard(id, { title: id }).id)
    for (const taskId of cards) {
      await mounted.extension.handleAction?.({
        extensionId: 'ssh',
        action: 'set-target',
        taskId,
        payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
      })
    }

    // When all three are started at once
    for (const taskId of cards) board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })

    // Then two hold the host and the third waits for a slot
    expect(cards.map(taskId => phaseOf(board, taskId))).toEqual(['running', 'running', 'queued'])
    expect(ssh.commands('start')).toHaveLength(2)

    // When the first one finishes and is polled
    const firstRun = runOf(board, cards[0] as string)
    ssh.finish(firstRun, { output: dshOutput({ sessionId: 'sess-1', text: 'first done' }) })
    await mounted.tick()
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(3) })

    // Then the waiting card took the slot, in the order it was queued
    expect(phaseOf(board, cards[2] as string)).toBe('running')
    expect(ssh.commands('start')[2]).toContain(runOf(board, cards[2] as string))
  })

  it('operator taking a running card away frees its slot for the card that waited', async () => {
    // Given a host capped at one with two cards, the second waiting
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW, settings: { perHostCap: 1 } })
    cleanups.push(() => { mounted.release() })
    const cards = ['task-1', 'task-2'].map(id => board.createCard(id, { title: id }).id)
    for (const taskId of cards) {
      await mounted.extension.handleAction?.({
        extensionId: 'ssh',
        action: 'set-target',
        taskId,
        payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
      })
    }
    for (const taskId of cards) board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    expect(phaseOf(board, cards[1] as string)).toBe('queued')

    // When the running card is moved back to the todo column
    board.apply({ kind: 'move', taskId: cards[0] as string, status: 'todo' })
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(2) })

    // Then the waiting card took the freed slot without waiting for a poll
    expect(phaseOf(board, cards[1] as string)).toBe('running')
    expect(ssh.commands('start')[1]).toContain(runOf(board, cards[1] as string))
  })

  it('operator restarting the host keeps the queue order it had', async () => {
    // Given a host capped at one with three cards, one running and two waiting
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const workspaces = fakeWorkspaces({ cwd: '/srv/work' })
    const first = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW, settings: { perHostCap: 1 } })
    const cards = ['task-1', 'task-2', 'task-3'].map(id => board.createCard(id, { title: id }).id)
    for (const taskId of cards) {
      await first.extension.handleAction?.({
        extensionId: 'ssh',
        action: 'set-target',
        taskId,
        payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
      })
    }
    for (const taskId of cards) board.apply({ kind: 'run', taskId })
    await first.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    const runningRun = runOf(board, cards[0] as string)
    const queuedRun = runOf(board, cards[1] as string)
    const lastRun = runOf(board, cards[2] as string)
    expect([phaseOf(board, cards[0] as string), phaseOf(board, cards[1] as string), phaseOf(board, cards[2] as string)])
      .toEqual(['running', 'queued', 'queued'])
    first.release()

    // When the host comes back and the running card finishes
    const second = mountEngine({ board, ssh: ssh.service, workspaces: workspaces.resolver, now: () => NOW, settings: { perHostCap: 1 } })
    cleanups.push(() => { second.release() })
    await second.tick(0)
    ssh.finish(runningRun, { output: dshOutput({ sessionId: 'sess-1', text: 'first done' }) })
    await vi.waitFor(async () => {
      await second.tick()
      expect(ssh.commands('start')).toHaveLength(2)
    })

    // Then the queue was served in the order it was read back, not by card id
    expect(ssh.commands('start')[1]).toContain(queuedRun)
    expect(ssh.commands('start')[1]).not.toContain(lastRun)
    expect(phaseOf(board, cards[1] as string)).toBe('running')
    expect(phaseOf(board, cards[2] as string)).toBe('queued')
  })
})
