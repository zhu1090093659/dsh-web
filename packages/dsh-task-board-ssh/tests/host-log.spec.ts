/**
 * The log a card carries, and the only way its bytes reach a browser.
 *
 * The ledger payload is bounded and holds no log at all, and a dispatched action
 * answers a boolean, so the bytes travel through the extension's published
 * summary as byte-addressed windows. These cases prove the window contract the
 * client decodes against: what each publish carries, what a viewer's replay
 * carries, and what happens to a window larger than its budget.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { LOG_WINDOW_BUDGET_BYTES, PUBLISH_BODY_LIMIT_BYTES, PUBLISH_LOG_BUDGET_BYTES, byteLength } from '../src/host/logs.ts'
import { NOW, createBoard, type BoardHarness } from './support/board.ts'
import { mountEngine, type Mounted } from './support/engine.ts'
import { createScriptedSsh, type ScriptedSsh } from './support/fake-ssh.ts'
import { dshOutput } from './support/output.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** One window as the client decodes it. */
interface Window {
  runId: string
  baseOffset: number
  endOffset: number
  text: string
  truncated?: boolean
}

/** The window section one publish carried. */
function logsOf(mounted: Mounted): Record<string, Window> {
  return (mounted.published()?.logs ?? {}) as Record<string, Window>
}

/** The SSH payload the board stored for one card. */
function payloadOf(board: BoardHarness, taskId: string) {
  const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
  return parsed.ok ? parsed.value : undefined
}

/**
 * Mount the provider with one card already running on the scripted host.
 * @param options - how many cards, and the host's ceiling.
 * @returns the mount, the host, the board and the cards with their runs.
 */
async function runningCards(options: { count?: number } = {}) {
  const count = options.count ?? 1
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
  const cards: Array<{ taskId: string; runId: string }> = []
  for (let index = 0; index < count; index += 1) {
    const taskId = board.createCard('task-' + String(index + 1), { title: 'card ' + String(index + 1) }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
    })
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    cards.push({ taskId, runId: payloadOf(board, taskId)?.activeRun?.runId ?? '' })
  }
  await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(count) })
  return { ssh, board, mounted, cards }
}

/** Append text to one run's log the way an agent writes it. */
function appendLog(ssh: ScriptedSsh, runId: string, text: string): void {
  const run = ssh.runs.get(runId)
  if (run === undefined) throw new Error('the host holds no run ' + runId)
  run.output += text
}

describe('the log window a card publishes', () => {
  it('operator watching a running card receives one window per publish, addressed by byte offset', async () => {
    // Given a card whose run has written one line
    const { ssh, mounted, cards } = await runningCards()
    const card = cards[0] as { taskId: string; runId: string }
    appendLog(ssh, card.runId, 'first line\n')
    await mounted.tick()

    // Then the publish carried exactly those bytes, from offset zero
    const first = logsOf(mounted)[card.taskId]
    expect(first?.runId).toBe(card.runId)
    expect(first?.baseOffset).toBe(0)
    expect(first?.endOffset).toBe(byteLength('first line\n'))
    expect(first?.text).toBe('first line\n')
    expect(first?.truncated).toBeUndefined()

    // When the run writes more
    appendLog(ssh, card.runId, 'second line\n')
    await mounted.tick()

    // Then the next window begins where the previous one ended
    const second = logsOf(mounted)[card.taskId]
    expect(second?.baseOffset).toBe(byteLength('first line\n'))
    expect(second?.endOffset).toBe(byteLength('first line\nsecond line\n'))
    expect(second?.text).toBe('second line\n')
  })

  it('operator reopening a card detail gets the log replayed from its first byte', async () => {
    // Given a run whose log was already published in increments
    const { ssh, mounted, cards } = await runningCards()
    const card = cards[0] as { taskId: string; runId: string }
    appendLog(ssh, card.runId, 'first line\n')
    await mounted.tick()
    appendLog(ssh, card.runId, 'second line\n')
    await mounted.tick()

    // When the viewer asks for that card again through the refresh action
    const reply = await mounted.extension.handleAction?.({ extensionId: 'ssh', action: 'refresh', taskId: card.taskId }) as { ok: boolean }

    // Then the publish carries the whole log again, from zero
    expect(reply.ok).toBe(true)
    const replay = logsOf(mounted)[card.taskId]
    expect(replay?.baseOffset).toBe(0)
    expect(replay?.endOffset).toBe(byteLength('first line\nsecond line\n'))
    expect(replay?.text).toBe('first line\nsecond line\n')
  })

  it('operator reading a run that wrote more than a window gets the rest in the next publish', async () => {
    // Given a run that wrote past the per-card window budget in one go
    const { ssh, mounted, cards } = await runningCards()
    const card = cards[0] as { taskId: string; runId: string }
    const burst = 'x'.repeat(LOG_WINDOW_BUDGET_BYTES * 2)
    appendLog(ssh, card.runId, burst)
    await mounted.tick()

    // Then the window stops at its budget and says so
    const first = logsOf(mounted)[card.taskId]
    expect(first?.truncated).toBe(true)
    expect(byteLength(first?.text ?? '')).toBe(LOG_WINDOW_BUDGET_BYTES)
    expect(first?.endOffset).toBe(LOG_WINDOW_BUDGET_BYTES)

    // When the card is polled again
    await mounted.tick()

    // Then the continuation is delivered, starting exactly where the last one stopped
    const second = logsOf(mounted)[card.taskId]
    expect(second?.baseOffset).toBe(LOG_WINDOW_BUDGET_BYTES)
    expect(second?.endOffset).toBe(byteLength(burst))
    expect(second?.text).toBe(burst.slice(LOG_WINDOW_BUDGET_BYTES))
  })

  it('operator closing a card never finds its log bytes in the card payload', async () => {
    // Given a run whose stream carries progress lines and a final summary
    const { ssh, board, mounted, cards } = await runningCards()
    const card = cards[0] as { taskId: string; runId: string }
    const stream = [
      JSON.stringify({ type: 'session', sessionId: 'sess-1' }),
      JSON.stringify({ type: 'status', phase: 'step_start', step: 1 }),
      JSON.stringify({ type: 'final', sessionId: 'sess-1', reason: { kind: 'completed' }, text: 'the work is done' }),
    ].join('\n') + '\n'
    appendLog(ssh, card.runId, stream)
    await mounted.tick()
    expect(logsOf(mounted)[card.taskId]?.text).toContain('step_start')

    // When that run settles
    ssh.finish(card.runId, { output: stream })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(card.taskId)?.status).toBe('done')
    })

    // Then the payload holds the account of the run, its size and its summary, and
    // not the stream those came from
    const stored = JSON.stringify(board.task(card.taskId)?.integrations)
    expect(stored).toContain(card.runId)
    expect(stored).toContain('the work is done')
    expect(stored).not.toContain('step_start')
    expect(stored).not.toContain('"type":"session"')
    expect(payloadOf(board, card.taskId)?.history[0]?.bytes).toBeGreaterThan(0)
  })

  it('operator with more windows than one publish carries sees every card served, and none over the budget', async () => {
    // Given more cards with a full window each than one publish's log budget carries
    const { ssh, mounted, cards } = await runningCards({ count: 6 })
    const burst = 'y'.repeat(LOG_WINDOW_BUDGET_BYTES + 256)
    for (const card of cards) appendLog(ssh, card.runId, burst)
    await mounted.tick()

    // Then the publish stayed inside its own body budget
    const published = JSON.stringify(mounted.published())
    expect(byteLength(published)).toBeLessThanOrEqual(PUBLISH_BODY_LIMIT_BYTES)
    const delivered = Object.keys(logsOf(mounted)).length
    expect(delivered).toBeGreaterThan(0)
    expect(delivered * LOG_WINDOW_BUDGET_BYTES).toBeLessThanOrEqual(PUBLISH_LOG_BUDGET_BYTES)

    // When the cards are polled again and again
    const served = new Set(Object.keys(logsOf(mounted)))
    for (let round = 0; round < 4 && served.size < cards.length; round += 1) {
      await mounted.tick()
      for (const taskId of Object.keys(logsOf(mounted))) served.add(taskId)
    }

    // Then every card was served in the end, and each publish stayed inside its budget
    expect(served.size).toBe(cards.length)
    expect(byteLength(JSON.stringify(mounted.published()))).toBeLessThanOrEqual(PUBLISH_BODY_LIMIT_BYTES)
  })
})

