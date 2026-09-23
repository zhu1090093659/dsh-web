/**
 * Page-wide body mutation hub: one native observer regardless of how many
 * family plugins subscribe, coalesced per animation frame, with records
 * delivered and clean teardown of the last subscriber.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeBodyInvalidations, subscribeBodyMutations } from '../client/body-mutations.ts'

const HUB_KEY = Symbol.for('dsh-web.body-mutation-hub')

interface MutationObserverSpy {
  instances: number
  observeCalls: number
  disconnects: number
}

/** Count native observers without changing their behaviour. */
function spyOnMutationObserver(): MutationObserverSpy {
  const Native = globalThis.MutationObserver
  const spy: MutationObserverSpy = { instances: 0, observeCalls: 0, disconnects: 0 }
  class Counting extends Native {
    observe(target: Node, options?: MutationObserverInit): void {
      spy.observeCalls += 1
      super.observe(target, options)
    }
    override disconnect(): void {
      spy.disconnects += 1
      super.disconnect()
    }
  }
  vi.stubGlobal('MutationObserver', Counting as unknown as typeof MutationObserver)
  spy.instances = 0
  // The hub counts instances through the constructor.
  const Original = Counting
  const proxy = new Proxy(Original, {
    construct(target, args) {
      spy.instances += 1
      return Reflect.construct(target, args)
    },
  })
  vi.stubGlobal('MutationObserver', proxy)
  return spy
}

/** Controllable animation-frame queue (jsdom's rAF timing is not deterministic here). */
function stubAnimationFrame(): { flush: () => void; pending: () => number } {
  const queue = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => { queue.delete(frame) })
  return {
    flush: () => {
      const batch = [...queue.values()]
      queue.clear()
      for (const callback of batch) callback(0)
    },
    pending: () => queue.size,
  }
}

function clearHub(): void {
  const registry = globalThis as unknown as Record<symbol, unknown>
  const hub = registry[HUB_KEY] as { observer?: { disconnect(): void } } | undefined
  hub?.observer?.disconnect()
  delete registry[HUB_KEY]
}

