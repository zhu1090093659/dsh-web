import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTask } from '../src/core/tasks.ts'
import { HostApiError, HttpTaskBoardHostTransport, type HostApiFailure } from '../src/client/host-api.ts'
import type { TaskBoardEventPayload, TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 3,
  revision: 1,
  tasks: [],
  scheduler: { timeZone: 'UTC', ledgerId: 'ledger-a' },
  power: {
    platform: 'linux', phase: 'unsupported', enabled: false,
    runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
  },
}

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('HttpTaskBoardHostTransport migration', () => {
  it('keeps v1 data, retries with stable ids, and marks import only after Host confirmation', async () => {
    const storage = new MemoryStorage()
    const bodies: Array<{ requestId: string; action: { sourceId: string } }> = []
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/state')) return new Response(JSON.stringify(snapshot), { status: 200 })
      bodies.push(JSON.parse(String(init?.body)) as typeof bodies[number])
      if (fail) throw new Error('offline')
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const legacy = [createTask({ title: 'legacy', description: '', prompt: '' }, 1, 'legacy')]
    const transport = new HttpTaskBoardHostTransport(storage)
    // A refused connection is reported as an unreachable Host, never as the
    // raw fetch rejection (#1528).
    await expect(transport.bootstrap(legacy)).rejects.toMatchObject({ failure: 'unreachable' })
    expect(storage.getItem('dsh.taskBoard.v2.hostImported')).toBeNull()
    fail = false
    await expect(transport.bootstrap(legacy)).resolves.toEqual(snapshot)
    expect(storage.getItem('dsh.taskBoard.v2.hostImported')).toBe('ledger-a')
    expect(bodies[1].requestId).toBe(bodies[0].requestId)
    expect(bodies[1].action.sourceId).toBe(bodies[0].action.sourceId)
  })

  it('does not post the legacy ledger after the origin marker is present', async () => {
    const storage = new MemoryStorage()
    storage.setItem('dsh.taskBoard.v2.hostImported', 'ledger-a')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new HttpTaskBoardHostTransport(storage).bootstrap([
      createTask({ title: 'backup', description: '', prompt: '' }, 1, 'backup'),
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/task-board/state', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
  })

  it('imports the retained v1 backup again for a new Host ledger generation', async () => {
    const storage = new MemoryStorage()
    storage.setItem('dsh.taskBoard.v2.hostImported', 'old-ledger')
    const next = { ...snapshot, revision: 0, scheduler: { timeZone: 'UTC', ledgerId: 'recovered-ledger' } }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(next), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new HttpTaskBoardHostTransport(storage).bootstrap([
      createTask({ title: 'backup', description: '', prompt: '' }, 1, 'backup'),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storage.getItem('dsh.taskBoard.v2.hostImported')).toBe('recovered-ledger')
  })

  it('aborts a Host request that never settles', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
      })))
      const pending = new HttpTaskBoardHostTransport(new MemoryStorage()).state()
      const rejected = expect(pending).rejects.toMatchObject({ failure: 'timeout', message: expect.stringContaining('15') })
      await vi.advanceTimersByTimeAsync(15_000)
      await rejected
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HttpTaskBoardHostTransport Host failure classes (#1528)', () => {
  async function failureOf(response: () => Response | Promise<Response>): Promise<HostApiError> {
    vi.stubGlobal('fetch', vi.fn(async () => await response()))
    try {
      await new HttpTaskBoardHostTransport(new MemoryStorage()).state()
    } catch (error) {
      if (error instanceof HostApiError) return error
      throw error
    }
    throw new Error('the transport was expected to fail')
  }

  it('names an unmounted Host API instead of leaking a JSON parse error', async () => {
    // The core webserver answers an unmounted /api path with plain "not found";
    // JSON.parse over that text used to be the whole error message.
    const failure: HostApiError = await failureOf(() => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
    expect(failure.failure).toBe('not-mounted')
    expect(failure.message).toContain('挂载')
    expect(failure.message).not.toContain('JSON')
  })

  it('reports the authentication fence as a signed-out session', async () => {
    const failure = await failureOf(() => new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403 }))
    expect(failure.failure).toBe('unauthorized')
  })

  it('surfaces a locked ledger with the Host reason attached', async () => {
    const failure = await failureOf(() => new Response(
      JSON.stringify({ ok: false, error: 'task-board ledger is already owned by process 4242' }),
      { status: 503 },
    ))
    expect(failure.failure).toBe('locked')
    expect(failure.message).toContain('4242')
  })

  it('keeps non-JSON failures on unknown statuses explicit', async () => {
    const failure = await failureOf(() => new Response('<html>gateway</html>', { status: 502 }))
    expect(failure.failure).toBe('unexpected')
    expect(failure.message).toContain('502')
  })

  it('reports a refused connection as an unreachable Host', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const failure = await new HttpTaskBoardHostTransport(new MemoryStorage()).state().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(HostApiError)
    expect((failure as HostApiError).failure).toBe('unreachable')
    expect((failure as HostApiError).message).not.toContain('Failed to fetch')
  })

  it('passes an action rejection through unchanged', async () => {
    const failure = await failureOf(() => new Response(JSON.stringify({ ok: false, error: 'task has already been executed' }), { status: 400 }))
    expect(failure.failure).toBe('rejected')
    expect(failure.message).toBe('task has already been executed')
  })

  it('lists every failure class the panel can render', () => {
    const classes: HostApiFailure[] = ['not-mounted', 'unauthorized', 'locked', 'rejected', 'timeout', 'unreachable', 'unexpected']
    expect(new Set(classes).size).toBe(classes.length)
  })
})