describe('the run a viewer names', () => {
  it('operator naming a settled run gets that run replayed, and a run the card never had is refused', async () => {
    // Given a card whose run wrote one line and then settled
    const { ssh, board, mounted, cards } = await runningCards()
    const card = cards[0] as { taskId: string; runId: string }
    const output = 'first line\n' + dshOutput({ sessionId: 'sess-named', text: 'named run' })
    appendLog(ssh, card.runId, output)
    await mounted.tick()
    ssh.finish(card.runId, { output })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(card.taskId)?.status).toBe('done')
    })

    // When the detail view asks for that run by name
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'refresh',
      taskId: card.taskId,
      payload: { runId: card.runId },
    }) as { ok: boolean }

    // Then exactly that run's log was replayed from its first byte
    expect(reply.ok).toBe(true)
    const replay = logsOf(mounted)[card.taskId]
    expect(replay?.runId).toBe(card.runId)
    expect(replay?.baseOffset).toBe(0)
    expect(replay?.text).toBe(output)

    // When it names a run the card never had
    const refused = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'refresh',
      taskId: card.taskId,
      payload: { runId: 'run-never-happened' },
    }) as { ok: boolean; error?: string }

    // Then the refusal names the run instead of replaying somebody else's log
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('run-never-happened')

    // And the pager refuses the same run for the same reason
    const paged = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'read-log',
      taskId: card.taskId,
      payload: { runId: 'run-never-happened' },
    }) as { ok: boolean; error?: string }
    expect(paged.ok).toBe(false)
    expect(paged.error).toContain('run-never-happened')

    // And a run named without its card is refused as ambiguous
    const orphan = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'refresh',
      payload: { runId: card.runId },
    }) as { ok: boolean; error?: string }
    expect(orphan.ok).toBe(false)
    expect(orphan.error).toContain('taskId')
  })
})

describe('the log pager action', () => {
  it('operator paging a finished run reads it by byte offset', async () => {
    // Given a run whose log is known
    const { ssh, mounted, cards } = await runningCards()
    const card = cards[0] as { taskId: string; runId: string }
    appendLog(ssh, card.runId, 'abcdefghij')

    // When the card surface reads the first page
    const first = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'read-log',
      taskId: card.taskId,
      payload: { offset: 0, limit: 4 },
    }) as { ok: boolean; text: string; nextOffset: number; eof: boolean; runId: string }

    // Then it received four bytes and the offset to continue from
    expect(first.ok).toBe(true)
    expect(first.runId).toBe(card.runId)
    expect(first.text).toBe('abcd')
    expect(first.nextOffset).toBe(4)
    expect(first.eof).toBe(false)

    // When it reads on from there
    const second = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'read-log',
      taskId: card.taskId,
      payload: { offset: first.nextOffset, limit: 4096 },
    }) as { ok: boolean; text: string; eof: boolean }

    // Then it received the rest and knows the log ended
    expect(second.ok).toBe(true)
    expect(second.text).toBe('efghij')
    expect(second.eof).toBe(true)
  })
})
