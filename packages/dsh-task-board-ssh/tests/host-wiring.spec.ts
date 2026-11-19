/**
 * The row itself: what it needs before it registers anything, and what a switch
 * takes away again.
 *
 * The first case drives a REAL cordis registry — the plugin is mounted as its own
 * fiber and the two services it injects arrive one at a time, late — because that
 * is the only way to prove a deployment without them keeps starting and gains the
 * provider the moment both are there.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, apply } from '../src/index.ts'
import type { TaskBoardExtension, TaskBoardExtensionHost } from '../src/core/contract.ts'
import { SshSettingsWriter } from '../src/host/settings.ts'
import { SSH_TOOL_NAMES } from '../src/host/tools.ts'
import { NOW, createBoard } from './support/board.ts'
import { mountEngine, runTool } from './support/engine.ts'
import { createScriptedSsh, hostWithSecrets } from './support/fake-ssh.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** Let cordis fiber transitions settle. */
async function settle(turns = 24): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}

/** What one mount of the provider left behind, as the fake board saw it. */
interface MountRecord {
  /** Extensions the board admitted, in order. */
  admitted: TaskBoardExtension[]
  /** Tool names the provider registered and has not released. */
  tools: string[]
  /** How many times a provider was released. */
  released: number
}

/**
 * A board service face that admits providers and records what they register.
 * @returns the face and its record.
 */
function fakeBoardFace(): { face: Record<string, unknown>; record: MountRecord } {
  const record: MountRecord = { admitted: [], tools: [], released: 0 }
  const face = {
    registerExtension(extension: TaskBoardExtension) {
      record.admitted.push(extension)
      const capabilities: TaskBoardExtensionHost = {
        tasks: {
          list: () => [],
          get: () => undefined,
          create: () => { throw new Error('this fake board creates no cards') },
          patchContent: () => {},
          setStatus: () => {},
          linked: () => [],
        },
        integration: { read: () => undefined, write: () => {} },
        events: {
          onStatusChanged: () => () => {},
          onExecutionSettled: () => () => {},
          onTaskDeleted: () => () => {},
        },
        launch: { intercept: () => () => {} },
        publish: () => {},
        registerTool: (definition: { name: string }) => {
          record.tools.push(definition.name)
          return () => {
            const at = record.tools.indexOf(definition.name)
            if (at >= 0) record.tools.splice(at, 1)
          }
        },
      }
      extension.start?.(capabilities)
      return () => {
        record.released += 1
        extension.stop?.()
      }
    },
    isExtensionEnabled: () => true,
    snapshot: () => ({}),
  }
  return { face, record }
}

/** A settings surface a spec can write to. */
function fakeSettingsFace(): { face: Record<string, unknown>; writes: unknown[] } {
  const writes: unknown[] = []
  return {
    writes,
    face: {
      writable: true,
      describe: () => [{ ns: 'ui-task-board-ssh', revision: 7 }],
      mutate: async (ns: string, ops: unknown) => { writes.push({ ns, ops }) },
    },
  }
}

describe('the extension row', () => {
  it('operator whose host serves neither service sees the row start clean and attach only when both arrive', async () => {
    // Given a host process that serves neither taskBoard nor dshSsh
    const root = new Context()
    const board = fakeBoardFace()
    const ssh = createScriptedSsh()
    const fiber = root.plugin(apply, Config({}) as never)
    cleanups.push(() => { void fiber.dispose() })
    await settle()

    // Then the row mounted and registered nothing at all
    expect(board.record.admitted).toEqual([])
    expect(board.record.tools).toEqual([])

    // When one of the two services appears
    root.provide('taskBoard', board.face as never)
    await settle()

    // Then the row still registers nothing: it needs both
    expect(board.record.admitted).toEqual([])
    expect(board.record.tools).toEqual([])

    // When the second appears
    const sshProvision = root.plugin((scoped: Context) => { scoped.provide('dshSsh', ssh.service as never) })
    cleanups.push(() => { void sshProvision.dispose() })
    await settle()

    // Then the provider is admitted and its three tools are there
    expect(board.record.admitted).toHaveLength(1)
    expect(board.record.tools).toEqual([...SSH_TOOL_NAMES])

    // When that service is withdrawn
    await sshProvision.dispose()
    await settle()

    // Then the provider released everything it held
    expect(board.record.released).toBe(1)
    expect(board.record.tools).toEqual([])

    // When it comes back
    const next = createScriptedSsh()
    const back = root.plugin((scoped: Context) => { scoped.provide('dshSsh', next.service as never) })
    cleanups.push(() => { void back.dispose() })
    await settle()

    // Then the provider was admitted again against the new face
    expect(board.record.admitted).toHaveLength(2)
    expect(board.record.tools).toEqual([...SSH_TOOL_NAMES])
  })

  it('operator whose host serves no settings surface is told so instead of losing the extension', async () => {
    // Given a host with both services but no settings surface
    const root = new Context()
    const board = fakeBoardFace()
    const ssh = createScriptedSsh()
    const fiber = root.plugin(apply, Config({}) as never)
    cleanups.push(() => { void fiber.dispose() })
    root.provide('taskBoard', board.face as never)
    root.provide('dshSsh', ssh.service as never)
    await settle()

    // When the settings card reads the configuration through the action channel
    const admitted = board.record.admitted[0]
    const refused = await admitted?.handleAction?.({ extensionId: 'ssh', action: 'setup-save', payload: { perHostCap: 3 } }) as { ok: boolean; code?: string }

    // Then the write is refused by name, and the provider is still running
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('settings-unavailable')
    expect(board.record.tools).toEqual([...SSH_TOOL_NAMES])

    // When the surface appears
    const settings = fakeSettingsFace()
    root.provide('settings', settings.face as never)
    await settle()
    const saved = await admitted?.handleAction?.({ extensionId: 'ssh', action: 'setup-save', payload: { perHostCap: 3 } }) as { ok: boolean }

    // Then the same write lands, through the one write path
    expect(saved.ok).toBe(true)
    expect(settings.writes).toEqual([{ ns: 'ui-task-board-ssh', ops: [{ op: 'set', path: ['perHostCap'], value: 3 }] }])
    /** The writer is the only thing that reaches the surface. */
    expect(new SshSettingsWriter(() => undefined).available()).toBe(false)
  })
})

