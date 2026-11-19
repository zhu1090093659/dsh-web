/**
 * The wire between this browser half and the shipped host half.
 *
 * The client decodes whatever the provider publishes and dispatches the
 * envelopes `src/core/action.ts` defines; both sides have to agree on the
 * shapes or the log viewer and every control quietly do nothing. These cases
 * mount the real provider on the real board (S4's own support helpers), take
 * the summary it really publishes, and drive it through the client's decoder and
 * log buffer — then hand the host the exact envelopes the client builds, so a
 * drift on either side fails here instead of in the GUI.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeSummary } from '../src/client/ssh/summary.ts'
import { SshLogBuffer } from '../src/client/ssh/log-buffer.ts'
import { LOG_WINDOW_BUDGET_BYTES, byteLength } from '../src/host/logs.ts'
import { NOW, createBoard, type BoardHarness } from './support/board.ts'
import { mountEngine, type Mounted } from './support/engine.ts'
import { createScriptedSsh, type ScriptedSsh } from './support/fake-ssh.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** The target the client's form sends for a plain in-place run. */
const TARGET = {
  mode: 'direct',
  host: 'build-box',
  agent: { kind: 'dsh' },
  workspace: { kind: 'in-place', path: '/srv/work' },
} as const

/** Mount the provider with one card already pinned to the scripted host. */
async function mountedCard(): Promise<{ ssh: ScriptedSsh; board: BoardHarness; mounted: Mounted; taskId: string }> {
  const ssh = createScriptedSsh()
  const board = createBoard({ sessions: false })
  cleanups.push(() => { board.dispose() })
  const mounted = mountEngine({
    board,
    ssh: ssh.service,
    workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver,
    now: () => NOW,
    settings: { perHostCap: 16 },
  })
  cleanups.push(() => { mounted.release() })
  const taskId = board.createCard('task-1', { title: 'ship it' }).id
  // The envelope the target form dispatches, verbatim.
  const reply = await mounted.extension.handleAction?.({
    extensionId: 'ssh',
    action: 'set-target',
    taskId,
    payload: { target: TARGET },
  }) as { ok: boolean }
  expect(reply.ok).toBe(true)
  return { ssh, board, mounted, taskId }
}

/** Start the card's run and let the provider record it. */
async function startRun(mounted: Mounted, board: BoardHarness, taskId: string): Promise<string> {
  board.apply({ kind: 'run', taskId })
  await mounted.tick(0)
  const active = await vi.waitFor(() => {
    const payload = board.task(taskId)?.integrations?.['ssh'] as { activeRun?: { runId?: string } } | undefined
    const runId = payload?.activeRun?.runId
    if (runId === undefined) throw new Error('no run recorded yet')
    return runId
  })
  return active
}

/** Append text to one run's stdout the way an agent writes it. */
function appendLog(ssh: ScriptedSsh, runId: string, text: string): void {
  const run = ssh.runs.get(runId)
  if (run === undefined) throw new Error('the host holds no run ' + runId)
  run.output += text
}

/** The summary the provider most recently published, as the client decodes it. */
function publishedSummary(mounted: Mounted) {
  const decoded = decodeSummary(mounted.published())
  if (decoded === undefined) throw new Error('the provider published nothing')
  return decoded
}

describe('the published document the client decodes', () => {
  it('user opening a card sees the provider and defaults the publisher really sends', async () => {
    // Given a provider mounted on the board with one pinned card
    const { ssh, mounted } = await mountedCard()
    const configured = ssh.hosts[0] as { alias: string; host: string; user: string }

    // When the client decodes the document the provider publishes
    const summary = publishedSummary(mounted)

    // Then the picker's host list mirrors the dshSsh store, without its secrets
    expect(summary.hosts).toMatchObject([{ alias: configured.alias, host: configured.host, user: configured.user }])
    // The published summary carries no port, so the decoder states the SSH default.
    expect(summary.hosts?.[0]?.port).toBe(22)
    expect(summary.defaults).toEqual({ agent: 'dsh', mode: 'direct' })
    expect(JSON.stringify(summary)).not.toContain('proxyCommand')
  })
})

