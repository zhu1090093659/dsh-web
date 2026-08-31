/**
 * Remote-presence to pet-visibility link: while a paired device is online
 * the host-global pet hides through its own hide switch; after the last
 * device stays offline past the grace window the pet restores. The pet is
 * optional, manual hides are respected, and pending restores cancel on
 * re-connect.
 */
import { describe, expect, it } from 'vitest'
import { startRemotePresencePet, type PresencePetSeam } from '../src/remote-presence-pet.ts'

interface SnapshotLike {
  phase: string
  onlineCount: number
}

function makePet(visible = true): {
  seam: PresencePetSeam
  calls: Array<{ action: string; value?: boolean }>
} {
  const calls: Array<{ action: string; value?: boolean }> = []
  let current = visible
  const seam: PresencePetSeam = {
    setVisible(value: boolean) {
      calls.push({ action: 'setVisible', value })
      current = value
      return Promise.resolve({ ok: true as const, display: { visible: current } })
    },
    state() {
      calls.push({ action: 'state' })
      return Promise.resolve({ display: { visible: current } })
    },
  }
  return { seam, calls }
}

function harness(overrides: {
  restoreAfterMs?: number
  petVisible?: boolean
  noPet?: boolean
} = {}): {
  emit(snapshot: SnapshotLike): void
  runTasks(): Promise<void>
  calls: Array<{ action: string; value?: boolean }>
  dispose(): void
} {
  const pet = makePet(overrides.petVisible ?? true)
  const listeners = new Set<(snapshot: SnapshotLike) => void>()
  let taskId = 0
  const tasks = new Map<number, () => void>()
  const timers = {
    setTimeout(fn: () => void, ms: number): unknown {
      const id = ++taskId
      tasks.set(id, fn)
      return id
    },
    clearTimeout(id: unknown): void {
      tasks.delete(id as number)
    },
  }
  const dispose = startRemotePresencePet({
    onState: (listener) => {
      listeners.add(listener as never)
      return () => { listeners.delete(listener as never) }
    },
    pet: () => (overrides.noPet === true ? undefined : pet.seam),
    restoreAfterMs: overrides.restoreAfterMs ?? 1,
    timers,
  })
  return {
    emit(snapshot) {
      for (const listener of [...listeners]) (listener as (s: SnapshotLike) => void)(snapshot)
    },
    async runTasks() {
      for (;;) {
        const tasksNow = [...tasks.values()]
        tasks.clear()
        if (tasksNow.length === 0) return
        for (const task of tasksNow) task()
        await Promise.resolve()
      }
    },
    calls: pet.calls,
    dispose,
  }
}

describe('startRemotePresencePet', () => {
  it('hides the pet when the first device comes online and restores after the last leaves', async () => {
    const h = harness()
    h.emit({ phase: 'disconnected', onlineCount: 0 })
    h.emit({ phase: 'connected', onlineCount: 1 })
    await h.runTasks()
    expect(h.calls).toEqual([{ action: 'state' }, { action: 'setVisible', value: false }])

    h.emit({ phase: 'disconnected', onlineCount: 0 })
    await h.runTasks()
    expect(h.calls.at(-1)).toEqual({ action: 'setVisible', value: true })
    h.dispose()
  })

  it('cancels a pending restore when the device reconnects inside the grace window', async () => {
    const h = harness()
    h.emit({ phase: 'connected', onlineCount: 1 })
    await h.runTasks()
    expect(h.calls).toEqual([{ action: 'state' }, { action: 'setVisible', value: false }])

    h.emit({ phase: 'disconnected', onlineCount: 0 })
    h.emit({ phase: 'connected', onlineCount: 1 })
    await h.runTasks()
    // One hide only, and the immediate reconnect cancels the pending restore
    // (the timeline never produced a visible pet in between).
    const visibleCalls = h.calls.filter(c => c.action === 'setVisible')
    expect(visibleCalls).toEqual([{ action: 'setVisible', value: false }])
    h.dispose()
  })

  it('respects a pet the user already hid: records nothing and restores nothing', async () => {
    const h = harness({ petVisible: false })
    h.emit({ phase: 'connected', onlineCount: 1 })
    await h.runTasks()
    expect(h.calls).toEqual([{ action: 'state' }])
    h.emit({ phase: 'disconnected', onlineCount: 0 })
    await h.runTasks()
    expect(h.calls).toEqual([{ action: 'state' }])
    h.dispose()
  })

  it('is a no-op without the pet plugin', async () => {
    const h = harness({ noPet: true })
    h.emit({ phase: 'connected', onlineCount: 1 })
    await h.runTasks()
    h.emit({ phase: 'disconnected', onlineCount: 0 })
    await h.runTasks()
    expect(h.calls).toEqual([])
    h.dispose()
  })

  it('does not double-hide when a second device joins while hidden', async () => {
    const h = harness()
    h.emit({ phase: 'connected', onlineCount: 1 })
    await h.runTasks()
    // Another device comes online: still connected, no transition.
    h.emit({ phase: 'connected', onlineCount: 2 })
    await h.runTasks()
    expect(h.calls.filter(c => c.action === 'setVisible')).toEqual([{ action: 'setVisible', value: false }])
    h.dispose()
  })
})
