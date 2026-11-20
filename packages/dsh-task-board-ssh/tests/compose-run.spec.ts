/** @vitest-environment jsdom */

/**
 * A card that was created already pinned: the target picked in the create
 * dialog's own seat is the target the board stores, and the run it starts is
 * taken over at the board's launch gate with no local session, no detail-seat
 * write and one remote `start`.
 *
 * This is the case the seat exists for, so nothing here is a stand-in: the board
 * is the production host service with its real ledger and launch gate, the
 * provider is the real extension with its real engine, and the `dshSsh` face
 * hands every command to this machine's own `sh` inside a scratch home, so the
 * shipped launcher really installs, detaches and reports. The only thing the case
 * supplies is the transport between them: the board's own published summary,
 * read back from its snapshot exactly as a mirror frame carries it.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { SshComposeSection } from '../src/client/ssh/compose-section.tsx'
import { acceptPublishedSummary, resetSummaryStore } from '../src/client/ssh/summary.ts'
import type { TaskBoardExtensionPayload } from '../src/core/contract.ts'
import { stateDirForHome } from '../src/core/launcher.ts'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { NOW, createBoard, executionsOf } from './support/board.ts'
import { mountEngine } from './support/engine.ts'
import { createLocalSsh } from './support/fake-ssh.ts'
import { dshLines, printingPrompt } from './support/output.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanup()
  resetSummaryStore()
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A scratch directory removed when the spec ends. */
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

/** The agent override that runs a prompt as a script, because no account is logged in here. */
const SCRIPTED_AGENT = { agentCommands: { dsh: { command: 'sh {prompt_file}' } } }

describe('a card created with its target already chosen', () => {
  it('operator creating a pinned card sees the run taken over on the host, with no local session and no detail-seat write', async () => {
    // Given a mounted provider whose published summary is the board's own
    const home = scratch('dsh-ssh-home-')
    const work = scratch('dsh-ssh-work-')
    const ssh = createLocalSsh({ home })
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({
      board,
      ssh: ssh.service,
      workspaces: fakeWorkspaces({ cwd: work }).resolver,
      now: () => NOW,
      settings: SCRIPTED_AGENT,
    })
    cleanups.push(() => { mounted.release() })
    acceptPublishedSummary(board.board.snapshot().extensions ?? {})

    // When the operator picks a target in the create dialog's own row
    const contribute = vi.fn<(extensionId: string, payload: TaskBoardExtensionPayload | undefined) => void>()
    render(createElement(SshComposeSection, { contribute }))
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))
    // The picker offers the host list the provider published, not one this spec
    // invented, so choosing an alias here is choosing one the run can address.
    fireEvent.change(screen.getByLabelText('主机'), { target: { value: 'build-box' } })
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: work } })
    const seats = contribute.mock.calls.filter(call => call[0] === 'ssh')
    const draft = seats[seats.length - 1]?.[1]
    if (draft === undefined) throw new Error('the seat reported no draft for a complete target')

    // Then that draft is one the provider's own reader accepts, and the board
    // stores it on the card the dialog creates
    expect(parseSshLedgerPayload(draft).ok).toBe(true)
    const task = board.createCard('task-compose', {
      title: 'build the thing',
      prompt: printingPrompt(dshLines({ sessionId: 'sess-compose', text: 'the work is done' })),
      integrations: { ssh: draft },
    })
    expect(board.task(task.id)?.integrations?.['ssh']).toEqual(draft)

    // When the operator starts that card from the board
    board.apply({ kind: 'run', taskId: task.id })
    await vi.waitFor(() => { expect(ssh.calls.filter(call => call.verb === 'start')).toHaveLength(1) })

    // Then the launch was taken over before any session existed: the card is
    // running, no local session was asked for, and no execution record — which
    // only the board's own session launch would write — was created
    expect(board.task(task.id)?.status).toBe('running')
    expect(board.prompts).toEqual([])
    expect(executionsOf(board.task(task.id))).toHaveLength(0)
    const started = parseSshLedgerPayload(board.task(task.id)?.integrations?.['ssh'])
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('the running card lost its payload')
    // The target is the one the seat reported, untouched by the run: nothing on
    // the detail seat wrote it, because nothing on the detail seat ran.
    expect(started.value.target).toEqual(draft.target)
    expect(started.value.activeRun?.phase).toBe('running')
    const runId = started.value.activeRun?.runId ?? ''

    // When the detached agent really finishes on the host
    await vi.waitFor(() => { expect(existsSync(join(stateDirForHome(home), 'runs', runId, 'exit'))).toBe(true) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(task.id)?.status).toBe('done')
    })

    // Then the card closed through the board's external-outcome action: one
    // record marked external, carrying the adapter's own summary and naming the
    // provider agent that produced it
    const executions = executionsOf(board.task(task.id))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.external).toBe(true)
    expect(executions[0]?.result).toBe('succeeded')
    expect(executions[0]?.summary?.text).toBe('the work is done')
    expect(executions[0]?.initiatedBy).toBe('ssh:' + runId)
    const settled = parseSshLedgerPayload(board.task(task.id)?.integrations?.['ssh'])
    expect(settled.ok).toBe(true)
    if (!settled.ok) throw new Error('the settled card lost its payload')
    expect(settled.value.activeRun).toBeUndefined()
    expect(settled.value.history.map(run => [run.phase, run.sessionId, run.exitCode]))
      .toEqual([['succeeded', 'sess-compose', 0]])
    expect(ssh.calls.filter(call => call.verb === 'start')).toHaveLength(1)
  })
})
