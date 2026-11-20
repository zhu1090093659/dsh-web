/**
 * The agent-facing surface: one call creates a card with its target after the
 * target was checked, one call runs it and waits, and what comes back is a
 * handle, a uniform status and a filtered log instead of raw plumbing.
 *
 * The host is this machine's own `sh` inside a scratch home (`createLocalSsh`),
 * so the preflight, the launcher and the log pipeline are the shipped shell, not
 * a model of it.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOG_LINE_MAX_BYTES, logCommand, readLogAnswer } from '../src/host/inspect.ts'
import { createBoard, executionsOf, type BoardHarness } from './support/board.ts'
import { mountEngine, runTool, type Mounted } from './support/engine.ts'
import { createLocalSsh } from './support/fake-ssh.ts'
import { dshLines, printingPrompt, waitingLoop } from './support/output.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
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

/** One mounted provider on a real board and this machine's shell. */
function setup(): { mounted: Mounted; board: BoardHarness; work: string } {
  const work = scratch('dsh-surface-work-')
  const ssh = createLocalSsh({ home: scratch('dsh-surface-home-') })
  const board = createBoard({ sessions: false })
  cleanups.push(() => { board.dispose() })
  const mounted = mountEngine({
    board,
    ssh: ssh.service,
    workspaces: fakeWorkspaces({ cwd: work }).resolver,
    settings: SCRIPTED_AGENT,
  })
  cleanups.push(() => { mounted.release() })
  return { mounted, board, work }
}

/** How many cards the board holds. */
function cardCount(board: BoardHarness): number {
  return board.board.snapshot().tasks.length
}

const create = (mounted: Mounted, args: Record<string, unknown>) => runTool(mounted, 'task_board_ssh', { action: 'create', ...args })

describe('creating a card with its target', () => {
  it('operator naming a directory that does not exist is refused before any card exists', async () => {
    // Given a reachable host and a directory that is not there
    const { mounted, board, work } = setup()

    // When a card is created with that directory as its in-place workspace
    const reply = await create(mounted, { title: 't', prompt: 'p', host: 'build-box', agent: 'dsh', workspacePath: join(work, 'nope') })

    // Then the stable code says what to fix and no half-made card is left behind
    expect(reply.ok).toBe(false)
    expect(reply.code).toBe('path-missing')
    expect(String(reply.hint)).toContain('Create the directory')
    expect(cardCount(board)).toBe(0)
  })

  it('operator misspelling the host alias hears host-unreachable with the aliases that exist', async () => {
    // Given a deployment that serves one host, build-box
    const { mounted, board, work } = setup()

    // When the card names a host that is not configured, and another that is not even an alias
    const unknown = await create(mounted, { title: 't', prompt: 'p', host: 'build-bxo', workspacePath: work })
    const malformed = await create(mounted, { title: 't', prompt: 'p', host: 'bad host!', workspacePath: work })

    // Then both are host-unreachable, the first lists what is configured, and no card exists
    expect(unknown.code).toBe('host-unreachable')
    expect(String(unknown.message)).toContain('build-box')
    expect(malformed.code).toBe('host-unreachable')
    expect(cardCount(board)).toBe(0)
  })

  it('operator naming an agent that does not exist is told the valid ones', async () => {
    // Given a reachable host and a real directory
    const { mounted, board, work } = setup()

    // When the agent name is not one of the supported kinds
    const reply = await create(mounted, { title: 't', prompt: 'p', host: 'build-box', agent: 'gpt-9', workspacePath: work })

    // Then the code is agent-missing and the message lists dsh, claude, codex and custom
    expect(reply.code).toBe('agent-missing')
    expect(String(reply.message)).toContain('dsh, claude, codex, custom')
    expect(cardCount(board)).toBe(0)
  })

  it('operator naming an agent program the host does not have is refused with agent-missing', async () => {
    // Given a custom agent whose program is not installed on the host
    const { mounted, board, work } = setup()

    // When the card is created
    const reply = await create(mounted, {
      title: 't', prompt: 'p', host: 'build-box', agent: 'custom', agentCommand: 'no-such-agent-program-xyz {prompt_file}', workspacePath: work,
    })

    // Then the host answered but the program is not on its PATH
    expect(reply.code).toBe('agent-missing')
    expect(String(reply.message)).toContain('no-such-agent-program-xyz')
    expect(cardCount(board)).toBe(0)
  })

  it.skipIf(process.getuid?.() === 0)('operator naming a directory the ssh user cannot write is refused with permission-required', async () => {
    // Given a directory that exists but is read-only for this user
    const { mounted, board, work } = setup()
    const locked = join(work, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o555)
    cleanups.unshift(() => { chmodSync(locked, 0o755) })

    // When the card is created inside it
    const reply = await create(mounted, { title: 't', prompt: 'p', host: 'build-box', agent: 'dsh', workspacePath: locked })

    // Then the refusal names the permission, not the path
    expect(reply.code).toBe('permission-required')
    expect(cardCount(board)).toBe(0)
  })

  it('operator creating a valid card finds the target on the card and a remote marker in the board tools', async () => {
    // Given a reachable host and an existing directory
    const { mounted, board, work } = setup()

    // When the card is created without running it
    const reply = await create(mounted, { title: 'build', prompt: 'p', host: 'build-box', agent: 'dsh', workspacePath: work })

    // Then it exists with its target, and the provider describes it for get and list
    expect(reply.ok).toBe(true)
    const task = board.task(String(reply.taskId))
    const view = mounted.extension.describeTask?.(task as never)
    expect(view).toMatchObject({ host: 'build-box', agent: 'dsh', mode: 'direct', workspace: 'in-place', canFollowUp: true, localPermission: false })
  })
})

