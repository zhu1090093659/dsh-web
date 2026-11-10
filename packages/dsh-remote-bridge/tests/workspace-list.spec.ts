/**
 * The workspace channel: the host registry's own synchronous projection behind
 * `workspace.v1`, the two global session sets it publishes beside it, and the
 * refusal that says a host composes no registry at all.
 * @module tests/workspace-list
 */

import { describe, expect, it } from 'vitest'
import { CAP_SESSION_ADMIN, CAP_WORKSPACE, SERVED_CAPABILITIES } from '../src/core/protocol.ts'
import { SessionMeta, type WorkspaceFace, type WorkspacesFace } from '../src/core/session-meta.ts'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/** The registry a suite drives directly: three members, no persistence behind them. */
interface RegistryDouble extends WorkspacesFace {
  /** Every session set the bridge read, in order, so a suite can prove it read nothing. */
  readonly reads: readonly string[]
}

/**
 * Build one workspace registry over fixed content.
 *
 * A structural double rather than a patched service: the production code takes
 * this face per call, which is exactly the seam the suite drives.
 * @param options - the rows and the two session sets the registry answers with.
 * @returns the registry, plus the log of every read it served.
 */
function registryDouble(options: {
  readonly rows?: readonly WorkspaceFace[]
  readonly archived?: readonly string[]
  readonly pinned?: () => readonly string[]
} = {}): RegistryDouble {
  const reads: string[] = []
  const rows = options.rows ?? []
  return {
    reads,
    list: () => {
      reads.push('list')
      return [...rows]
    },
    get archivedSessionIds(): readonly string[] {
      reads.push('archived')
      return options.archived ?? []
    },
    get pinnedSessionIds(): readonly string[] {
      reads.push('pinned')
      return options.pinned?.() ?? []
    },
  }
}

/** One workspace row as the host's entity carries it. */
function workspace(id: string, path: string, title: string, extra: Record<string, unknown> = {}): WorkspaceFace {
  return { id, path, title, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T09:30:00.000Z', ...extra }
}

/**
 * Connect a paired client that declared one set of capabilities.
 * @param registry - the host registry this connection reads, or undefined for a host without one.
 * @param cap - the capabilities the client declares.
 * @returns the harness, after its handshake was answered.
 */
async function listingConnection(registry: WorkspacesFace | undefined, cap: readonly string[] = [CAP_WORKSPACE]): Promise<ConnectionHarness> {
  const sessionMeta = new SessionMeta(() => ({ workspaces: registry }), () => Date.now(), () => {})
  const harness = makeConnection({ paired: true, sessionMeta })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...cap] }))
  return harness
}

