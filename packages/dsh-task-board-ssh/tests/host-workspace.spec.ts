/**
 * A run whose repository is the LOCAL workspace.
 *
 * This is the one placement the deployment has to answer for: a bundle carries
 * commits, so a run's worktree starts from the local repository's HEAD and the
 * untracked working tree stays here. Two things therefore have to travel from the
 * deployment into the strategy — the repository's directory, resolved from the
 * workspace registry the board itself uses, and the strategy's note about the
 * files that were left behind — and this file drives both through the real S5
 * strategy against a real git repository.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'
import { createSshWorkspaceStrategy } from '../src/host/workspace/index.ts'
import {
  WORKSPACE_REGISTRY_SERVICE,
  readWorkspaceDirectory,
  resolveWorkspaceRegistry,
  untrackedNote,
  type WorkspaceRegistrySeat,
} from '../src/host/workspace-seam.ts'
import { NOW, createBoard, executionsOf, type BoardHarness } from './support/board.ts'
import { mountEngine, type Mounted } from './support/engine.ts'
import { createScriptedSsh } from './support/fake-ssh.ts'
import { dshOutput } from './support/output.ts'
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

/** Run one git command in one directory, with no user configuration leaking in. */
function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
}

/**
 * A real repository with one commit and one file nobody committed.
 * @returns its path and the number of untracked files in it.
 */
function localRepository(): { path: string; untracked: number } {
  const path = scratch('dsh-ws-repo-')
  git(path, ['init', '--quiet'])
  writeFileSync(join(path, 'README.md'), '# the repository\n')
  git(path, ['add', 'README.md'])
  git(path, ['-c', 'user.email=spec@example.com', '-c', 'user.name=spec', 'commit', '--quiet', '-m', 'first'])
  writeFileSync(join(path, 'notes.txt'), 'written but never committed\n')
  return { path, untracked: 1 }
}

/** The SSH payload the board stored for one card. */
function payloadOf(board: BoardHarness, taskId: string) {
  const parsed = parseSshLedgerPayload(board.task(taskId)?.integrations?.['ssh'])
  return parsed.ok ? parsed.value : undefined
}

/** One card pinned to a local workspace's repository. */
const WORKSPACE_ID = 'ws-local'

/**
 * Mount the provider with the REAL strategies and one workspace registry.
 * @param registry - the deployment's registry, when it serves one.
 * @param untracked - the note a fake strategy reports, when a case uses one.
 * @returns the board, the host, the mount and one pinned, running card.
 */
async function runningFromWorkspace(options: {
  registry?: WorkspaceRegistrySeat
  fake?: boolean
  untracked?: number
} = {}) {
  const ssh = createScriptedSsh({ home: scratch('dsh-ws-home-') })
  const board = createBoard({ sessions: false })
  cleanups.push(() => { board.dispose() })
  const mounted: Mounted = mountEngine({
    board,
    ssh: ssh.service,
    now: () => NOW,
    workspaces: options.fake === true
      ? fakeWorkspaces({ cwd: '/home/runner/worktrees/wt', ...(options.untracked === undefined ? {} : { untrackedFiles: options.untracked }) }).resolver
      : target => createSshWorkspaceStrategy(target),
    ...(options.registry === undefined ? {} : { localRepository: id => readWorkspaceDirectory(options.registry, id) }),
  })
  cleanups.push(() => { mounted.release() })
  const taskId = board.createCard('task-1', { title: 'fix the parser', prompt: 'fix it' }).id
  await mounted.extension.handleAction?.({
    extensionId: 'ssh',
    action: 'set-target',
    taskId,
    payload: {
      target: {
        mode: 'direct',
        host: 'build-box',
        agent: { kind: 'dsh' },
        workspace: { kind: 'git', source: { kind: 'workspace', workspaceId: WORKSPACE_ID } },
      },
    },
  })
  board.apply({ kind: 'run', taskId })
  await mounted.tick(0)
  return { ssh, board, mounted, taskId, runId: payloadOf(board, taskId)?.activeRun?.runId ?? '' }
}

