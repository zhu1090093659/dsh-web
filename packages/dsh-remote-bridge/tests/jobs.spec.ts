/**
 * The background-job channel: what one `jobs.list` answers, what `jobs.changed`
 * carries, and the two rules that keep it from becoming a second source of
 * truth — the host's own scope fence, and a subscription that only exists for a
 * scope the client actually asked about.
 * @module tests/jobs
 */

import { describe, expect, it } from 'vitest'
import { JOBS_MAX_ROWS } from '../src/core/jobs.ts'
import type { JobViewLike } from '../src/core/jobs.ts'
import { FakeJobRegistry, makeConnection, requestFrame, settleJobs } from './support/harness.ts'

/** A host job as the registry projects it, with the fields a phone never sees. */
function hostJob(overrides: Record<string, unknown> = {}): JobViewLike & Record<string, unknown> {
  return {
    id: 'bash-1a2b3c',
    kind: 'bash',
    label: 'pnpm test',
    status: 'running',
    startedAt: 1_790_000_000_000,
    output: { total: 4096, earliest: 0 },
    progress: '3/10',
    detail: 'exit code: 3',
    outputLimitBytes: 65536,
    ...overrides,
  }
}

/** One connection that declared the job channel, over a scripted registry. */
async function declaringConnection(rows: readonly JobViewLike[] = []) {
  const registry = new FakeJobRegistry().set(rows)
  const harness = makeConnection({ paired: true, jobs: registry, jobsFlushMs: 0 })
  // A jobs.list on a session this connection has not listed reads the roster
  // once. Answer it with an empty table so the paths under test stay quiet.
  harness.gateway.handler = async call =>
    call.namespace === 'session' && call.method === 'list' ? { items: [] } : { accepted: true }
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['jobs.v1'] }))
  return { ...harness, registry }
}

/** @returns the rows one `jobs.list` answer carried. */
function rowsOf(harness: { readonly transport: { responseTo(id: number): unknown } }, id: number): Record<string, unknown>[] {
  const answer = harness.transport.responseTo(id) as { r?: { jobs?: Record<string, unknown>[] } } | undefined
  const result = answer === undefined ? undefined : answer.r
  const rows = result === undefined ? undefined : result.jobs
  if (rows === undefined) throw new Error(`no job rows in the answer to request ${id}`)
  return rows
}

/** @returns every `jobs.changed` payload this connection received, in order. */
function jobEvents(transport: { frames(): { t: string; m?: string; p?: unknown }[] }): unknown[] {
  return transport.frames().filter(frame => frame.t === 'ev' && frame.m === 'jobs.changed').map(frame => frame.p)
}