describe('workspace.list', () => {
  it('operator listing workspaces sees every registration in registry order with both global sets', async () => {
    // Given a host with three workspaces, one archived session and two pinned ones
    const registry = registryDouble({
      rows: [
        workspace('ws-b', '/Users/zcl/code/dsh-web', 'dsh-web'),
        workspace('ws-a', '/Users/zcl/code/iphone_remote_use_dsh', 'iphone_remote_use_dsh'),
        workspace('ws-c', '/Users/zcl/code/.worktrees', 'worktrees'),
      ],
      archived: ['session-gone'],
      pinned: () => ['session-new', 'session-old'],
    })
    const harness = await listingConnection(registry)
    // When the operator lists the host's workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then the answer is the registry's own order — not sorted by id, not by title —
    // with each row's five fields and the two complete session sets beside them
    expect(answerOf(harness, 2).r).toEqual({
      workspaces: [
        { id: 'ws-b', path: '/Users/zcl/code/dsh-web', title: 'dsh-web', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T09:30:00.000Z' },
        { id: 'ws-a', path: '/Users/zcl/code/iphone_remote_use_dsh', title: 'iphone_remote_use_dsh', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T09:30:00.000Z' },
        { id: 'ws-c', path: '/Users/zcl/code/.worktrees', title: 'worktrees', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T09:30:00.000Z' },
      ],
      archivedSessionIds: ['session-gone'],
      pinnedSessionIds: ['session-new', 'session-old'],
    })
    expect((answerOf(harness, 2).r as { workspaces: { id: string }[] }).workspaces.map(row => row.id)).toEqual(['ws-b', 'ws-a', 'ws-c'])
  })

  it('operator listing workspaces on a host with none sees two empty sets rather than a shorter answer', async () => {
    // Given a host whose registry holds no workspace, no archived session and no pin
    const registry = registryDouble()
    const harness = await listingConnection(registry)
    // When the operator lists the host's workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then both sets are present and empty: "none of them" is an answer, not an absence
    expect(answerOf(harness, 2).r).toEqual({ workspaces: [], archivedSessionIds: [], pinnedSessionIds: [] })
    expect(Object.keys(answerOf(harness, 2).r as Record<string, unknown>)).toEqual(['workspaces', 'archivedSessionIds', 'pinnedSessionIds'])
  })

  it('operator listing workspaces twice reads the registry twice and sees the pin a write just left behind', async () => {
    // Given a host whose pin set changes between two listings, as one pin would
    let pinned: readonly string[] = ['session-a']
    const registry = registryDouble({ pinned: () => pinned })
    const harness = await listingConnection(registry)
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    pinned = ['session-b', 'session-a']
    // When the operator lists again
    await harness.connection.handleText(requestFrame(3, 'workspace.list'))
    // Then the second answer carries the new set: nothing in this bridge caches a read
    expect((answerOf(harness, 2).r as { pinnedSessionIds: string[] }).pinnedSessionIds).toEqual(['session-a'])
    expect((answerOf(harness, 3).r as { pinnedSessionIds: string[] }).pinnedSessionIds).toEqual(['session-b', 'session-a'])
    expect(registry.reads).toEqual(['list', 'archived', 'pinned', 'list', 'archived', 'pinned'])
  })

  it('operator listing workspaces never receives the session account a workspace entity holds', async () => {
    // Given a host whose entity carries its own ordered session account
    const entity = { ...workspace('ws-a', '/Users/zcl/code/dsh-web', 'dsh-web'), sessionIds: ['session-1', 'session-2'] }
    const harness = await listingConnection(registryDouble({ rows: [entity] }))
    // When the operator lists the host's workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then the row carries the five published fields and no session account: the
    // roster already carries every session's cwd, so that array would only grow the frame
    const row = (answerOf(harness, 2).r as { workspaces: Record<string, unknown>[] }).workspaces[0]
    expect(Object.keys(row ?? {})).toEqual(['id', 'path', 'title', 'createdAt', 'updatedAt'])
  })

  it('operator listing workspaces on a host whose entity carries no timestamps gets rows without those keys', async () => {
    // Given a host that publishes the three mandatory fields only
    const harness = await listingConnection(registryDouble({ rows: [{ id: 'ws-a', path: '/Users/zcl/code/dsh-web', title: 'dsh-web' }] }))
    // When the operator lists the host's workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then the two optional instants are omitted rather than invented
    expect(answerOf(harness, 2).r).toEqual({ workspaces: [{ id: 'ws-a', path: '/Users/zcl/code/dsh-web', title: 'dsh-web' }], archivedSessionIds: [], pinnedSessionIds: [] })
    expect(Object.keys((answerOf(harness, 2).r as { workspaces: Record<string, unknown>[] }).workspaces[0] ?? {})).toEqual(['id', 'path', 'title'])
  })

  it('operator listing workspaces on a host that composes no registry is refused instead of told there are none', async () => {
    // Given a host whose profile mounts no workspace registry
    const harness = await listingConnection(undefined)
    // When the operator lists the host's workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then the refusal names the missing service, and no empty list is sent in its place
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'internal', msg: 'this host composes no workspaceRegistry service' } })
  })

  it('operator whose registry refuses to answer is told the read failed, not told nothing is registered', async () => {
    // Given a registry that throws while this process reads it
    const registry: WorkspacesFace = {
      list: () => { throw new Error('the workspace registry is shutting down') },
      get archivedSessionIds(): readonly string[] { return [] },
      get pinnedSessionIds(): readonly string[] { return [] },
    }
    const sessionMeta = new SessionMeta(() => ({ workspaces: registry }), () => Date.now(), () => {})
    const harness = makeConnection({ paired: true, sessionMeta })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_WORKSPACE] }))
    // When the operator lists the host's workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then the failure crosses as this bridge's internal, with the host's own text, and was logged
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'internal', msg: 'the workspace registry is shutting down' } })
    expect(harness.logs).toEqual(['workspace.list failed unexpectedly: the workspace registry is shutting down'])
  })
})

describe('workspace.v1', () => {
  it('operator who never declared the workspace channel has the method refused as unknown and no registry is read', async () => {
    // Given a connection that declared nothing at all
    const registry = registryDouble({ rows: [workspace('ws-a', '/Users/zcl/code/dsh-web', 'dsh-web')] })
    const harness = await listingConnection(registry, [])
    // When the operator calls the method anyway
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then the method does not exist for this client, exactly as before the channel
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method workspace.list' } })
    // And the host registry was asked nothing on its behalf
    expect(registry.reads).toEqual([])
  })

  it('operator who declared only the session-admin half is still told the workspace method is unknown', async () => {
    // Given a connection that declared the writing half alone
    const registry = registryDouble()
    const harness = await listingConnection(registry, [CAP_SESSION_ADMIN])
    // When the operator lists workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then one capability does not open another: reading is its own declaration
    expect(answerOf(harness, 2).e?.code).toBe('unknown-method')
    expect(registry.reads).toEqual([])
  })

  it('operator who is not paired is refused before the registry read', async () => {
    // Given a connection that declared the channel but presented no device token
    const registry = registryDouble()
    const sessionMeta = new SessionMeta(() => ({ workspaces: registry }), () => Date.now(), () => {})
    const harness = makeConnection({ paired: false, sessionMeta })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_WORKSPACE] }))
    // When the operator lists workspaces
    await harness.connection.handleText(requestFrame(2, 'workspace.list'))
    // Then pairing comes first and nothing was read for it
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unpaired', msg: 'this connection is not paired' } })
    expect(registry.reads).toEqual([])
  })

  it('user greeting the bridge finds the workspace channel and the session-admin channel among the served capabilities', async () => {
    // Given a client that greets the bridge without declaring anything
    const harness = makeConnection({ paired: true })
    // When the handshake is answered
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, client: 'ios/0.1' }))
    // Then the announcement carries both new names and the minor that raises them
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    expect(hello.minor).toBe(22)
    expect(hello.capabilities).toEqual([...SERVED_CAPABILITIES])
    expect(hello.capabilities).toContain(CAP_WORKSPACE)
    expect(hello.capabilities).toContain(CAP_SESSION_ADMIN)
  })
})