describe('HttpTaskBoardHostTransport task parsing (#1540)', () => {
  const draft = { title: 'Parsed', description: 'From the model', prompt: 'Do it' }

  function transportFor(handler: () => Response | Promise<Response>): HttpTaskBoardHostTransport {
    vi.stubGlobal('fetch', vi.fn(async () => await handler()))
    return new HttpTaskBoardHostTransport(new MemoryStorage())
  }

  it('returns the draft the Host parsed', async () => {
    const transport = transportFor(() => new Response(JSON.stringify({ ok: true, draft }), { status: 200 }))
    await expect(transport.parseDraft({ text: 'note', model: 'deepseek/deepseek-chat' })).resolves.toEqual(draft)
  })

  it('names a deployment without a model instead of a status code', async () => {
    const transport = transportFor(() => new Response(JSON.stringify({ ok: false, code: 'no-model', error: 'task-board parsing is unavailable' }), { status: 503 }))
    const failure = await transport.parseDraft({ text: 'note' }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(HostApiError)
    expect((failure as HostApiError).failure).toBe('rejected')
    expect((failure as HostApiError).message).toContain('模型')
    expect((failure as HostApiError).message).not.toContain('503')
  })

  it('phrases the Host timeout and the unmounted route differently', async () => {
    const timedOut = transportFor(() => new Response(JSON.stringify({ ok: false, code: 'timeout' }), { status: 504 }))
    await expect(timedOut.parseDraft({ text: 'note', model: 'p/m' })).rejects.toMatchObject({ failure: 'timeout' })
    const missing = transportFor(() => new Response('not found', { status: 404 }))
    await expect(missing.parseDraft({ text: 'note' })).rejects.toMatchObject({ failure: 'not-mounted' })
  })

  it('refuses a 200 that carries no usable draft', async () => {
    const transport = transportFor(() => new Response(JSON.stringify({ ok: true, draft: { title: 7 } }), { status: 200 }))
    await expect(transport.parseDraft({ text: 'note', model: 'p/m' })).rejects.toMatchObject({ failure: 'unexpected' })
  })
})

describe('HttpTaskBoardHostTransport SSE subscription', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    onmessage: ((message: MessageEvent<string>) => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    constructor(readonly url: string) { FakeEventSource.instances.push(this) }
    close(): void { this.closed = true }
  }

  const frame: TaskBoardEventPayload = {
    revision: 1,
    scheduler: { timeZone: 'UTC', ledgerId: 'ledger-a' },
    power: snapshot.power,
  }

  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (name: string, handler: () => void) => {
        if (name === 'visibilitychange') visibilityListener = handler
      },
      removeEventListener: () => undefined,
    })
  })

  let visibilityListener: (() => void) | undefined

  it('forwards parsed event frames and falls back to a bare call on malformed frames', () => {
    const transport = new HttpTaskBoardHostTransport(new MemoryStorage())
    const calls: Array<TaskBoardEventPayload | undefined> = []
    const unsubscribe = transport.subscribe(event => { calls.push(event) })
    const source = FakeEventSource.instances.at(-1)
    if (source === undefined) throw new Error('EventSource was not constructed')
    source.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>)
    expect(calls).toEqual([frame])
    source.onmessage?.({ data: 'not json' } as MessageEvent<string>)
    source.onmessage?.({ data: JSON.stringify({ hello: 'world' }) } as MessageEvent<string>)
    expect(calls).toEqual([frame, undefined, undefined])
    expect(calls[1]).toBeUndefined()
    unsubscribe()
    expect(source.closed).toBe(true)
  })

  it('nudges the panel into a state read when the event stream cannot connect (#1528)', () => {
    const transport = new HttpTaskBoardHostTransport(new MemoryStorage())
    const calls: Array<TaskBoardEventPayload | undefined> = []
    transport.subscribe(event => { calls.push(event) })
    const source = FakeEventSource.instances.at(-1)
    if (source === undefined) throw new Error('EventSource was not constructed')
    source.onerror?.()
    expect(calls).toEqual([undefined])
    // Repeated reconnect errors must not turn into a request per retry.
    source.onerror?.()
    expect(calls).toEqual([undefined])
  })

  it('calls the listener on visibilitychange while the tab is visible', () => {
    const transport = new HttpTaskBoardHostTransport(new MemoryStorage())
    const calls: Array<TaskBoardEventPayload | undefined> = []
    transport.subscribe(event => { calls.push(event) })
    visibilityListener?.()
    expect(calls).toEqual([undefined])
  })
})