describe('jobs.list', () => {
  it('user reads one background job as a minimal view with no output bytes', async () => {
    // Given a host whose registry holds one running job with its own bookkeeping
    const harness = await declaringConnection([hostJob()])
    // When the phone lists that session's jobs
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // Then it reads the host's own fields and nothing else
    expect(harness.transport.responseTo(2)).toMatchObject({
      t: 'res',
      id: 2,
      ok: true,
      r: {
        sessionId: 'session-a',
        scope: 'session',
        jobs: [{
          id: 'bash-1a2b3c',
          kind: 'bash',
          status: 'running',
          label: 'pnpm test',
          startedAt: 1_790_000_000_000,
        }],
      },
    })
    // Exactly the declared keys: no output bytes, no progress line, no host
    // bookkeeping that the host may rename without warning.
    const rows = rowsOf(harness, 2)
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['id', 'kind', 'label', 'startedAt', 'status'])
  })

  it('user sees a settled job with its own status, its finish time and its owner', async () => {
    // Given a registry holding one owned settled job and one unowned one
    const harness = await declaringConnection([
      hostJob({ owner: 'session-a', status: 'killed', finishedAt: 1_790_000_009_000 }),
      hostJob({ id: 'bash-unowned', owner: undefined, kind: 'workflow', status: 'completed', finishedAt: 1_790_000_004_000 }),
    ])
    // When the phone lists that session
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // Then status and kind cross verbatim, and only the owned row names an owner
    const rows = rowsOf(harness, 2)
    expect(rows.map(row => [row['id'], row['ownerSessionId'], row['status'], row['finishedAt']])).toEqual([
      ['bash-1a2b3c', 'session-a', 'killed', 1_790_000_009_000],
      // Unowned jobs are visible to every session's scope, and the row simply has no owner key.
      ['bash-unowned', undefined, 'completed', 1_790_000_004_000],
    ])
    expect(Object.hasOwn(rows[1] ?? {}, 'ownerSessionId')).toBe(false)
    // A producer kind this protocol has never heard of crosses verbatim.
    expect(rows[1]?.['kind']).toBe('workflow')
  })

  it('user listing a session with no background job sees an empty set', async () => {
    // Given a host with an empty description registry
    const harness = await declaringConnection()
    // When the phone lists that session
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // Then the answer is an empty list, not an invented row and not a refusal
    expect(harness.transport.responseTo(2)?.r).toEqual({ sessionId: 'session-a', scope: 'session', jobs: [] })
  })

  it('user asking without a session reads the unowned scope and is told so', async () => {
    // Given one owned job and one no session owns
    const harness = await declaringConnection([
      hostJob({ owner: 'session-a' }),
      hostJob({ id: 'bash-unowned', owner: undefined }),
    ])
    // When the phone lists without naming a session
    await harness.connection.handleText(requestFrame(2, 'jobs.list', {}))
    // Then it is told the scope is unowned, and only unowned jobs come back
    const answer = harness.transport.responseTo(2)?.r as { sessionId?: string; scope: string; jobs: { id: string }[] } | undefined
    expect(answer?.scope).toBe('unowned')
    expect(answer === undefined ? true : Object.hasOwn(answer, 'sessionId')).toBe(false)
    expect(answer?.jobs.map(row => row.id)).toEqual(['bash-unowned'])
  })

  it('user sending a sessionId that is not a string is told the arguments are invalid', async () => {
    // Given a declared connection
    const harness = await declaringConnection()
    // When it names a session with a number
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 7 }))
    // Then the call is refused as invalid arguments
    expect(harness.transport.responseTo(2)).toMatchObject({ ok: false, e: { code: 'invalid-args' } })
  })

  it('operator running a host with no job registry is told the channel is unavailable', async () => {
    // Given a host that composes no job registry at all
    const harness = makeConnection({ paired: true })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['jobs.v1'] }))
    // When a declared phone asks for the unowned scope
    await harness.connection.handleText(requestFrame(2, 'jobs.list', {}))
    // Then it learns this host has nothing to publish, rather than a silent empty list
    expect(harness.transport.responseTo(2)).toMatchObject({ ok: false, e: { code: 'jobs-unavailable' } })
  })

  it('user listing a very large roster gets a bounded payload', async () => {
    // Given a registry past the row budget
    const rows = Array.from({ length: JOBS_MAX_ROWS + 20 }, (_value, index) => hostJob({ id: `bash-${index}` }))
    const harness = await declaringConnection(rows)
    // When the phone lists that session
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // Then the payload stops at the budget instead of risking the frame limit
    expect(rowsOf(harness, 2)).toHaveLength(JOBS_MAX_ROWS)
  })
})

describe('jobs.v1 capability gating', () => {
  it('user who never declared jobs.v1 is told jobs.list is unknown', async () => {
    // Given a paired connection that greets without the capability
    const harness = await declaringConnection([hostJob()])
    const plain = makeConnection({ paired: true, jobs: harness.registry, jobsFlushMs: 0 })
    plain.gateway.handler = harness.gateway.handler
    await plain.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [] }))
    // When it calls the method anyway
    await plain.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // Then the method does not exist for it, exactly as before the channel shipped
    expect(plain.transport.responseTo(2)).toMatchObject({ ok: false, e: { code: 'unknown-method' } })
  })

  it('user reading the handshake sees jobs.v1 and the minor the bridge answers', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When it greets the bridge
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [] }))
    // Then the announcement carries the new capability and the raised minor
    const hello = harness.transport.responseTo(1)?.r as { minor: number; capabilities: string[] } | undefined
    expect(hello).toMatchObject({ proto: 1, minor: 22 })
    expect(hello?.capabilities).toContain('jobs.v1')
  })

  it('user who listed a scope is sent the whole set when it changes', async () => {
    // Given a declared connection that has listed one session
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // When a second job registers in that session
    harness.registry.add(hostJob({ id: 'bash-second', owner: 'session-a', label: 'pnpm build' }))
    harness.registry.emit({ type: 'registered', job: hostJob({ id: 'bash-second', owner: 'session-a' }) })
    await settleJobs()
    // Then it receives the same box the method answered, holding the whole set
    expect(jobEvents(harness.transport)).toEqual([{
      sessionId: 'session-a',
      scope: 'session',
      jobs: [
        { id: 'bash-1a2b3c', kind: 'bash', status: 'running', label: 'pnpm test', ownerSessionId: 'session-a', startedAt: 1_790_000_000_000 },
        { id: 'bash-second', kind: 'bash', status: 'running', label: 'pnpm build', ownerSessionId: 'session-a', startedAt: 1_790_000_000_000 },
      ],
    }])
  })

  it('user who declared jobs.v1 but listed no scope is sent nothing', async () => {
    // Given a declared connection that never asked for a scope
    const registry = new FakeJobRegistry().set([hostJob({ owner: 'session-a' })])
    const harness = makeConnection({ paired: true, jobs: registry, jobsFlushMs: 0 })
    harness.gateway.handler = async () => ({ items: [] })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['jobs.v1'] }))
    // When the very events a listed connection receives are announced
    registry.add(hostJob({ id: 'bash-second', owner: 'session-a' }))
    registry.emit({ type: 'registered', job: hostJob({ id: 'bash-second', owner: 'session-a' }) })
    registry.emit({ type: 'settled', job: hostJob({ owner: 'session-a', status: 'completed', finishedAt: 1 }) })
    await settleJobs()
    // Then it is subscribed to nothing at all
    expect(jobEvents(harness.transport)).toEqual([])
    expect(registry.listeners.size).toBe(0)
  })

  it('user who dropped the capability mid-connection is sent no job frame', async () => {
    // Given a connection holding a scope open behind the capability
    const registry = new FakeJobRegistry().set([hostJob({ owner: 'session-a' })])
    const harness = makeConnection({ paired: true, jobs: registry, jobsFlushMs: 0 })
    harness.gateway.handler = async () => ({ accepted: true })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['jobs.v1'] }))
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // When it greets again without the capability and the set then changes
    await harness.connection.handleText(requestFrame(3, 'hello', { proto: 1, cap: [] }))
    registry.add(hostJob({ id: 'bash-second', owner: 'session-a' }))
    registry.emit({ type: 'registered', job: hostJob({ id: 'bash-second', owner: 'session-a' }) })
    await settleJobs()
    // Then the watch it already held publishes nothing
    expect(jobEvents(harness.transport)).toEqual([])
  })
})

