/**
 * Mobile-surface live-event client: the plugin's `/m/api/events.mux` SSE
 * channel (Server-Sent Events — the host bridges the mux stream onto it, so
 * no WebSocket handshake or framing is needed on this side). The host
 * pushes mux frames (subscribed baselines, session events, approvals,
 * questions, queue snapshots, tasks, projections) as soon as the stream
 * opens — no subscription handshake is needed. Frames arrive as
 * server-request envelopes whose payload is the mux frame; unknown frame
 * types are dropped so a newer host never breaks this client.
 *
 * EventSource reconnects automatically — but only over a tunnel that
 * actually forwards frames. Public quick tunnels (Cloudflare quick tunnel /
 * Tailscale Serve) do not transparently pass Server-Sent Events: ordinary
 * HTTP works, yet the SSE connection stays open or reconnects with zero
 * bytes, so no live frame ever arrives. That is a transport-layer limit of
 * the tunnel, not something the host can fix. This client therefore
 * degrades gracefully: once the SSE channel has silently stalled (no frame
 * for {@link MuxClientOptions.stallThresholdMs}, or the EventSource reports
 * an error), it starts polling the open session's history over plain HTTP
 * (the `/m/api/session.history` RPC — unaffected by the SSE limitation),
 * and re-emits freshly appended events as `session/event` frames through
 * the same subscriber contract, so listeners (and the message fold) behave
 * exactly as if the frames had arrived over SSE. When the SSE channel
 * delivers again, fallback polling stops and the live stream takes over.
 */

import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { history as fetchHistory, type HistoryPage } from './api.ts'

/** Injectable seams for tests. */
export interface MuxClientOptions {
  /** EventSource factory (defaults to the browser EventSource). */
  sourceFactory?: (url: string) => EventSourceLike
  /**
   * Fetch one history page (tail) for a session — the polling fallback's
   * data source. Defaults to the mobile `session.history` RPC, which rides
   * the ordinary HTTP channel (unaffected by SSE-impairing tunnels).
   */
  pollLatest?: (sessionId: string) => Promise<HistoryPage>
  /** Poll cadence while SSE is stalled (default 3000 ms). */
  pollIntervalMs?: number
  /** How long SSE must go without a frame before fallback kicks in (default 12000 ms). */
  stallThresholdMs?: number
  /** Clock seam for tests (defaults to Date.now). */
  now?: () => number
}

/** The EventSource subset this client uses (browser EventSource fits). */
export interface EventSourceLike {
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  close(): void
}

/** Browser default source factory. */
function browserSource(url: string): EventSourceLike {
  // The DOM EventSource is structurally compatible; the `this`-typed handler
  // signatures differ, so the narrow face takes it through an adapter cast.
  return new EventSource(url) as unknown as EventSourceLike
}

/** The `session/event` arm of the mux frame union. */
type SessionEventFrame = Extract<MuxFrame, { type: 'session/event' }>

const DEFAULT_POLL_INTERVAL_MS = 3000
const DEFAULT_STALL_THRESHOLD_MS = 12000
/** Poll window: enough recent events to cover a few seconds of agent output. */
const DEFAULT_POLL_PAGE_SIZE = 50

/**
 * Keep one SSE subscription open, fanning validated frames out to
 * subscribers. EventSource owns reconnection (with its own backoff); this
 * class only manages the subscription lifecycle, plus a polling fallback
 * that keeps the open session live when the SSE channel cannot deliver.
 */
export class MuxClient {
  private readonly sourceFactory: (url: string) => EventSourceLike
  private readonly pollLatest: (sessionId: string) => Promise<HistoryPage>
  private readonly pollIntervalMs: number
  private readonly stallThresholdMs: number
  private readonly now: () => number
  private readonly listeners = new Set<(frame: MuxFrame) => void>()
  private source: EventSourceLike | undefined
  private stopped = false
  private readonly url: string

  /** The session to keep live via fallback polling (undefined = none). */
  private observeSessionId: string | undefined
  /** Last epoch ms the SSE channel produced a frame (or the stream opened). */
  private lastDataAt = 0
  /**
   * Whether the SSE channel has ever delivered a frame in this stream (a
   * delivered frame proves the tunnel forwards SSE; silence alone then means
   * the agent idle, not a dead channel — only an onerror re-arms fallback).
   */
  private sseAlive = false
  /** Per-session highest event seq already emitted, for poll dedup. */
  private readonly pollWatermark = new Map<string, number>()
  private stallTimer: ReturnType<typeof setInterval> | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private polling = false