describe('subscribeBodyMutations', () => {
  beforeEach(() => {
    clearHub()
  })

  afterEach(() => {
    clearHub()
    vi.unstubAllGlobals()
  })

  it('uses exactly one native observer for many subscribers', () => {
    const spy = spyOnMutationObserver()
    stubAnimationFrame()
    const disposers = [
      subscribeBodyMutations(() => {}),
      subscribeBodyMutations(() => {}),
      subscribeBodyMutations(() => {}),
    ]
    expect(spy.instances).toBe(1)
    expect(spy.observeCalls).toBe(1)
    disposers.forEach(dispose => dispose())
  })

  it('delivers childList mutations to every subscriber, coalesced per frame', async () => {
    spyOnMutationObserver()
    const frames = stubAnimationFrame()
    const first = vi.fn()
    const second = vi.fn()
    const disposeFirst = subscribeBodyMutations(first)
    const disposeSecond = subscribeBodyMutations(second)

    const node = document.createElement('div')
    document.body.appendChild(node)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(frames.pending()).toBe(1)

    frames.flush()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    const records = first.mock.calls[0]?.[0] as MutationRecord[]
    expect(records.length).toBeGreaterThan(0)
    expect(records.some(record => record.type === 'childList')).toBe(true)

    // Further mutations in a later frame are delivered again, not lost.
    const another = document.createElement('span')
    document.body.appendChild(another)
    await new Promise(resolve => setTimeout(resolve, 0))
    frames.flush()
    expect(first).toHaveBeenCalledTimes(2)

    disposeFirst()
    disposeSecond()
  })

  it('keeps working for the remaining subscribers when one throws', async () => {
    spyOnMutationObserver()
    const frames = stubAnimationFrame()
    const healthy = vi.fn()
    const disposeThrower = subscribeBodyMutations(() => { throw new Error('boom') })
    const disposeHealthy = subscribeBodyMutations(healthy)

    document.body.appendChild(document.createElement('div'))
    await new Promise(resolve => setTimeout(resolve, 0))
    frames.flush()
    expect(healthy).toHaveBeenCalledTimes(1)

    disposeThrower()
    disposeHealthy()
  })

  it('drops the hub when the last subscriber leaves and re-creates it after', () => {
    const spy = spyOnMutationObserver()
    stubAnimationFrame()
    const disposeFirst = subscribeBodyMutations(() => {})
    const disposeSecond = subscribeBodyMutations(() => {})
    expect(spy.instances).toBe(1)

    disposeFirst()
    expect(spy.disconnects).toBe(0)
    disposeSecond()
    expect(spy.disconnects).toBe(1)

    const disposeThird = subscribeBodyMutations(() => {})
    expect(spy.instances).toBe(2)
    disposeThird()
  })

  it('returns an inert disposer when MutationObserver is unavailable', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const dispose = subscribeBodyMutations(() => {})
    expect(() => dispose()).not.toThrow()
  })

  it('coalesces invalidations without retaining detached subtrees while frames are paused', async () => {
    const frames = stubAnimationFrame()
    const listener = vi.fn()
    const dispose = subscribeBodyInvalidations(listener)
    const region = document.createElement('section')
    document.body.appendChild(region)
    for (let index = 0; index < 1000; index += 1) region.replaceChildren(document.createElement('article'))
    await Promise.resolve()

    const hub = (globalThis as unknown as Record<symbol, { pending: MutationRecord[] }>)[HUB_KEY]
    expect(hub.pending).toHaveLength(0)
    expect(listener).not.toHaveBeenCalled()
    expect(frames.pending()).toBe(1)
    frames.flush()
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith()
    dispose()
    region.remove()
  })

  it('preserves complete records when record consumers coexist with invalidation consumers', async () => {
    const frames = stubAnimationFrame()
    const invalidated = vi.fn()
    const recorded = vi.fn()
    const disposeInvalidated = subscribeBodyInvalidations(invalidated)
    const disposeRecorded = subscribeBodyMutations(recorded)
    const node = document.createElement('article')
    document.body.appendChild(node)
    node.remove()
    await Promise.resolve()
    frames.flush()

    const records = recorded.mock.calls[0][0] as MutationRecord[]
    expect(records.some(record => Array.from(record.addedNodes).includes(node))).toBe(true)
    expect(records.some(record => Array.from(record.removedNodes).includes(node))).toBe(true)
    expect(invalidated).toHaveBeenCalledOnce()
    disposeRecorded()

    document.body.appendChild(node)
    await Promise.resolve()
    const hub = (globalThis as unknown as Record<symbol, { pending: MutationRecord[] }>)[HUB_KEY]
    expect(hub.pending).toHaveLength(0)
    frames.flush()
    expect(invalidated).toHaveBeenCalledTimes(2)
    disposeInvalidated()
    node.remove()
  })

  it('releases queued records when only invalidation subscribers remain', async () => {
    const frames = stubAnimationFrame()
    const invalidated = vi.fn()
    const disposeInvalidated = subscribeBodyInvalidations(invalidated)
    const disposeRecorded = subscribeBodyMutations(() => {})
    document.body.appendChild(document.createElement('div'))
    await Promise.resolve()
    const hub = (globalThis as unknown as Record<symbol, { pending: MutationRecord[] }>)[HUB_KEY]
    expect(hub.pending.length).toBeGreaterThan(0)
    disposeRecorded()
    expect(hub.pending).toHaveLength(0)
    expect(frames.pending()).toBe(1)
    frames.flush()
    expect(invalidated).toHaveBeenCalledOnce()
    disposeInvalidated()
  })

  it('shares one hub across separately evaluated module copies', async () => {
    const spy = spyOnMutationObserver()
    const frames = stubAnimationFrame()
    const first = vi.fn()
    const second = vi.fn()
    const disposeFirst = subscribeBodyInvalidations(first)
    vi.resetModules()
    const copy = await import('../client/body-mutations.ts')
    const disposeSecond = copy.subscribeBodyInvalidations(second)
    document.body.appendChild(document.createElement('div'))
    await Promise.resolve()
    frames.flush()
    expect(spy.instances).toBe(1)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    disposeFirst()
    expect(spy.disconnects).toBe(0)
    disposeSecond()
    expect(spy.disconnects).toBe(1)
  })

  it('can join an older hub whose subscribers still receive records', () => {
    const observer = { disconnect: vi.fn() }
    const subscribers = new Set<(records: MutationRecord[]) => void>()
    const registry = globalThis as unknown as Record<symbol, unknown>
    registry[HUB_KEY] = { observer, subscribers, pending: [], scheduled: false }
    const listener = vi.fn()
    const dispose = subscribeBodyInvalidations(listener)
    for (const subscribed of subscribers) subscribed([])
    expect(listener).toHaveBeenCalledOnce()
    dispose()
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(registry[HUB_KEY]).toBeUndefined()
  })

  it('cancels a pending frame and releases its records after the last unsubscribe', async () => {
    const frames = stubAnimationFrame()
    const listener = vi.fn()
    const dispose = subscribeBodyMutations(listener)
    document.body.appendChild(document.createElement('div'))
    await Promise.resolve()
    const hub = (globalThis as unknown as Record<symbol, { pending: MutationRecord[] }>)[HUB_KEY]
    expect(hub.pending.length).toBeGreaterThan(0)
    dispose()
    dispose()
    expect(hub.pending).toHaveLength(0)
    expect(frames.pending()).toBe(0)
    frames.flush()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not invoke a listener unsubscribed by an earlier listener in the same flush', async () => {
    const frames = stubAnimationFrame()
    const second = vi.fn()
    let disposeSecond = () => {}
    const disposeFirst = subscribeBodyInvalidations(() => { disposeSecond() })
    disposeSecond = subscribeBodyInvalidations(second)
    document.body.appendChild(document.createElement('div'))
    await Promise.resolve()
    frames.flush()
    expect(second).not.toHaveBeenCalled()
    disposeFirst()
  })

  it('delivers invalidations without animation-frame support', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const listener = vi.fn()
    const dispose = subscribeBodyInvalidations(listener)
    document.body.appendChild(document.createElement('div'))
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    dispose()
  })
})