describe('jobs.changed publishing', () => {
  it('user is never sent a frame per output append', async () => {
    // Given a listed scope holding one running job
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    const before = harness.transport.frames().length
    // When that job appends its output byte range by byte range
    for (let total = 4096; total <= 40_960; total += 4096) harness.registry.emitOutput('bash-1a2b3c', 'session-a', total)
    await settleJobs()
    // Then no frame crossed at all: an append moves no row
    expect(harness.transport.frames().length).toBe(before)
    expect(jobEvents(harness.transport)).toEqual([])
  })

  it('user receives one frame for one burst of commits', async () => {
    // Given a listed scope
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // When a second job registers and the first reports three commits in one window
    harness.registry.add(hostJob({ id: 'bash-second', owner: 'session-a' }))
    for (const status of ['running', 'stopping', 'running']) {
      harness.registry.emit({ type: 'stopping', job: hostJob({ owner: 'session-a', status }) })
    }
    await settleJobs()
    // Then the burst is one frame, read once from the registry
    expect(jobEvents(harness.transport)).toHaveLength(1)
  })

  it('user is sent nothing when the set did not change', async () => {
    // Given a listed scope
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // When a commit changes only the host's own progress line
    harness.registry.emit({ type: 'progress', job: hostJob({ owner: 'session-a' }) })
    await settleJobs()
    // Then the projection is unchanged, so no frame is published
    expect(jobEvents(harness.transport)).toEqual([])
  })

  it('user is sent the settled whole set when a job finishes', async () => {
    // Given a listed scope holding one live job
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    // When that job settles and leaves the registry
    harness.registry.set([])
    harness.registry.emit({ type: 'settled', job: hostJob({ owner: 'session-a', status: 'completed', finishedAt: 5 }) })
    await settleJobs()
    // Then the phone is handed the whole set as it stands now
    expect(jobEvents(harness.transport)).toEqual([{ sessionId: 'session-a', scope: 'session', jobs: [] }])
  })

  it('user watching the unowned scope is sent only unowned changes', async () => {
    // Given a connection that listed only the unowned scope
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', {}))
    // When a job no session owns registers
    harness.registry.add(hostJob({ id: 'bash-unowned', owner: undefined }))
    harness.registry.emit({ type: 'registered', job: hostJob({ id: 'bash-unowned' }) })
    await settleJobs()
    // Then exactly one unowned frame arrives, with no session named
    expect(jobEvents(harness.transport)).toEqual([{
      scope: 'unowned',
      jobs: [{ id: 'bash-unowned', kind: 'bash', status: 'running', label: 'pnpm test', startedAt: 1_790_000_000_000 }],
    }])
  })

  it('user closing the connection stops the roster watch', async () => {
    // Given a connection holding one scope open
    const harness = await declaringConnection([hostJob({ owner: 'session-a' })])
    await harness.connection.handleText(requestFrame(2, 'jobs.list', { sessionId: 'session-a' }))
    expect(harness.registry.listeners.size).toBe(1)
    // When it goes away and the set changes afterwards
    harness.connection.dispose()
    harness.registry.add(hostJob({ id: 'bash-late', owner: 'session-a' }))
    harness.registry.emit({ type: 'registered', job: hostJob({ id: 'bash-late', owner: 'session-a' }) })
    await settleJobs()
    // Then nothing is read on its behalf and nothing is delivered
    expect(harness.registry.listeners.size).toBe(0)
    expect(jobEvents(harness.transport)).toEqual([])
  })
})
