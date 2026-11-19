/**
 * A proxy card: the card runs as an ordinary local session, and that session is
 * told what it is before it reads the card.
 *
 * The board injects a provider's preamble ahead of the card body on the same path
 * it injects tag prefixes, so the only thing to prove here is what the preamble
 * says and that the provider really takes no remote action of its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyPreamble } from '../src/host/prompt.ts'
import { NOW, createBoard } from './support/board.ts'
import { mountEngine } from './support/engine.ts'
import { createScriptedSsh } from './support/fake-ssh.ts'
import { fakeWorkspaces } from './support/workspaces.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('a proxy card', () => {
  it('operator starting a proxy card opens a local session whose prompt begins with the target preamble', async () => {
    // Given a card pinned to a host in proxy mode, and a deployment that really starts sessions
    const ssh = createScriptedSsh()
    const board = createBoard({ sessions: true })
    cleanups.push(() => { board.dispose() })
    const mounted = mountEngine({ board, ssh: ssh.service, workspaces: fakeWorkspaces({ cwd: '/srv/work' }).resolver, now: () => NOW })
    cleanups.push(() => { mounted.release() })
    const taskId = board.createCard('task-1', { title: 'fix the deploy script', prompt: 'make the deploy script idempotent' }).id
    const target = { mode: 'proxy', host: 'build-box', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/work/app' } }
    await mounted.extension.handleAction?.({ extensionId: 'ssh', action: 'set-target', taskId, payload: { target } })

    // When the operator starts the card
    board.apply({ kind: 'run', taskId })

    // Then a local session holds the card, and its prompt opens with the preamble
    await vi.waitFor(() => { expect(board.prompts).toHaveLength(1) })
    const prompt = board.prompts[0]?.text ?? ''
    const preamble = proxyPreamble(board.task(taskId) as never, target as never)
    expect(prompt.startsWith(preamble)).toBe(true)

    // Then the preamble names the host, the remote directory and the tools to drive it with
    expect(preamble).toContain('Host alias: build-box')
    expect(preamble).toContain('/srv/work/app')
    expect(preamble).toContain('ssh_exec')
    expect(prompt).toContain('make the deploy script idempotent')

    // Then the provider took no remote action of its own
    expect(ssh.calls).toEqual([])
    expect(payloadOfIntegrations(board.task(taskId)?.integrations)).toBeUndefined()
  })
})

/** The run record one card carries, when it carries one. */
function payloadOfIntegrations(integrations: Record<string, unknown> | undefined): unknown {
  const payload = integrations?.['ssh'] as { activeRun?: unknown } | undefined
  return payload?.activeRun
}
