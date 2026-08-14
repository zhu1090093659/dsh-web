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

    // Past the stall threshold the first poll runs and emits seq 0.
    await vi.advanceTimersByTimeAsync(700) // 1100ms total -> first stall-checker tick
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

  it('keeps the watermark so a repeated page never re-emits old events', async () => {
    const { factory } = makeSources()
    // Two calls return the same page: the second must emit nothing.
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0, 1, 2]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1100) // first poll -> 3 events
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

    await vi.advanceTimersByTimeAsync(1100)
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

    await vi.advanceTimersByTimeAsync(1100)
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
    await vi.advanceTimersByTimeAsync(1100)
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
})