  /**
   * @param url - the mobile events endpoint (browser-relative).
   * @param options - seams.
   */
  constructor(url = '/m/api/events.mux', options: MuxClientOptions = {}) {
    this.url = url
    this.sourceFactory = options.sourceFactory ?? browserSource
    this.pollLatest = options.pollLatest ?? ((sessionId) => fetchHistory(sessionId, undefined, DEFAULT_POLL_PAGE_SIZE))
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Open the stream (idempotent; EventSource reconnects until {@link stop}). */
  start(): void {
    this.stopped = false
    this.lastDataAt = this.now()
    if (this.source === undefined) this.connect()
    this.startStallChecker()
  }

  /** Close for good. */
  stop(): void {
    this.stopped = true
    this.stopStallChecker()
    this.stopPolling()
    this.closeSource()
    this.observeSessionId = undefined
  }

  /** Subscribe to validated frames; returns an unsubscribe function. */
  onFrame(listener: (frame: MuxFrame) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Point the fallback at one open session (or `undefined` to stop it).
   * While the SSE channel is stalled this client polls that session's
   * history and re-emits new events as `session/event` frames.
   */
  observe(sessionId: string | undefined): void {
    this.observeSessionId = sessionId
    if (sessionId === undefined) {
      this.stopPolling()
      return
    }
    // If SSE is already stalled for this session, start patching right away.
    if (!this.polling && !this.stopped && !this.sseAlive && (this.now() - this.lastDataAt) > this.stallThresholdMs) {
      this.startPolling()
    }
  }

  private connect(): void {
    // A fresh stream starts unknown; only a delivered frame proves it works.
    this.sseAlive = false
    const source = this.sourceFactory(this.url)
    this.source = source
    source.onmessage = (event) => {
      this.handleMessage(event.data)
    }
    source.onerror = () => {
      // EventSource reconnects by itself; when we are closing, detach first
      // so the native reconnect cannot outlive stop(). Otherwise an error is
      // a strong signal the transport is not delivering — degrade to polling.
      if (this.stopped && this.source === source) {
        this.closeSource()
        return
      }
      this.sseAlive = false
      if (this.observeSessionId !== undefined) this.startPolling()
    }
  }

  private startStallChecker(): void {
    this.stopStallChecker()
    this.stallTimer = setInterval(() => {
      if (this.stopped) return
      if (this.observeSessionId === undefined) return
      if (this.polling) return
      // A live SSE channel only goes silent while the agent idles; never
      // poll against it. Fallback arms again only via onerror or a stream
      // that has never delivered.
      if (this.sseAlive) return
      if ((this.now() - this.lastDataAt) > this.stallThresholdMs) this.startPolling()
    }, 1000)
  }

  private stopStallChecker(): void {
    if (this.stallTimer !== undefined) {
      clearInterval(this.stallTimer)
      this.stallTimer = undefined
    }
  }

  private startPolling(): void {
    if (this.polling || this.stopped) return
    this.polling = true
    void this.pollTick()
    this.pollTimer = setInterval(() => { void this.pollTick() }, this.pollIntervalMs)
  }

  private stopPolling(): void {
    this.polling = false
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /**
   * Fetch the latest history page for the observed session and re-emit any
   * event above the per-session watermark as a `session/event` frame.
   * Idempotent by seq: listeners (and the fold) never see a duplicate.
   */
  private async pollTick(): Promise<void> {
    const sessionId = this.observeSessionId
    if (sessionId === undefined) {
      this.stopPolling()
      return
    }
    try {
      const page = await this.pollLatest(sessionId)
      let maxSeq = this.pollWatermark.get(sessionId) ?? -1
      for (const entry of page.events) {
        const event = entry.event
        const seq = typeof event?.seq === 'number' ? event.seq : -1
        if (seq <= maxSeq) continue
        maxSeq = seq
        this.emit({ type: 'session/event', sessionId: sessionId as SessionEventFrame['sessionId'], event } as SessionEventFrame)
      }
      this.pollWatermark.set(sessionId, maxSeq)
    } catch {
      // Transient (network, pairing, history paging); the next tick retries.
    }
  }

  private handleMessage(data: string): void {
    if (typeof data !== 'string' || data === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    // The SSE channel carries server-request envelopes whose payload is the
    // mux frame (same wire shape as the desktop mux channel).
    const envelope = serverRequestSchema.safeParse(parsed)
    if (!envelope.success) return
    const frame = muxFrameSchema.safeParse(envelope.data.payload)
    if (!frame.success) return
    // A delivered frame proves the SSE channel is live (the tunnel forwards
    // it) and delivers again — drop any fallback polling so the live stream
    // takes over without double delivery.
    this.sseAlive = true
    this.lastDataAt = this.now()
    if (this.polling) this.stopPolling()
    this.emit(frame.data)
  }

  private emit(frame: MuxFrame): void {
    for (const listener of this.listeners) {
      try {
        listener(frame)
      } catch {
        // A throwing subscriber must not break the emit loop.
      }
    }
  }

  private closeSource(): void {
    const source = this.source
    this.source = undefined
    if (source !== undefined) {
      source.onmessage = null
      source.onerror = null
      try {
        source.close()
      } catch {
        // Already closed.
      }
    }
  }
}