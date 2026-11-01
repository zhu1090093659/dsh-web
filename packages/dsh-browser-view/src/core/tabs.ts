/**
 * Tab lifecycle over one CDP connection: create, list, select, close, and the
 * per-tab instrumentation the panel and the tools read.
 *
 * Each tab is a flat-mode session. Three domain subscriptions make a tab
 * observable — `Runtime`/`Log` for the console ring, `Network` for the
 * request table, `Page` for navigation state and the screencast — and they are
 * enabled once, when the tab is attached, because a domain that is enabled late
 * silently misses everything that happened before it.
 *
 * Ring buffers are bounded by {@link EVENT_RING_SIZE}: an unbounded console
 * turns a chatty page into an unbounded memory leak in the host process, and
 * the ring's newest entries are the ones anyone reads.
 *
 * Screencast frames must be acknowledged one by one. Chrome stops sending after
 * an unacknowledged frame, so a dropped ack looks exactly like a frozen page.
 *
 * @module @linxin666/dsh-client-ui-browser-view/core/tabs
 */

import type { CdpTransport } from './cdp.ts'
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_VIEWPORT,
  EVENT_RING_SIZE,
  type BrowserConsoleEntry,
  type BrowserNetworkEntry,
  type BrowserTabView,
} from './protocol.ts'
import type { CdpScreenshotParams } from './screenshot.ts'

/** One JPEG frame as the panel receives it. */
export interface ScreencastFrame {
  /** Tab the frame belongs to. */
  tabId: string
  /** Monotonic per-tab frame counter. */
  seq: number
  /** Frame width in CSS pixels. */
  width: number
  /** Frame height in CSS pixels. */
  height: number
  /** Base64 JPEG without the `data:` prefix. */
  data: string
}

/** Construction options. */
export interface TabManagerOptions {
  /** The protocol transport every tab shares. */
  transport: CdpTransport
  /** JPEG quality requested from CDP. @default DEFAULT_JPEG_QUALITY */
  jpegQuality?: number
  /** Viewport pinned on every new tab. @default DEFAULT_VIEWPORT */
  viewport?: { width: number; height: number }
  /** Console and network ring size. @default EVENT_RING_SIZE */
  ringSize?: number
  /** Clock used for entry timestamps. @default Date.now */
  now?: () => number
  /** Receives every screencast frame and every explicitly refreshed frame. */
  onFrame?: (frame: ScreencastFrame) => void
  /** Notifies that a tab's url, title, loading state, or membership changed. */
  onTabsChanged?: () => void
  /** Discover and adopt existing/future page targets instead of only DSH-created ones. */
  discoverTargets?: boolean
  /** Pin new tabs to the fixed isolated viewport. @default true */
  pinViewport?: boolean
}

/** One tab's host-side record. */
interface TabRecord {
  id: string
  sessionId: string
  url: string
  title: string
  loading: boolean
  /**
   * Loader id of the document the observation buffers describe. A new loader
   * id means a new document, which is what makes "the console only shows this
   * page" hold even when the address itself did not change (a reload).
   */
  loaderId: string | undefined
  ownerSessionId: string | undefined
  origin: 'created' | 'adopted'
  console: BrowserConsoleEntry[]
  network: BrowserNetworkEntry[]
  /** Pending requests keyed by network request id, so response frames update in place. */
  pendingRequests: Map<string, BrowserNetworkEntry>
  screencastRunning: boolean
  frameSeq: number
  /** Depth-first ref to CSS selector map captured by the last snapshot. */
  refs: Map<number, string>
}

/** Params of one `Page.screencastFrame` event. */
interface TargetInfoParams {
  targetId?: unknown
  type?: unknown
  url?: unknown
  title?: unknown
}

interface ScreencastFrameParams {
  data?: unknown
  sessionId?: unknown
  metadata?: { deviceWidth?: unknown; deviceHeight?: unknown }
}

/** Params of one `Runtime.consoleAPICalled` event. */
interface ConsoleCalledParams {
  type?: unknown
  args?: Array<{ value?: unknown; description?: unknown; unserializableValue?: unknown; type?: unknown }>
}

/** Params of one `Log.entryAdded` event. */
interface LogEntryParams {
  entry?: { level?: unknown; text?: unknown }
}