describe('the three tools', () => {
  it('operator switching the extension off loses its tools, its interception and its polling, and switching it back rebuilds them', async () => {
    // Given a host serving both services, mounted as its own fiber, and a switch
    // that is on
    const root = new Context()
    const board = fakeBoardFace()
    const ssh = createScriptedSsh()
    const config = Config({}) as { enabled?: boolean }
    const fiber = root.plugin(apply, config as never)
    cleanups.push(() => { void fiber.dispose() })
    root.provide('taskBoard', board.face as never)
    const provision = root.plugin((scoped: Context) => { scoped.provide('dshSsh', ssh.service as never) })
    cleanups.push(() => { void provision.dispose() })
    await settle()
    expect(board.record.admitted).toHaveLength(1)
    expect([...board.record.tools].sort()).toEqual([...SSH_TOOL_NAMES].sort())

    // When the operator switches this extension off — one volatile settings
    // write, and nothing else
    config.enabled = false
    fiber.ctx.emit('loader/volatile-update', [[]])
    await settle()

    // Then the provider was released with everything it registered: its three
    // tools, its launch handler and its engine (which takes the poll timer with
    // it, so no host is asked about any run again)
    expect(board.record.released).toBe(1)
    expect(board.record.tools).toEqual([])
    expect(ssh.calls).toEqual([])

    // When it is switched back on
    config.enabled = true
    fiber.ctx.emit('loader/volatile-update', [[]])
    await settle()

    // Then the provider is admitted again and its three tools are back
    expect(board.record.admitted).toHaveLength(2)
    expect([...board.record.tools].sort()).toEqual([...SSH_TOOL_NAMES].sort())
  })

  it('operator switching the extension off stops the polling its timer would otherwise keep doing', async () => {
    // Given a card whose run is being followed and polled
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-1', { title: 'card' }).id
    await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'set-target',
      taskId,
      payload: { target: { mode: 'direct', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work' } } },
    })
    board.apply({ kind: 'run', taskId })
    await mounted.tick(0)
    await vi.waitFor(() => { expect(ssh.commands('start')).toHaveLength(1) })
    await mounted.tick()
    const pollsWhileOn = ssh.commands('status').length
    expect(pollsWhileOn).toBeGreaterThan(0)

    // When the switch goes off and the timer keeps firing for two seconds
    mounted.settings.enabled = false
    await mounted.tick(1_000)
    await mounted.tick(1_000)

    // Then not one further status command was sent
    expect(ssh.commands('status')).toHaveLength(pollsWhileOn)
  })

  it('operator switching the board off loses the tools, and switching it on brings them back', async () => {
    // Given a mounted provider whose tools are registered
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const registry = { names: new Set<string>() }
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW, toolRegistry: registry })
    cleanups.push(() => { mounted.release() })
    expect(registry.names.size).toBe(3)

    // When the board's master switch goes off
    board.board.setConfiguration(false, false)

    // Then the tools are released with it
    expect([...registry.names]).toEqual([])

    // When the board comes back
    board.board.setConfiguration(true, false)

    // Then the tools are registered again
    expect([...registry.names].sort()).toEqual([...SSH_TOOL_NAMES].sort())
  })

  it('operator reading a target through the tool receives the host without anything secret in it', async () => {
    // Given a host whose stored entry carries credentials of every kind
    const ssh = createScriptedSsh({ hosts: [hostWithSecrets()] })
    const board = createBoard({ sessions: false })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-1', { title: 'card' }).id

    // When the model reads the card's target and the available hosts
    const value = await runTool(mounted, 'task_board_ssh_target', { action: 'read', taskId })

    // Then it got the host inventory, and every secret stayed behind
    const text = JSON.stringify(value)
    expect(value.ok).toBe(true)
    expect(text).toContain('build-box')
    expect(text).toContain('runner')
    for (const secret of ['hunter2-secret', 'keypassphrase-secret', 'bastion-secret', 'id_ed25519']) {
      expect(text).not.toContain(secret)
    }
    // And the summary the board publishes carries none of them either
    expect(JSON.stringify(mounted.published())).not.toContain('hunter2-secret')
  })
})
