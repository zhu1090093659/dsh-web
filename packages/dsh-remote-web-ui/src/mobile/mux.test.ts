/** mux: live-event client, SSE delivery + stall-driven polling fallback. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MuxClient, type EventSourceLike } from './mux.ts'
import type { HistoryPage } from './api.ts'

/** A recorded fake EventSource (delivery driven by the test). */
interface FakeSource extends EventSourceLike {
  url: string
  closed: boolean
  close: () => void
}

/** Create an EventSource factory that records every opened source. */
function makeSources(): { factory: (url: string) => EventSourceLike; sources: FakeSource[] } {
  const sources: FakeSource[] = []
  const factory = (url: string): EventSourceLike => {
    const source: FakeSource = {
      url,
      onmessage: null,
      onerror: null,
      closed: false,
      close: () => { source.closed = true },
    }
    sources.push(source)
    return source
  }
  return { factory, sources }
}

/** One history page whose events carry sequential ids. */
function pageOf(seqs: readonly number[]): HistoryPage {
  return {
    hasMore: false,
    events: seqs.map(seq => ({
      event: { type: 'user/message', seq, time: seq * 1_000, data: { text: String(seq) } },
    })),
  } as unknown as HistoryPage
}

/** A server-request envelope carrying one mux frame (the SSE wire shape). */
function envelopeWith(payload: unknown): string {
  return JSON.stringify({ type: 'server-request', rpcId: 'r1', method: 'events.mux', payload })
}

/** Options common to every test: tight clocks, injected data source. */
function baseOptions(pollLatest: (sessionId: string) => Promise<HistoryPage>, factory: (url: string) => EventSourceLike) {
  return { sourceFactory: factory, pollLatest, stallThresholdMs: 800, pollIntervalMs: 400 }
}

describe('MuxClient polling fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('does not poll while the SSE channel is fresh', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: unknown[] = []
    client.onFrame(frame => { frames.push(frame) })
    client.start()
    client.observe('s1')
    await vi.advanceTimersByTimeAsync(400) // well under the stall threshold
    expect(pollLatest).not.toHaveBeenCalled()
    expect(frames).toHaveLength(0)
    client.stop()
  })

  it('starts polling after silence and emits appended events as session/event frames', async () => {
    const { factory } = makeSources()
    const pages = [pageOf([0]), pageOf([0, 1])]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; sessionId: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    // Nothing live within a poll interval until the stall window passes.
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).not.toHaveBeenCalled()

    // The single tick (400 ms) crosses the 800 ms stall threshold at 1200 ms:
    // the same tick then runs the first poll and emits seq 0.
    await vi.advanceTimersByTimeAsync(800) // 1200ms total -> first stall crossing tick
    expect(pollLatest).toHaveBeenCalledWith('s1')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ type: 'session/event', sessionId: 's1' })
    expect(frames[0]?.event).toMatchObject({ seq: 0 })

    // The next poll emits only the appended event (seq 1), not seq 0 again.
    await vi.advanceTimersByTimeAsync(400)
    expect(frames).toHaveLength(2)
    expect(frames[1]?.event).toMatchObject({ seq: 1 })
    client.stop()
  })

  it('sorts an out-of-order poll page before advancing the watermark', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([2, 1, 3]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(frames.map(frame => frame.event?.seq)).toEqual([1, 2, 3])
    client.stop()
  })

  it('keeps the watermark so a repeated page never re-emits old events', async () => {
    const { factory } = makeSources()
    // Two calls return the same page: the second must emit nothing.
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0, 1, 2]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200) // first poll -> 3 events
    expect(frames).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(400) // second poll -> same page, nothing new
    expect(frames).toHaveLength(3)
    client.stop()
  })

  it('stops polling when observe is cleared and keeps it stopped', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalled()

    client.observe(undefined)
    const callsAfterClear = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(callsAfterClear)
    client.stop()
  })

  it('stops polling on stop(), closing any live source', async () => {
    const { factory, sources } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalled()

    client.stop()
    const callsAfterStop = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(callsAfterStop)
    expect(sources[0]?.closed).toBe(true)
  })

  it('returns to SSE when a frame arrives, dropping the fallback poller', async () => {
    const { factory, sources } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: unknown[] = []
    client.onFrame(frame => { frames.push(frame) })
    client.start()
    client.observe('s1')

    // Stall into polling.
    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)

    // A live mux frame proves SSE delivers again -> fallback stops.
    sources[0]?.onmessage?.({ data: envelopeWith({ type: 'session/subscribed', sessionId: 's1', lastSeq: 4 }) })

    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(1) // polling stopped after the live frame
    const live = frames.filter(frame => (frame as { type?: string })?.type === 'session/subscribed')
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ type: 'session/subscribed', sessionId: 's1' })
    client.stop()
  })

  it('drives the whole lifecycle on a single scheduler tick (one interval)', async () => {
    const { factory } = makeSources()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      const pages = [pageOf([0]), pageOf([0, 1])]
      const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
      const client = new MuxClient('/m/api/events.mux', {
        sourceFactory: factory,
        pollLatest,
        stallThresholdMs: 1500,
        pollIntervalMs: 2000,
      })
      client.start()
      client.observe('s1')

      // Exactly one interval is ever created: the single tick scheduler.
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)

      // The tick fires below the stall threshold without polling.
      await vi.advanceTimersByTimeAsync(1000)
      expect(pollLatest).not.toHaveBeenCalled()

      // The same interval arms the fallback once silence passes the threshold
      // (tick at 2000 crosses 1500) and runs the first poll immediately.
      await vi.advanceTimersByTimeAsync(1100) // 2100ms total
      expect(pollLatest).toHaveBeenCalledTimes(1)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1) // still one timer

      // Subsequent polls ride the same tick at the poll cadence (2000 ms).
      await vi.advanceTimersByTimeAsync(2000)
      expect(pollLatest).toHaveBeenCalledTimes(2)
      client.stop()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it('paces polls on the tick only after the stall phase ends', async () => {
    const { factory } = makeSources()
    const pages = [pageOf([0]), pageOf([0, 1]), pageOf([0, 1, 2]), pageOf([0, 1, 2, 3])]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', {
      sourceFactory: factory,
      pollLatest,
      stallThresholdMs: 800,
      pollIntervalMs: 400,
    })
    client.start()
    client.observe('s1')

    // At 1200 ms the stall threshold is crossed on this single 400 ms tick.
    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)

    // Each subsequent 400 ms tick is a poll, matching the poll cadence.
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(4)
    client.stop()
  })

  it('observe() already in the stall window starts the single-tick poller immediately', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    // Advance well past the stall threshold while nothing is observed.
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest).not.toHaveBeenCalled()

    // Observing a session now is already in the stall window: poll right away.
    client.observe('s1')
    expect(pollLatest).toHaveBeenCalledTimes(1)
    client.stop()
  })
})