/** Params of one `Network.requestWillBeSent` event. */
interface RequestWillBeSentParams {
  requestId?: unknown
  request?: { url?: unknown; method?: unknown }
}

/** Params of one `Network.responseReceived` event. */
interface ResponseReceivedParams {
  requestId?: unknown
  response?: { status?: unknown; mimeType?: unknown }
}

/** Params of one `Network.loadingFailed` event. */
interface LoadingFailedParams {
  requestId?: unknown
  errorText?: unknown
}

/** Params of one `Page.frameNavigated` event. */
interface FrameNavigatedParams {
  frame?: { url?: unknown; parentId?: unknown; loaderId?: unknown }
}

/**
 * Append one entry to a bounded ring, dropping the oldest overflow.
 * @param ring - the ring, mutated in place.
 * @param entry - the new entry.
 * @param limit - maximum retained entries.
 */
export function pushBounded<T>(ring: T[], entry: T, limit: number): void {
  ring.push(entry)
  const overflow = ring.length - limit
  // One splice instead of a shift per item: a page that logs in a tight loop
  // can overflow by more than one entry between two reads.
  if (overflow > 0) ring.splice(0, overflow)
}

/** Render one console argument the way a browser console would print it. */
function describeConsoleArg(arg: { value?: unknown; description?: unknown; unserializableValue?: unknown; type?: unknown }): string {
  if (typeof arg.unserializableValue === 'string') return arg.unserializableValue
  if (arg.value !== undefined) {
    if (typeof arg.value === 'string') return arg.value
    try {
      return JSON.stringify(arg.value)
    } catch {
      return String(arg.value)
    }
  }
  if (typeof arg.description === 'string') return arg.description
  return typeof arg.type === 'string' ? `[${arg.type}]` : '[unserializable]'
}

/**
 * One browser's tabs.
 */
export class TabManager {
  private readonly transport: CdpTransport
  private readonly jpegQuality: number
  private readonly viewport: { width: number; height: number }
  private readonly ringSize: number
  private readonly now: () => number
  private readonly discoversTargets: boolean
  private readonly pinViewports: boolean
  private onFrame: ((frame: ScreencastFrame) => void) | undefined
  private onTabsChanged: (() => void) | undefined
  private readonly tabs = new Map<string, TabRecord>()
  private readonly bySession = new Map<string, TabRecord>()
  private readonly unsubscribers: Array<() => void> = []
  private readonly attaching = new Map<string, Promise<TabRecord>>()
  private active: string | null = null
  private disposed = false

  /**
   * @param options - transport, viewport, ring size, callbacks.
   */
  constructor(options: TabManagerOptions) {
    this.transport = options.transport
    this.jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY
    this.viewport = options.viewport ?? { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height }
    this.ringSize = options.ringSize ?? EVENT_RING_SIZE
    this.now = options.now ?? Date.now
    this.discoversTargets = options.discoverTargets ?? false
    this.pinViewports = options.pinViewport ?? true
    this.onFrame = options.onFrame
    this.onTabsChanged = options.onTabsChanged
    this.subscribe()
  }

  /** Replace the frame sink (the service rewires it when a panel attaches). */
  setFrameSink(sink: ((frame: ScreencastFrame) => void) | undefined): void {
    this.onFrame = sink
  }

  /** Replace the tab-change sink. */
  setTabsChangedSink(sink: (() => void) | undefined): void {
    this.onTabsChanged = sink
  }

  /** Tabs in creation order. */
  list(): BrowserTabView[] {
    return [...this.tabs.values()].map(tab => this.view(tab))
  }

  /** The tab the panel watches, if any. */
  get activeTabId(): string | null {
    return this.active
  }

  /** Whether a tab id is still open. */
  has(tabId: string): boolean {
    return this.tabs.has(tabId)
  }