describe('a run whose repository is the local workspace', () => {
  it('operator running a card from a local workspace gets the repository resolved, and the untracked note on the verdict', async () => {
    // Given a real local repository with one file nobody committed, and a
    // deployment whose workspace registry knows it
    const repository = localRepository()
    const registry: WorkspaceRegistrySeat = { list: () => [{ id: WORKSPACE_ID, path: repository.path }] }
    const { ssh, board, mounted, taskId, runId } = await runningFromWorkspace({ registry })

    // When the card runs, the real strategy prepared its worktree on the host
    await vi.waitFor(() => {
      expect(payloadOf(board, taskId)?.activeRun?.phase).toBe('running')
      expect(ssh.commands('start')).toHaveLength(1)
    })

    // Then the card is told how much of the local working tree stayed behind
    const live = (mounted.published()?.runs ?? []) as Array<Record<string, unknown>>
    expect(live[0]?.taskId).toBe(taskId)
    expect(live[0]?.untrackedFiles).toBe(repository.untracked)

    // When the run finishes
    ssh.finish(runId, { output: dshOutput({ sessionId: 'sess-ws', text: 'parser fixed' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the verdict carries the agent's summary and one sentence about the
    // files the bundle could not carry
    const executions = executionsOf(board.task(taskId))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.summary?.text).toContain('parser fixed')
    expect(executions[0]?.summary?.text).toContain(untrackedNote(repository.untracked))
    // And the workspace detail never became a payload member of its own
    expect(JSON.stringify(board.task(taskId)?.integrations)).not.toContain('untrackedFiles')
  })

  it('operator running it on a deployment that does not know the workspace is refused with the strategy\'s own words', async () => {
    // Given a registry that has never heard of the workspace the card pins
    const registry: WorkspaceRegistrySeat = { list: () => [] }
    const { board, mounted, taskId } = await runningFromWorkspace({ registry })

    // When the run is opened
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('failed')
    })

    // Then the card says the repository was not resolved, and nothing pretended
    // to run
    const executions = executionsOf(board.task(taskId))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.result).toBe('failed')
    expect(executions[0]?.error).toContain('was not resolved')
  })

  it('operator with a strategy that reports no untracked files gets a verdict without the sentence', async () => {
    // Given a placement that sent everything
    const { ssh, board, mounted, taskId, runId } = await runningFromWorkspace({ fake: true })

    // When the run finishes
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    ssh.finish(runId, { output: dshOutput({ sessionId: 'sess-ws', text: 'parser fixed' }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the verdict is exactly what the agent reported
    const executions = executionsOf(board.task(taskId))
    expect(executions[0]?.summary?.text).toBe('parser fixed')
    const live = (mounted.published()?.runs ?? []) as Array<Record<string, unknown>>
    expect(live.some(entry => entry.untrackedFiles !== undefined)).toBe(false)
  })

  it('operator whose agent wrote a long summary still finds the untracked note at the end of the verdict', async () => {
    // Given a run that did not receive two local files and an agent whose own
    // summary is longer than the whole field it reports into
    const { ssh, board, mounted, taskId, runId } = await runningFromWorkspace({ fake: true, untracked: 2 })
    const long = 'a very long report. '.repeat(300)

    // When that run finishes
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    ssh.finish(runId, { output: dshOutput({ sessionId: 'sess-ws', text: long }) })
    await vi.waitFor(async () => {
      await mounted.tick()
      expect(board.task(taskId)?.status).toBe('done')
    })

    // Then the verdict fits the field and the note survived the cut
    const error = executionsOf(board.task(taskId))[0]?.summary?.text ?? ''
    expect(error.length).toBeLessThanOrEqual(512)
    expect(error.endsWith(untrackedNote(2))).toBe(true)
    expect(error).toContain('a very long report')
  })

  it('operator reading a strategy note gets one honest sentence, and nothing when nothing was left behind', () => {
    // Given the sentence a strategy's note becomes
    const formatter = untrackedNote

    // When it is asked about no note, zero files and some files
    const absent = formatter(undefined)
    const none = formatter(0)
    const one = formatter(1)
    const several = formatter(4)

    // Then only the counts that describe left-behind work produce a sentence
    expect(absent).toBe('')
    expect(none).toBe('')
    expect(one).toContain('1 untracked local file was not sent')
    expect(several).toContain('4 untracked local files were not sent')
    expect(several).toContain('a bundle carries commits, not the untracked working tree')
  })
})

describe('the local workspace registry', () => {
  it('operator resolving a workspace id gets its canonical directory, and nothing for anything unknown', () => {
    // Given a registry serving one workspace, and one that cannot be read at all
    const repository = localRepository()
    const registry: WorkspaceRegistrySeat = { list: () => [{ id: WORKSPACE_ID, path: repository.path }] }
    const broken: WorkspaceRegistrySeat = { list: () => { throw new Error('the registry is closed') } }

    // When the pinned id, an unknown id, an empty id, a missing registry and a
    // broken one are all resolved
    const resolved = readWorkspaceDirectory(registry, WORKSPACE_ID)
    const unknown = readWorkspaceDirectory(registry, 'ws-unknown')
    const empty = readWorkspaceDirectory(registry, '')
    const missing = readWorkspaceDirectory(undefined, WORKSPACE_ID)
    const unreadable = readWorkspaceDirectory(broken, WORKSPACE_ID)

    // Then only the pinned id answers a directory, and every other question is
    // answered with nothing rather than a guess
    expect(resolved).toBe(repository.path)
    expect(unknown).toBeUndefined()
    expect(empty).toBeUndefined()
    expect(missing).toBeUndefined()
    expect(unreadable).toBeUndefined()
  })

  it('operator whose host serves no workspace registry keeps running, and only a local-source run is refused', () => {
    // Given the service name the board resolves its own registry under, a host
    // that serves it, and three that do not
    const repository = localRepository()
    const registry: WorkspaceRegistrySeat = { list: () => [{ id: WORKSPACE_ID, path: repository.path }] }
    const serving = { get: (name: string): unknown => name === WORKSPACE_REGISTRY_SERVICE ? registry : undefined }
    const absent = { get: (): unknown => undefined }
    const malformed = { get: (): unknown => ({ list: 'not a function' }) }
    const refusing = { get: (): unknown => { throw new Error('the service refused') } }

    // When the registry is resolved from each of them
    const found = resolveWorkspaceRegistry(serving)
    const nothing = resolveWorkspaceRegistry(absent)
    const unusable = resolveWorkspaceRegistry(malformed)
    const refused = resolveWorkspaceRegistry(refusing)

    // Then only the serving host resolves a registry, so the mount never depends
    // on one being there and only a local-source run is refused
    expect(found).toBe(registry)
    expect(nothing).toBeUndefined()
    expect(unusable).toBeUndefined()
    expect(refused).toBeUndefined()
  })
})