describe('running a card through one call', () => {
  it('operator creating with run and wait gets the handle, the settled verdict and a summary that is not an error', async () => {
    // Given a card whose prompt prints a finished dsh run
    const { mounted, board, work } = setup()

    // When one call creates, runs and waits
    const reply = await create(mounted, {
      title: 'build',
      prompt: printingPrompt(dshLines({ sessionId: 'sess-1', text: 'the work is done' })),
      host: 'build-box',
      agent: 'dsh',
      workspacePath: work,
      run: true,
      wait: true,
      timeoutMs: 20_000,
    })

    // Then the handle names the run, the log and an estimate, and the status is settled
    expect(reply.ok).toBe(true)
    expect(reply.runId).toEqual(expect.any(String))
    expect(String(reply.logPath)).toContain(`${String(reply.runId)}/stdout.log`)
    expect(reply.estimatedDurationMs).toEqual(expect.any(Number))
    expect(reply.target).toMatchObject({ host: 'build-box', agent: 'dsh', mode: 'direct' })
    const status = reply.status as Record<string, unknown>
    expect(status).toMatchObject({ phase: 'succeeded', settled: true, result: 'succeeded', summary: 'the work is done', exitCode: 0, remoteSessionId: 'sess-1', error: null })

    // And the board execution carries the same id, the summary, and no error text
    const execution = executionsOf(board.task(String(reply.taskId)))[0]
    expect(execution?.id).toBe(reply.executionId)
    expect(execution?.summary?.text).toBe('the work is done')
    expect(execution?.error).toBeUndefined()
  })

  it('operator reading status of a running and of a settled run gets the same fields', async () => {
    // Given a run held open by a flag file
    const { mounted, work } = setup()
    const flag = join(work, 'release')
    const created = await create(mounted, {
      title: 'hold', prompt: waitingLoop(flag) + '\n' + printingPrompt(dshLines({ sessionId: 's', text: 'ok' })), host: 'build-box', agent: 'dsh', workspacePath: work, run: true,
    })
    const taskId = String(created.taskId)

    // When it is read while running, then again after it settles
    const running = await runTool(mounted, 'task_board_ssh', { action: 'status', taskId, activity: false })
    writeFileSync(flag, '')
    const settled = await runTool(mounted, 'task_board_ssh', { action: 'status', taskId, wait: true, timeoutMs: 20_000, activity: false })

    // Then both carry every key, phase never goes missing, and only the verdict differs
    const keys = ['phase', 'exitCode', 'result', 'summary', 'durationMs', 'remoteSessionId', 'lastActivityAt', 'error']
    for (const key of keys) {
      expect(running).toHaveProperty(key)
      expect(settled).toHaveProperty(key)
    }
    expect(['queued', 'running']).toContain(running.phase)
    expect(running.result).toBeNull()
    expect(settled).toMatchObject({ phase: 'succeeded', result: 'succeeded', timedOut: false })
  })

  it('operator asking for a second run while one is in flight is refused with run-active', async () => {
    // Given a run held open
    const { mounted, work } = setup()
    const flag = join(work, 'release')
    const created = await create(mounted, {
      title: 'hold', prompt: waitingLoop(flag) + '\n' + printingPrompt(dshLines({ sessionId: 's', text: 'ok' })), host: 'build-box', agent: 'dsh', workspacePath: work, run: true,
    })

    // When the same card is run again
    const second = await runTool(mounted, 'task_board_ssh', { action: 'run', taskId: String(created.taskId) })
    writeFileSync(flag, '')

    // Then the answer is the stable code, not an overwrite
    expect(second.ok).toBe(false)
    expect(second.code).toBe('run-active')
  })

  it('operator waiting on a run that outlasts the timeout gets a still-running answer, not an error', async () => {
    // Given a run held open
    const { mounted, work } = setup()
    const flag = join(work, 'release')
    const created = await create(mounted, {
      title: 'hold', prompt: waitingLoop(flag, 40) + '\n' + printingPrompt(dshLines({ sessionId: 's', text: 'ok' })), host: 'build-box', agent: 'dsh', workspacePath: work, run: true,
    })

    // When a wait of zero milliseconds is asked for
    const reply = await runTool(mounted, 'task_board_ssh', { action: 'status', taskId: String(created.taskId), wait: true, timeoutMs: 0, activity: false })

    // Then it says it timed out and is still running
    expect(reply).toMatchObject({ ok: true, timedOut: true, settled: false })
    writeFileSync(flag, '')
  })
})

