/**
 * Task-store tests: localStorage backend round-trips, corrupt-document
 * handling, invalid-row dropping, and the in-memory backend.
 */
import { describe, expect, it, vi } from 'vitest'

const NOW = 1_700_000_000_000
import {
  InMemoryTaskStore, LocalStorageTaskStore, isTaskRecord, parseLedger,
  type StorageChangeEvent, type StorageEvents,
} from '../src/core/store.ts'
import { createTask, withSchedule } from '../src/core/tasks.ts'

/** A tiny in-memory Storage stand-in (localStorage shape). */
class FakeStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  entries(): [string, string][] {
    return [...this.map.entries()]
  }
}

function sampleLedger() {
  return [
    createTask({ title: 'A', description: 'd', prompt: 'p' }, 1, 't-1'),
    createTask({ title: 'B', description: '', prompt: '' }, 2, 't-2'),
  ]
}

describe('LocalStorageTaskStore', () => {
  it('round-trips a ledger through storage', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    expect(store.load()).toEqual([])
    store.save(sampleLedger())
    expect(store.load()).toEqual(sampleLedger())
  })

  it('persists under the configured key with a JSON document', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('dsh.taskBoard.v1', storage)
    store.save(sampleLedger())
    expect(storage.getItem('dsh.taskBoard.v1')).toBe(JSON.stringify(sampleLedger()))
  })

  it('clears the document on clear()', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    store.save(sampleLedger())
    store.clear()
    expect(store.load()).toEqual([])
  })

  it('tolerates storage absence (no storage, no throw)', () => {
    const store = new LocalStorageTaskStore('k', undefined)
    expect(store.load()).toEqual([])
    store.save(sampleLedger())
    expect(store.load()).toEqual([])
  })

  it('tolerates throwing storage reads/writes without breaking the board', () => {
    const broken: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('quota') },
    }
    const store = new LocalStorageTaskStore('k', broken)
    expect(store.load()).toEqual([])
    expect(() => store.save(sampleLedger())).not.toThrow()
  })
})

/** A controllable stand-in for the browser storage-event target. */
class FakeEvents implements StorageEvents {
  listeners = new Set<(event: StorageChangeEvent) => void>()
  addEventListener(_type: 'storage', listener: (event: StorageChangeEvent) => void): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'storage', listener: (event: StorageChangeEvent) => void): void {
    this.listeners.delete(listener)
  }
  fire(key: string | null): void {
    for (const listener of [...this.listeners]) listener({ key })
  }
}