  /**
   * Resolve one tab or fail with a message the model can act on.
   * @param tabId - id from a previous tool call or panel event.
   * @returns the tab record.
   */
  tab(tabId: string): BrowserTabView {
    const record = this.tabs.get(tabId)
    if (record === undefined) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`)
    return this.view(record)
  }

  /** Internal record access for the layers that need the CDP session. */
  sessionOf(tabId: string): string {
    const record = this.tabs.get(tabId)
    if (record === undefined) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`)
    return record.sessionId
  }

  /**
   * Create one tab and instrument it.
   * @param options - url to open and the session that asked for it.
   * @returns the new tab as the panel sees it.
   */
  async createTab(options: { url?: string; sessionId?: string } = {}): Promise<BrowserTabView> {
    const created = await this.transport.send<{ targetId?: string }>('Target.createTarget', { url: 'about:blank' })
    const targetId = created.targetId
    if (typeof targetId !== 'string' || targetId === '') throw new Error('the browser did not return a target id for the new tab')
    const record = await this.attachTarget({ targetId, type: 'page', url: 'about:blank', title: '' }, 'created')
    record.ownerSessionId = options.sessionId
    this.active = targetId
    if (this.pinViewports) await this.pinViewport(record)
    if (options.url !== undefined && options.url !== '') await this.navigate(targetId, options.url)
    this.onTabsChanged?.()
    return this.view(record)
  }

  /** Discover every existing page and keep following pages created later. */
  async discoverExistingTabs(): Promise<void> {
    if (!this.discoversTargets || this.disposed) return
    await this.transport.send('Target.setDiscoverTargets', { discover: true })
    const result = await this.transport.send<{ targetInfos?: TargetInfoParams[] }>('Target.getTargets')
    for (const info of result.targetInfos ?? []) {
      if (info.type !== 'page') continue
      await this.attachTarget(info, 'adopted').catch(() => undefined)
    }
    this.onTabsChanged?.()
  }

  /** Adopt one target-created event without racing an explicit create/attach. */
  private async adoptTarget(info: TargetInfoParams): Promise<void> {
    if (this.disposed || info.type !== 'page') return
    await this.attachTarget(info, 'adopted')
    this.onTabsChanged?.()
  }

  /** Attach a page exactly once, coalescing discovery and Target.createTarget. */
  private async attachTarget(info: TargetInfoParams, origin: 'created' | 'adopted'): Promise<TabRecord> {
    const targetId = info.targetId
    if (typeof targetId !== 'string' || targetId === '') throw new Error('the browser did not return a target id')
    const existing = this.tabs.get(targetId)
    if (existing !== undefined) {
      if (origin === 'created') existing.origin = 'created'
      return existing
    }
    const inFlight = this.attaching.get(targetId)
    if (inFlight !== undefined) {
      const record = await inFlight
      if (origin === 'created') record.origin = 'created'
      return record
    }
    const task = this.attachNewTarget(targetId, info, origin)
    this.attaching.set(targetId, task)
    try {
      return await task
    } finally {
      this.attaching.delete(targetId)
    }
  }

  /** Build and instrument one previously unseen page record. */
  private async attachNewTarget(targetId: string, info: TargetInfoParams, origin: 'created' | 'adopted'): Promise<TabRecord> {
    if (this.disposed) throw new Error('the tab manager is disposed')
    const attached = await this.transport.send<{ sessionId?: string }>('Target.attachToTarget', { targetId, flatten: true })
    const sessionId = attached.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error(`the browser did not return a session for tab ${targetId}`)
    if (this.disposed) throw new Error('the tab manager is disposed')
    const record: TabRecord = {
      id: targetId,
      sessionId,
      url: typeof info.url === 'string' ? info.url : 'about:blank',
      title: typeof info.title === 'string' ? info.title : '',
      loading: false,
      loaderId: undefined,
      ownerSessionId: undefined,
      origin,
      console: [],
      network: [],
      pendingRequests: new Map(),
      screencastRunning: false,
      frameSeq: 0,
      refs: new Map(),
    }
    this.tabs.set(targetId, record)
    this.bySession.set(sessionId, record)
    if (this.active === null) this.active = targetId
    try {
      await this.enableDomains(record)
      await this.refreshDocumentInfo(record)
      return record
    } catch (error) {
      this.tabs.delete(targetId)
      this.bySession.delete(sessionId)
      if (this.active === targetId) this.active = [...this.tabs.keys()].at(-1) ?? null
      await this.transport.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
      throw error
    }
  }

  /** Forget a target the real browser closed. */
  private removeTarget(targetId: string): void {
    const record = this.tabs.get(targetId)
    if (record === undefined) return
    this.tabs.delete(targetId)
    this.bySession.delete(record.sessionId)
    if (this.active === targetId) this.active = [...this.tabs.keys()].at(-1) ?? null
    this.onTabsChanged?.()
  }

  /**
   * Pin CSS-pixel viewport metrics so frames, boxes, and clicks share one
   * coordinate space regardless of the window the browser opened with.
   * @param record - the tab to pin.
   */
  async pinViewport(record: TabRecord): Promise<void> {
    await this.transport.send('Emulation.setDeviceMetricsOverride', {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    }, record.sessionId)
  }

  /**
   * Navigate one tab and wait for the load to settle.
   * @param tabId - target tab.
   * @param url - absolute or `data:` url.
   * @returns the tab after navigation settled.
   */
  async navigate(tabId: string, url: string): Promise<BrowserTabView> {
    const record = this.requireRecord(tabId)
    record.loading = true
    this.onTabsChanged?.()
    const settled = waitForLoad(this.transport, record.sessionId)
    await this.transport.send('Page.navigate', { url }, record.sessionId)
    await settled
    await this.refreshDocumentInfo(record)
    this.onTabsChanged?.()
    return this.view(record)
  }

  /**
   * Mark which dsh session owns a tab, so the panel can show it.
   * @param tabId - target tab.
   * @param sessionId - owning session, or undefined to clear.
   */
  bindSession(tabId: string, sessionId: string | undefined): void {
    const record = this.tabs.get(tabId)
    if (record === undefined) return
    record.ownerSessionId = sessionId
    this.onTabsChanged?.()
  }

  /**
   * Select the tab the panel follows.
   * @param tabId - target tab.
   * @returns the selected tab.
   */
  selectTab(tabId: string): BrowserTabView {
    const record = this.requireRecord(tabId)
    this.active = tabId
    this.onTabsChanged?.()
    return this.view(record)
  }

  /**
   * Close one tab and forget its ring buffers.
   * @param tabId - target tab.
   */
  async closeTab(tabId: string): Promise<void> {
    const record = this.requireRecord(tabId)
    await this.stopScreencast(tabId).catch(() => undefined)
    const result = await this.transport.send<{ success?: boolean }>('Target.closeTarget', { targetId: record.id })
    if (result.success === false) throw new Error(`the browser refused to close tab "${record.id}"`)
    this.tabs.delete(record.id)
    this.bySession.delete(record.sessionId)
    if (this.active === record.id) this.active = [...this.tabs.keys()].at(-1) ?? null
    this.onTabsChanged?.()
  }

  /**
   * Start the JPEG screencast for one tab.
   * @param tabId - target tab.
   */
  async startScreencast(tabId: string): Promise<void> {
    const record = this.requireRecord(tabId)
    if (record.screencastRunning) return
    record.screencastRunning = true
    await this.transport.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.jpegQuality,
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    }, record.sessionId)
  }

  /**
   * Stop the screencast for one tab; a tab that is already stopped is fine.
   * @param tabId - target tab.
   */
  async stopScreencast(tabId: string): Promise<void> {
    const record = this.tabs.get(tabId)
    if (record === undefined || !record.screencastRunning) return
    record.screencastRunning = false
    await this.transport.send('Page.stopScreencast', {}, record.sessionId)
  }

  /**
   * Capture one screenshot on demand.
   *
   * Without explicit parameters this is exactly the frame the screencast path
   * has always asked for: a JPEG at the configured quality, bounded to the
   * viewport. A caller that wants a clip or a scale plans it with
   * `planScreenshot` and passes those parameters, so this method stays the
   * single send point without deciding any of it.
   * @param tabId - target tab.
   * @param params - CDP parameters from `planScreenshot`; omitted keeps the plain JPEG capture.
   * @returns base64 payload without the `data:` prefix.
   */
  async captureScreenshot(tabId: string, params?: CdpScreenshotParams): Promise<string> {
    const record = this.requireRecord(tabId)
    const request: CdpScreenshotParams = params ?? {
      format: 'jpeg',
      quality: this.jpegQuality,
      captureBeyondViewport: false,
    }
    const result = await this.transport.send<{ data?: unknown }>(
      'Page.captureScreenshot',
      { ...request },
      record.sessionId,
    )
    if (typeof result.data !== 'string' || result.data === '') {
      throw new Error('the browser returned an empty screenshot')
    }
    return result.data
  }

  /**
   * Capture a frame and hand it to the panel. An action calls this because a
   * screencast only emits when the compositor sees a change: a click that
   * changes nothing visually would otherwise leave the panel showing the
   * pre-click state forever.
   * @param tabId - target tab.
   * @returns the emitted frame.
   */
  async refreshFrame(tabId: string): Promise<ScreencastFrame> {
    const data = await this.captureScreenshot(tabId)
    const record = this.requireRecord(tabId)
    record.frameSeq += 1
    const viewport = await this.frameViewport(record)
    const frame: ScreencastFrame = {
      tabId: record.id,
      seq: record.frameSeq,
      width: viewport.width,
      height: viewport.height,
      data,
    }
    this.onFrame?.(frame)
    return frame
  }

  /**
   * Report the CSS viewport a capture of this tab renders.
   *
   * A pinned tab answers from configuration, so this costs no protocol
   * round-trip. A tab this host adopted from a real browser is never pinned —
   * the page keeps whatever size its window has — so the real CSS layout
   * viewport is read from the page instead. Screenshot planning needs exactly
   * this number: clip bounds and the output budget are both expressed in the
   * viewport the pixels are measured against.
   * @param tabId - target tab.
   * @returns the CSS viewport size in pixels.
   */
  async viewportOf(tabId: string): Promise<{ width: number; height: number }> {
    const record = this.requireRecord(tabId)
    return await this.frameViewport(record)
  }

  /** Read the real CSS viewport without changing it in external-browser mode. */
  private async frameViewport(record: TabRecord): Promise<{ width: number; height: number }> {
    if (this.pinViewports) return this.viewport
    try {
      const metrics = await this.transport.send<{
        cssLayoutViewport?: { clientWidth?: unknown; clientHeight?: unknown }
        layoutViewport?: { clientWidth?: unknown; clientHeight?: unknown }
      }>('Page.getLayoutMetrics', {}, record.sessionId)
      const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport
      if (typeof viewport?.clientWidth === 'number' && typeof viewport.clientHeight === 'number'
        && viewport.clientWidth > 0 && viewport.clientHeight > 0) {
        return { width: Math.round(viewport.clientWidth), height: Math.round(viewport.clientHeight) }
      }
    } catch {
      // A page mid-navigation can reject metrics; the configured size is only a
      // display fallback and is never written back through device emulation.
    }
    return this.viewport
  }

  /**
   * Console entries captured so far, oldest first.
   * @param tabId - target tab.
   * @returns a copy; the ring keeps mutating.
   */
  consoleEntries(tabId: string): BrowserConsoleEntry[] {
    return [...this.requireRecord(tabId).console]
  }

  /**
   * Network entries captured so far, in request order.
   * @param tabId - target tab.
   * @returns a copy; the table keeps mutating.
   */
  networkEntries(tabId: string): BrowserNetworkEntry[] {
    return this.requireRecord(tabId).network.map(entry => ({ ...entry }))
  }

  /**
   * Record the ref-to-selector map produced by one snapshot, replacing the
   * previous one: a ref is only meaningful against the observation it came
   * from, and keeping two generations would let a click hit a stale node.
   * @param tabId - target tab.
   * @param refs - depth-first ref to CSS selector.
   */
  setSnapshotRefs(tabId: string, refs: Map<number, string>): void {
    this.requireRecord(tabId).refs = refs
  }

  /**
   * Resolve a snapshot ref to the selector captured with it.
   * @param tabId - target tab.
   * @param ref - depth-first index from the last snapshot.
   * @returns the CSS selector.
   */
  selectorForRef(tabId: string, ref: number): string {
    const record = this.requireRecord(tabId)
    const selector = record.refs.get(ref)
    if (selector === undefined) {
      throw new Error(`ref ${ref} is unknown; call browser_snapshot first and use a ref from that observation`)
    }
    return selector
  }

  /** Stop every screencast and detach all protocol listeners. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const record of this.tabs.values()) {
      if (!record.screencastRunning) continue
      record.screencastRunning = false
      await this.transport.send('Page.stopScreencast', {}, record.sessionId).catch(() => undefined)
    }
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    this.tabs.clear()
    this.bySession.clear()
    this.active = null
  }

  /** One view for the panel and the tools. */
  private view(record: TabRecord): BrowserTabView {
    const view: BrowserTabView = {
      id: record.id,
      url: record.url,
      title: record.title,
      loading: record.loading,
      origin: record.origin,
    }
    if (record.ownerSessionId !== undefined) view.sessionId = record.ownerSessionId
    return view
  }

  /** Look up a record or fail with an actionable message. */
  private requireRecord(tabId: string): TabRecord {
    const record = this.tabs.get(tabId)
    if (record === undefined) throw new Error(`unknown tab "${tabId}"; call browser_tabs to see the open tabs`)
    return record
  }

  /** Enable the domains every tab needs and attach nothing else. */
  private async enableDomains(record: TabRecord): Promise<void> {
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) {
      await this.transport.send(method, {}, record.sessionId)
    }
  }

  /** Drop every observation that belonged to the previous document. */
  private resetObservation(record: TabRecord): void {
    record.console.length = 0
    record.network.length = 0
    // Pending responses point at entries that no longer exist; keeping them
    // would let a late response mutate a record the panel can no longer see.
    record.pendingRequests.clear()
  }

  /** Read the current url and title into the record. */
  private async refreshDocumentInfo(record: TabRecord): Promise<void> {
    try {
      const result = await this.transport.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
        expression: 'JSON.stringify({ url: location.href, title: document.title })',
        returnByValue: true,
      }, record.sessionId)
      const raw = result.result?.value
      if (typeof raw !== 'string') return
      const parsed = JSON.parse(raw) as { url?: unknown; title?: unknown }
      if (typeof parsed.url === 'string') record.url = parsed.url
      if (typeof parsed.title === 'string') record.title = parsed.title
    } catch {
      // Reading document state is best-effort: a tab mid-navigation rejects
      // evaluate, and the next load event refreshes it anyway.
    }
  }

  /** Register every protocol event the manager consumes. */
  private subscribe(): void {
    const bySession = (sessionId: string | undefined): TabRecord | undefined => {
      return sessionId === undefined ? undefined : this.bySession.get(sessionId)
    }

    if (this.discoversTargets) {
      this.unsubscribers.push(this.transport.on('Target.targetCreated', params => {
        const info = (params as { targetInfo?: TargetInfoParams }).targetInfo
        if (info !== undefined) void this.adoptTarget(info).catch(() => undefined)
      }))
      this.unsubscribers.push(this.transport.on('Target.targetInfoChanged', params => {
        const info = (params as { targetInfo?: TargetInfoParams }).targetInfo
        if (info === undefined || typeof info.targetId !== 'string') return
        const record = this.tabs.get(info.targetId)
        if (record === undefined) {
          void this.adoptTarget(info).catch(() => undefined)
          return
        }
        if (typeof info.url === 'string') record.url = info.url
        if (typeof info.title === 'string') record.title = info.title
        this.onTabsChanged?.()
      }))
      this.unsubscribers.push(this.transport.on('Target.targetDestroyed', params => {
        const targetId = (params as { targetId?: unknown }).targetId
        if (typeof targetId === 'string') this.removeTarget(targetId)
      }))
    }

    this.unsubscribers.push(this.transport.on('Page.frameNavigated', (params, sessionId) => {
      const frame = (params as FrameNavigatedParams).frame
      if (frame === undefined) return
      // A sub-frame navigation does not change the tab's address.
      if (frame.parentId !== undefined) return
      const record = bySession(sessionId)
      if (record === undefined) return
      const url = typeof frame.url === 'string' ? frame.url : undefined
      const loaderId = typeof frame.loaderId === 'string' ? frame.loaderId : undefined
      // A replaced top-level document takes its observations with it. The
      // console ring and the request table answer "what did THIS page do", so
      // carrying the previous page's entries across a navigation reports one
      // page's noise as another page's evidence. A same-document navigation
      // (hash, query, SPA pushState) emits navigatedWithinDocument instead of
      // this event, so those buffers survive it.
      const documentReplaced = (url !== undefined && url !== record.url)
        || (loaderId !== undefined && record.loaderId !== undefined && loaderId !== record.loaderId)
      if (documentReplaced) this.resetObservation(record)
      if (url !== undefined) record.url = url
      if (loaderId !== undefined) record.loaderId = loaderId
      this.onTabsChanged?.()
    }))

    this.unsubscribers.push(this.transport.on('Page.frameStartedLoading', (_params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      record.loading = true
      this.onTabsChanged?.()
    }))

    this.unsubscribers.push(this.transport.on('Page.loadEventFired', (_params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      record.loading = false
      this.onTabsChanged?.()
      void this.refreshDocumentInfo(record).then(() => { this.onTabsChanged?.() })
    }))

    this.unsubscribers.push(this.transport.on('Runtime.consoleAPICalled', (params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      const shaped = params as ConsoleCalledParams
      const level = typeof shaped.type === 'string' ? shaped.type : 'log'
      const text = (shaped.args ?? []).map(describeConsoleArg).join(' ')
      pushBounded(record.console, { level, text, at: this.now() }, this.ringSize)
    }))

    this.unsubscribers.push(this.transport.on('Log.entryAdded', (params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      const entry = (params as LogEntryParams).entry
      if (entry === undefined || typeof entry.text !== 'string') return
      const level = typeof entry.level === 'string' ? entry.level : 'info'
      pushBounded(record.console, { level, text: entry.text, at: this.now() }, this.ringSize)
    }))

    this.unsubscribers.push(this.transport.on('Network.requestWillBeSent', (params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      const shaped = params as RequestWillBeSentParams
      const request = shaped.request
      if (request === undefined || typeof request.url !== 'string') return
      const entry: BrowserNetworkEntry = {
        url: request.url,
        method: typeof request.method === 'string' ? request.method : 'GET',
        status: 0,
        at: this.now(),
      }
      pushBounded(record.network, entry, this.ringSize)
      // Track only requests still inside the ring: an entry evicted before its
      // response arrives must not be resurrected by the update.
      if (record.network.includes(entry) && typeof shaped.requestId === 'string') {
        record.pendingRequests.set(shaped.requestId, entry)
      }
    }))

    this.unsubscribers.push(this.transport.on('Network.responseReceived', (params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      const shaped = params as ResponseReceivedParams
      if (typeof shaped.requestId !== 'string') return
      const entry = record.pendingRequests.get(shaped.requestId)
      if (entry === undefined) return
      record.pendingRequests.delete(shaped.requestId)
      const response = shaped.response
      if (response === undefined) return
      if (typeof response.status === 'number') entry.status = response.status
      if (typeof response.mimeType === 'string') entry.mimeType = response.mimeType
    }))

    this.unsubscribers.push(this.transport.on('Network.loadingFailed', (params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      const shaped = params as LoadingFailedParams
      if (typeof shaped.requestId !== 'string') return
      const entry = record.pendingRequests.get(shaped.requestId)
      if (entry === undefined) return
      record.pendingRequests.delete(shaped.requestId)
      if (typeof shaped.errorText === 'string') entry.failure = shaped.errorText
    }))

    this.unsubscribers.push(this.transport.on('Page.screencastFrame', (params, sessionId) => {
      const record = bySession(sessionId)
      if (record === undefined) return
      const shaped = params as ScreencastFrameParams
      // Acknowledge first: the browser sends no further frame until this one
      // is acknowledged, so a dropped ack freezes the panel permanently.
      if (typeof shaped.sessionId === 'number') {
        void this.transport.send('Page.screencastFrameAck', { sessionId: shaped.sessionId }, record.sessionId)
          .catch(() => undefined)
      }
      if (typeof shaped.data !== 'string' || shaped.data === '') return
      record.frameSeq += 1
      const metadata = shaped.metadata
      const width = typeof metadata?.deviceWidth === 'number' ? Math.round(metadata.deviceWidth) : this.viewport.width
      const height = typeof metadata?.deviceHeight === 'number' ? Math.round(metadata.deviceHeight) : this.viewport.height
      this.onFrame?.({ tabId: record.id, seq: record.frameSeq, width, height, data: shaped.data })
    }))
  }
}

/**
 * Resolve when the tab's next load event arrives, or after a short grace when
 * the navigation produces none (a `data:` url, an in-page fragment jump).
 * @param transport - the tab's protocol transport.
 * @param sessionId - flat session of the tab.
 * @returns once the load settled or the grace elapsed.
 */
function waitForLoad(transport: CdpTransport, sessionId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const unsubscribe = transport.on('Page.loadEventFired', (_params, eventSession) => {
      if (eventSession === sessionId) done()
    })
    // Same-document navigations never fire a load event; the deadline keeps
    // the caller from waiting on one that will never come.
    const timer = setTimeout(done, 10_000)
  })
}