describe('the filtered log', () => {
  /** Run one log command against a scratch file and parse its answer. */
  function readLog(lines: string[], query: Parameters<typeof logCommand>[0] extends infer Q ? Omit<Q & object, 'file'> : never) {
    const dir = scratch('dsh-surface-log-')
    const file = join(dir, 'stdout.log')
    writeFileSync(file, lines.join('\n') + '\n')
    const full = { ...query, file }
    const result = spawnSync('sh', ['-c', logCommand(full)], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    return readLogAnswer(result.stdout, full)
  }

  const noise = { type: 'system', subtype: 'thinking_tokens', tokens: 3 }
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
    ...Array.from({ length: 200 }, () => JSON.stringify(noise)),
    JSON.stringify({ type: 'stream_event', event: { delta: 'x' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/w/index.html' } }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }),
  ]

  it('operator reading the tail gets the real events and a cost that already excludes the noise', () => {
    // Given a log that is almost all thinking_tokens noise
    // When its tail is read
    const answer = readLog(lines, { tail: 10 })

    // Then the counts cover only init, the tool call and the result
    expect(answer.stats).toMatchObject({ lines: 3 })
    expect(answer.text).not.toContain('thinking_tokens')
    expect(answer.text).toContain('"name":"Write"')
    expect(answer.lines).toBe(3)
    expect(answer.more).toBe(false)
  })

  it('operator paging with a cursor continues where the last page ended', () => {
    // Given the same log, whose filtered view has three lines
    // When the read starts at the second filtered line
    const page = readLog(lines, { since: 2 })

    // Then init is skipped, the tool call and the result follow, and nothing remains
    expect(page.text).not.toContain('"subtype":"init"')
    expect(page.lines).toBe(2)
    expect(page.text).toContain('"type":"result"')
    expect(page.more).toBe(false)
  })

  it('operator reading a log with a huge line gets it cut and marked, and the reply stays under the cap', () => {
    // Given a log with one 10 KB line
    const huge = JSON.stringify({ type: 'user', message: 'x'.repeat(10_000) })

    // When it is read with a 1 KB cap
    const answer = readLog([huge, JSON.stringify({ type: 'result' })], { tail: 5, maxBytes: 1_024 })

    // Then no line exceeds the line bound and the text fits the cap
    expect(Math.max(...answer.text.split('\n').map(line => line.length))).toBeLessThanOrEqual(LOG_LINE_MAX_BYTES + 20)
    expect(new TextEncoder().encode(answer.text).length).toBeLessThanOrEqual(1_024)
  })

  it('operator asking only for the stats receives counts and no text', () => {
    // Given the noisy log
    // When statsOnly is set
    const answer = readLog(lines, { statsOnly: true })

    // Then the counts are there and the text is empty
    expect(answer.stats?.lines).toBe(3)
    expect(answer.text).toBe('')
  })
})