describe('the log increments the client appends', () => {
  it('user watching a running card sees each publish append the bytes it read', async () => {
    // Given a running card whose provider published one line
    const { ssh, board, mounted, taskId } = await mountedCard()
    const runId = await startRun(mounted, board, taskId)
    const buffer = new SshLogBuffer()
    appendLog(ssh, runId, 'first line\n')
    await mounted.tick()
    const first = publishedSummary(mounted).logs?.[taskId]
    expect(first).toMatchObject({ runId, baseOffset: 0, text: 'first line\n' })
    buffer.append(first as { runId: string; baseOffset: number; endOffset: number; text: string })

    // When the agent writes more and the provider publishes again
    appendLog(ssh, runId, 'second line\n')
    await mounted.tick()
    const second = publishedSummary(mounted).logs?.[taskId]
    expect(second?.baseOffset).toBe(byteLength('first line\n'))
    buffer.append(second as { runId: string; baseOffset: number; endOffset: number; text: string })

    // Then the viewer holds both lines, in order, exactly once
    expect(buffer.toLines()).toEqual(['first line', 'second line'])
    expect(buffer.snapshot()).toMatchObject({ start: 0, truncated: false })
  })

  it('user reopening a card detail sees the log replayed from its first byte', async () => {
    // Given a run whose output was published in two increments
    const { ssh, board, mounted, taskId } = await mountedCard()
    const runId = await startRun(mounted, board, taskId)
    appendLog(ssh, runId, 'first line\n')
    await mounted.tick()
    appendLog(ssh, runId, 'second line\n')
    await mounted.tick()

    // When the viewer dispatches the refresh envelope the detail section builds
    const reply = await mounted.extension.handleAction?.({ extensionId: 'ssh', action: 'refresh', taskId, payload: { runId } }) as { ok: boolean }

    // Then the provider answered and republished the whole log from zero
    expect(reply.ok).toBe(true)
    const replay = publishedSummary(mounted).logs?.[taskId]
    expect(replay).toMatchObject({ runId, baseOffset: 0, text: 'first line\nsecond line\n' })

    // And a panel that resets and takes that window shows the log from the start
    const buffer = new SshLogBuffer()
    buffer.reset(runId)
    buffer.append(replay as { runId: string; baseOffset: number; endOffset: number; text: string })
    expect(buffer.toLines()).toEqual(['first line', 'second line'])
  })

  it('user reading a burst larger than one window sees the continuation, and a missed window shows as a gap', async () => {
    // Given a run that wrote three windows' worth of output
    const { ssh, board, mounted, taskId } = await mountedCard()
    const runId = await startRun(mounted, board, taskId)
    const buffer = new SshLogBuffer()
    appendLog(ssh, runId, 'x'.repeat(LOG_WINDOW_BUDGET_BYTES * 3))
    await mounted.tick()
    const first = publishedSummary(mounted).logs?.[taskId]
    expect(first?.truncated).toBe(true)
    expect(first?.endOffset).toBe(LOG_WINDOW_BUDGET_BYTES)
    buffer.append(first as { runId: string; baseOffset: number; endOffset: number; text: string })

    // When the next two publishes arrive and the viewer receives the second but
    // not the middle one (a frame the browser never saw)
    await mounted.tick()
    const second = publishedSummary(mounted).logs?.[taskId]
    await mounted.tick()
    const third = publishedSummary(mounted).logs?.[taskId]
    expect(second?.baseOffset).toBe(LOG_WINDOW_BUDGET_BYTES)
    expect(third?.baseOffset).toBe(LOG_WINDOW_BUDGET_BYTES * 2)
    buffer.append(third as { runId: string; baseOffset: number; endOffset: number; text: string })

    // Then the buffer kept what it had, flagged the missing interval, and took the rest
    expect(buffer.snapshot().truncated).toBe(true)
    expect(buffer.snapshot().end).toBe(LOG_WINDOW_BUDGET_BYTES * 3)
  })
})

describe('the envelopes the client dispatches', () => {
  it('operator driving a card with the client envelopes is accepted by the shipped router', async () => {
    // Given a running card
    const { board, mounted, taskId } = await mountedCard()
    const runId = await startRun(mounted, board, taskId)
    const send = async (action: string, rest: Record<string, unknown> = {}): Promise<{ ok?: boolean; issues?: unknown[] }> => {
      return await mounted.extension.handleAction?.({ extensionId: 'ssh', action, ...rest }) as { ok?: boolean; issues?: unknown[] }
    }

    // When the client's own envelopes are handed to the host
    const refreshed = await send('refresh', { taskId, payload: { runId } })
    const followed = await send('follow-up', { taskId, payload: { text: 'keep going' } })
    const cancelled = await send('cancel', { taskId })

    // Then none of them is refused at the protocol level: a shape mismatch is
    // the only thing that answers with field issues
    for (const reply of [refreshed, followed, cancelled]) expect(reply.issues).toBeUndefined()
    expect(refreshed.ok).toBe(true)
    expect(cancelled.ok).toBe(true)

    // And a payload the client could never build is refused with its field path,
    // which is what makes the check above sensitive rather than empty
    const refused = await send('set-target', { taskId, payload: { target: { mode: 'direct' } } })
    expect(refused.ok).toBe(false)
    expect(refused.issues?.[0]).toMatchObject({ path: 'payload.target.host' })
  })
})