describe('LocalStorageTaskStore.subscribeExternal', () => {
  it('notifies only for its own key (or a full storage clear)', () => {
    const storage = new FakeStorage()
    const events = new FakeEvents()
    const store = new LocalStorageTaskStore('dsh.taskBoard.v1', storage, events)
    const listener = vi.fn()
    store.subscribeExternal(listener)
    events.fire('some.other.key')
    expect(listener).not.toHaveBeenCalled()
    events.fire('dsh.taskBoard.v1')
    expect(listener).toHaveBeenCalledTimes(1)
    // A null key means the whole storage was cleared by another tab.
    events.fire(null)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes and stops notifying', () => {
    const events = new FakeEvents()
    const store = new LocalStorageTaskStore('k', new FakeStorage(), events)
    const listener = vi.fn()
    const unsubscribe = store.subscribeExternal(listener)
    unsubscribe()
    events.fire('k')
    expect(listener).not.toHaveBeenCalled()
  })

  it('no-ops when no storage-event target exists (non-browser runtime)', () => {
    const store = new LocalStorageTaskStore('k', new FakeStorage(), undefined)
    const listener = vi.fn()
    const unsubscribe = store.subscribeExternal(listener)
    expect(() => unsubscribe()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('parseLedger', () => {
  it('returns an empty ledger for absent documents', () => {
    expect(parseLedger(null)).toEqual([])
  })

  it('returns an empty ledger for invalid JSON or non-array documents', () => {
    expect(parseLedger('not json')).toEqual([])
    expect(parseLedger('{"a":1}')).toEqual([])
  })

  it('drops invalid rows and keeps valid ones', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const ledger = [
      valid,
      { id: 't-2' },                       // missing fields
      { ...valid, id: 't-3', status: 'weird' }, // unknown status → normalized to todo
      null,
      'nope',
    ]
    const parsed = parseLedger(JSON.stringify(ledger))
    expect(parsed).toHaveLength(2)
    expect(parsed[0].id).toBe('t-1')
    expect(parsed[1].id).toBe('t-3')
    expect(parsed[1].status).toBe('todo')
  })

  it('loads legacy rows without execution targets and keeps their pins absent', () => {
    const legacy = createTask({ title: 'legacy', description: '', prompt: '' }, 1, 't-1')
    const parsed = parseLedger(JSON.stringify([legacy]))
    expect(parsed[0].workspaceId).toBeUndefined()
    expect(parsed[0].mode).toBeUndefined()
    expect(parsed[0].permission).toBeUndefined()
  })

  it('keeps a numeric archivedAt and drops malformed values', () => {
    const base = {
      id: 't1', title: 'a', description: '', prompt: 'a',
      createdAt: NOW, updatedAt: NOW, executions: [],
    }
    const parsed = parseLedger(JSON.stringify([{ ...base, status: 'done', archivedAt: 1234 }]))
    expect(parsed[0].archivedAt).toBe(1234)
    const repaired = parseLedger(JSON.stringify([{ ...base, status: 'done', archivedAt: 'yesterday' }]))
    expect(repaired[0].archivedAt).toBeUndefined()
  })
  it('round-trips execution targets and repairs broken ones', () => {
    const pinned = createTask(
      { title: 'pinned', description: '', prompt: '', workspaceId: 'ws-1', mode: 'anchored', permission: 'read-only', model: 'p/m', reasoningEffort: 'high' },
      1,
      't-1',
    )
    const parsed = parseLedger(JSON.stringify([pinned]))
    expect(parsed[0].workspaceId).toBe('ws-1')
    expect(parsed[0].mode).toBe('anchored')
    expect(parsed[0].permission).toBe('read-only')
    expect(parsed[0].reasoningEffort).toBe('high')

    // Blank strings clear the pin; unknown permission strings (a future
    // version's value) fall back to the session default, not a dropped row.
    const repaired = parseLedger(JSON.stringify([{
      ...pinned,
      workspaceId: '   ',
      mode: '',
      permission: 'sudo-everything',
      reasoningEffort: '   ',
    }]))
    expect(repaired).toHaveLength(1)
    expect(repaired[0].workspaceId).toBeUndefined()
    expect(repaired[0].mode).toBeUndefined()
    expect(repaired[0].permission).toBeUndefined()
    expect(repaired[0].reasoningEffort).toBeUndefined()

    // A non-string effort is an invalid row, like any other execution-target field.
    expect(parseLedger(JSON.stringify([{ ...pinned, reasoningEffort: 3 }]))).toEqual([])
  })

  it('keeps the session-reuse opt-in and normalizes a bare false (#1419)', () => {
    const optedIn = createTask({ title: 'reuse', description: '', prompt: '', reuseSession: true }, 1, 't-reuse')
    expect(parseLedger(JSON.stringify([optedIn]))[0].reuseSession).toBe(true)

    // A persisted false is not an opt-in: it normalizes back to absent so the
    // ledger only ever carries the canonical "opted in" marker.
    const normalized = parseLedger(JSON.stringify([{ ...optedIn, reuseSession: false }]))
    expect(normalized[0].reuseSession).toBeUndefined()

    // A non-boolean is an invalid row (strict shape), like any other field.
    expect(parseLedger(JSON.stringify([{ ...optedIn, reuseSession: 'yes' }]))).toEqual([])
    expect(isTaskRecord({ ...optedIn, reuseSession: 3 })).toBe(false)
  })
})

describe('isTaskRecord', () => {
  it('validates shape strictly', () => {
    const task = createTask({ title: 'x', description: '', prompt: '' }, 1, 't-1')
    expect(isTaskRecord(task)).toBe(true)
    expect(isTaskRecord({ ...task, status: 'bogus' })).toBe(false)
    expect(isTaskRecord({ ...task, executions: [{ id: 3 }] })).toBe(false)
    expect(isTaskRecord(null)).toBe(false)
    expect(isTaskRecord('x')).toBe(false)
  })
})

describe('InMemoryTaskStore', () => {
  it('stores and clones records (no shared mutation)', () => {
    const store = new InMemoryTaskStore()
    store.save(sampleLedger())
    const loaded = store.load()
    expect(loaded).toEqual(sampleLedger())
    loaded[0].title = 'mutated'
    expect(store.load()[0].title).toBe('A')
    store.clear()
    expect(store.load()).toEqual([])
  })
})

describe('schedule persistence', () => {
  it('round-trips a task with a schedule rule through storage', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    const task = withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, 1, 't-1'),
      { enabled: true, cron: '0 9 * * *', nextRunAt: 100, lastTriggeredAt: 50 },
      2,
    )
    store.save([task])
    expect(store.load()[0].schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: 100, lastTriggeredAt: 50, runCount: 0,
    })
  })

  it('operator saving a rule with its own IANA zone gets it back on reload', () => {
    // Given a card whose rule carries an explicit zone
    // When it is saved and reloaded through storage
    // Then the zone survives alongside the expression
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    const task = withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, 1, 't-1'),
      { enabled: true, cron: '0 9 * * *', timeZone: 'Asia/Shanghai', nextRunAt: 100, lastTriggeredAt: 50 },
      2,
    )
    store.save([task])
    expect(store.load()[0].schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Shanghai', nextRunAt: 100, lastTriggeredAt: 50, runCount: 0,
    })
  })

  it('operator reloading an unresolvable stored zone gets it cleared, not kept', () => {
    // Given stored rules with an unknown zone, a non-string zone and UTC
    // A zone this runtime cannot resolve would make every later resolve fail,
    // so the repair clears it and the rule falls back to the Host zone.
    // When the ledger is parsed
    // Then only the resolvable zone is kept and every rule still parses
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const raw = [
      { ...valid, id: 't-1', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'Not/AZone' } },
      { ...valid, id: 't-2', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 42 } },
      { ...valid, id: 't-3', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'UTC' } },
    ]
    const parsed = parseLedger(JSON.stringify(raw))
    expect(parsed[0].schedule).toEqual({ enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 })
    expect(parsed[1].schedule).toEqual({ enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 })
    expect(parsed[2].schedule).toEqual({ enabled: true, mode: 'cron', cron: '0 9 * * *', timeZone: 'UTC', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 })
  })

  it('operator reloading a ledger keeps a one-shot plan and drops an unusable one', () => {
    // Given one-shot rules: a usable one, one with no instant, and a recurring
    // rule carrying a bad cap, a spent counter and a stop record
    // When the ledger is parsed back
    // Then the unusable plan is dropped and the counter/stop record survive
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const raw = [
      { ...valid, id: 't-1', schedule: { enabled: true, mode: 'once', at: 123 } },
      { ...valid, id: 't-2', schedule: { enabled: true, mode: 'once' } },
      { ...valid, id: 't-3', schedule: { enabled: true, mode: 'cron', cron: '0 9 * * *', maxRuns: 0 } },
      {
        ...valid, id: 't-4',
        schedule: { enabled: true, mode: 'cron', cron: '0 9 * * *', runCount: 2, maxRuns: 2, endedAt: 9, endedReason: 'limit' },
      },
    ]
    const parsed = parseLedger(JSON.stringify(raw))
    expect(parsed[0].schedule).toEqual({ enabled: true, mode: 'once', at: 123, nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 })
    expect(parsed[1].schedule).toBeUndefined() // a one-shot with no instant cannot fire
    expect(parsed[2].schedule).toEqual({ enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 })
    expect(parsed[3].schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', maxRuns: 2,
      nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 2, endedAt: 9, endedReason: 'limit',
    })
  })

  it('keeps legacy tasks without a schedule intact', () => {
    const raw = JSON.stringify([createTask({ title: 'A', description: '', prompt: '' }, 1, 't-1')])
    expect(parseLedger(raw)[0].schedule).toBeUndefined()
  })

  it('repairs a malformed schedule instead of dropping the task row', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const raw = [
      { ...valid, id: 't-1', schedule: { enabled: 'yes', cron: '0 9 * * *', nextRunAt: 'soon', lastTriggeredAt: 5 } },
      { ...valid, id: 't-2', schedule: { enabled: true, cron: '   ' } },
      { ...valid, id: 't-3', schedule: 'nope' },
      { ...valid, id: 't-4', schedule: { enabled: true, cron: 'not a cron' } },
    ]
    const parsed = parseLedger(JSON.stringify(raw))
    expect(parsed).toHaveLength(4) // no row dropped for a bad schedule
    expect(parsed[0].schedule).toEqual({
      enabled: false, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: 5, runCount: 0,
    })
    expect(parsed[1].schedule).toBeUndefined() // blank cron → schedule dropped
    expect(parsed[2].schedule).toBeUndefined() // non-object schedule → dropped
    expect(parsed[3].schedule).toBeUndefined() // malformed cron → schedule dropped
  })

  it('drops a schedule whose cron is malformed instead of accepting it', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const raw = [
      { ...valid, id: 't-1', schedule: { enabled: true, cron: '0 9 * * *' } },
      { ...valid, id: 't-2', schedule: { enabled: true, cron: '* * * *' } },
      { ...valid, id: 't-3', schedule: { enabled: true, cron: '99 99 99 99 99' } },
    ]
    const parsed = parseLedger(JSON.stringify(raw))
    expect(parsed[0].schedule).toEqual({ enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 })
    expect(parsed[1].schedule).toBeUndefined() // not five fields
    expect(parsed[2].schedule).toBeUndefined() // values out of range
  })

})
