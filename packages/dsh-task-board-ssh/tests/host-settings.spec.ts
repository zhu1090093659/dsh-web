/**
 * This extension's configuration: read live, written through one path.
 *
 * Every field is volatile, so a write is committed into the running fiber and the
 * next admission, run or tool call reads the new value. The write itself goes
 * through the Host's settings surface and nowhere else, which is what these cases
 * pin: one call, one revision, one set of volatile fields.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { SettingsFace, SettingsPathOp } from '../src/host/settings.ts'
import { NOW, createBoard } from './support/board.ts'
import { mountEngine } from './support/engine.ts'
import { createScriptedSsh } from './support/fake-ssh.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** One settings write the surface received. */
interface SettingsWrite {
  ns: string
  ops: readonly SettingsPathOp[]
  revision?: number
}

/**
 * A settings surface that records what it is asked to store.
 * @param options - what the surface reports about itself.
 * @returns the face and the writes it received.
 */
function recordingSettings(options: { writable?: boolean; entry?: string } = {}): { face: SettingsFace; writes: SettingsWrite[] } {
  const writes: SettingsWrite[] = []
  const entry = options.entry ?? 'ui-task-board-ssh'
  return {
    writes,
    face: {
      writable: options.writable ?? true,
      describe: () => [{ ns: entry, revision: 7 }],
      mutate: async (ns, ops, revision) => { writes.push({ ns, ops, revision }) },
    },
  }
}

/**
 * Mount the provider against one settings surface.
 * @param face - the surface this deployment serves.
 * @returns the mounted provider.
 */
function mountWithSettings(face: SettingsFace) {
  const ssh = createScriptedSsh()
  const board = createBoard({ sessions: false })
  cleanups.push(() => { board.dispose() })
  const mounted = mountEngine({
    board,
    ssh: ssh.service,
    workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver,
    now: () => NOW,
    settingsFace: face,
  })
  cleanups.push(() => { mounted.release() })
  return mounted
}

describe('the configuration write path', () => {
  it('operator saving settings stores every field in one volatile write against the live revision', async () => {
    // Given a deployment serving a writable settings surface
    const settings = recordingSettings()
    const mounted = mountWithSettings(settings.face)

    // When the settings section saves the whole form
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'setup-save',
      payload: {
        enabled: true,
        defaultHost: 'build-box',
        defaultAgent: 'claude',
        defaultMode: 'proxy',
        perHostCap: 99,
        agentCommands: [{ kind: 'dsh', command: 'dsh headless {prompt_file}' }],
      },
    }) as { ok: boolean; entry?: string }

    // Then one write landed, on this extension's entry, at the revision it read
    expect(reply.ok).toBe(true)
    expect(reply.entry).toBe('ui-task-board-ssh')
    expect(settings.writes).toHaveLength(1)
    const write = settings.writes[0] as SettingsWrite
    expect(write.ns).toBe('ui-task-board-ssh')
    expect(write.revision).toBe(7)

    // And every value is a volatile field of this extension's schema, clamped
    expect(write.ops).toEqual([
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['defaultHost'], value: 'build-box' },
      { op: 'set', path: ['defaultAgent'], value: 'claude' },
      { op: 'set', path: ['defaultMode'], value: 'proxy' },
      { op: 'set', path: ['perHostCap'], value: 16 },
      { op: 'set', path: ['agentCommands'], value: [{ kind: 'dsh', command: 'dsh headless {prompt_file}', resumeCommand: '' }] },
    ])
  })

  it('operator saving an unusable value is refused by name and stores nothing', async () => {
    // Given a writable surface
    const settings = recordingSettings()
    const mounted = mountWithSettings(settings.face)

    // When the form sends a host alias that cannot name a host
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'setup-save',
      payload: { defaultHost: 'not a host alias' },
    }) as { ok: boolean; code?: string }

    // Then the write was refused and nothing reached the surface
    expect(reply.ok).toBe(false)
    expect(reply.code).toBe('invalid-host')
    expect(settings.writes).toEqual([])
  })

  it('operator saving a command template with an unknown placeholder is refused', async () => {
    // Given a writable surface
    const settings = recordingSettings()
    const mounted = mountWithSettings(settings.face)

    // When the form sends a template naming a placeholder this build cannot fill
    const reply = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'setup-save',
      payload: { agentCommands: [{ kind: 'dsh', command: 'dsh headless {workspace}' }] },
    }) as { ok: boolean; code?: string }

    // Then it was refused, and nothing was stored
    expect(reply.ok).toBe(false)
    expect(reply.code).toBe('invalid-command')
    expect(settings.writes).toEqual([])
  })

  it('operator reading the settings sees the effective defaults and whether a write is possible', async () => {
    // Given a surface that serves configuration read-only
    const settings = recordingSettings({ writable: false })
    const mounted = mountWithSettings(settings.face)

    // When the settings section asks for the current configuration
    const reply = await mounted.extension.handleAction?.({ extensionId: 'ssh', action: 'setup-status' }) as {
      ok: boolean
      writable: boolean
      settings: Record<string, unknown>
    }

    // Then it reads the live defaults and is told writes are not available
    expect(reply.ok).toBe(true)
    expect(reply.writable).toBe(true)
    expect(reply.settings).toEqual({ host: '', agent: 'dsh', mode: 'direct', perHostCap: 2 })

    // When it tries to save anyway
    const refused = await mounted.extension.handleAction?.({
      extensionId: 'ssh',
      action: 'setup-save',
      payload: { perHostCap: 3 },
    }) as { ok: boolean; code?: string }

    // Then the refusal is the surface's own read-only answer
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('settings-readonly')
    expect(settings.writes).toEqual([])
  })
})
