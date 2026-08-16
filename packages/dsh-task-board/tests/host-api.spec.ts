import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTask } from '../src/core/tasks.ts'
import { HttpTaskBoardHostTransport } from '../src/client/host-api.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 2,
  revision: 1,
  tasks: [],
  scheduler: { timeZone: 'UTC' },
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
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
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
    expect(storage.getItem('dsh.taskBoard.v2.hostImported')).toBe('true')
    expect(bodies[1].requestId).toBe(bodies[0].requestId)
    expect(bodies[1].action.sourceId).toBe(bodies[0].action.sourceId)
  })

  it('does not post the legacy ledger after the origin marker is present', async () => {
    const storage = new MemoryStorage()
    storage.setItem('dsh.taskBoard.v2.hostImported', 'true')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await new HttpTaskBoardHostTransport(storage).bootstrap([
      createTask({ title: 'backup', description: '', prompt: '' }, 1, 'backup'),
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/task-board/state', { cache: 'no-store' })
  })
})
