import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTask } from '../src/core/tasks.ts'
import { HttpTaskBoardHostTransport } from '../src/client/host-api.ts'
import type { TaskBoardEventPayload, TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 2,
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
    await expect(transport.bootstrap(legacy)).rejects.toThrow('offline')
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
      const rejected = expect(pending).rejects.toThrow('timed out after 15s')
      await vi.advanceTimersByTimeAsync(15_000)
      await rejected
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HttpTaskBoardHostTransport SSE subscription', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    onmessage: ((message: MessageEvent<string>) => void) | null = null
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

  it('calls the listener on visibilitychange while the tab is visible', () => {
    const transport = new HttpTaskBoardHostTransport(new MemoryStorage())
    const calls: Array<TaskBoardEventPayload | undefined> = []
    transport.subscribe(event => { calls.push(event) })
    visibilityListener?.()
    expect(calls).toEqual([undefined])
  })
})
