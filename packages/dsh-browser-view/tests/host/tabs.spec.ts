/**
 * Tab instrumentation tests: the console ring, the network table, and the
 * screencast handshake. All of it runs over the fake transport, so no browser
 * is involved and every assertion is about what the host recorded.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_JPEG_QUALITY, DEFAULT_VIEWPORT, EVENT_RING_SIZE } from '../../src/core/protocol.ts'
import { planScreenshot } from '../../src/core/screenshot.ts'
import { TabManager, pushBounded, type ScreencastFrame } from '../../src/core/tabs.ts'
import { FakeTransport } from '../helpers/fake-cdp.ts'

/** One manager with a freshly created tab. */
async function openManager(options: { clock?: () => number } = {}) {
  const transport = new FakeTransport()
  transport.responses.set('Target.createTarget', { targetId: 'tab-1' })
  transport.responses.set('Target.attachToTarget', { sessionId: 'session-1' })
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BASE64' })
  const frames: ScreencastFrame[] = []
  const manager = new TabManager({
    transport,
    onFrame: frame => frames.push(frame),
    now: options.clock ?? (() => 1_000),
  })
  const tab = await manager.createTab()
  return { transport, manager, frames, tab }
}

describe('pushBounded', () => {
  it('operator pushes five entries into a ring of three and the newest three survive', () => {
    // Given an empty ring capped at three
    // When five entries are pushed
    // Then only the newest three remain, in order
    const ring: number[] = []
    for (let value = 0; value < 5; value += 1) pushBounded(ring, value, 3)
    expect(ring).toEqual([2, 3, 4])
  })

  it('operator pushes past a smaller ring and the whole overflow drops at once', () => {
    // Given a ring of three capped at two
    // When one more entry is pushed
    // Then the ring keeps the newest two
    const ring = [1, 2, 3]
    pushBounded(ring, 4, 2)
    expect(ring).toEqual([3, 4])
  })
})

describe('console ring', () => {
  it('operator logs more lines than the ring holds and the newest entries survive', async () => {
    // Given a tab and more console lines than the ring holds
    // When each line is emitted
    // Then the ring keeps exactly the ring size, starting at line 50 and ending at the last line
    const { transport, manager } = await openManager()
    for (let index = 0; index < EVENT_RING_SIZE + 50; index += 1) {
      transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: `line-${index}` }] }, 'session-1')
    }
    const entries = manager.consoleEntries('tab-1')
    expect(entries).toHaveLength(EVENT_RING_SIZE)
    expect(entries[0]?.text).toBe('line-50')
    expect(entries.at(-1)?.text).toBe(`line-${EVENT_RING_SIZE + 49}`)
  })

  it('operator logs objects and functions and the entry text is stringified', async () => {
    // Given a tab
    // When console arguments include a string, an object, NaN and a function
    // Then the entry level is warning and the text carries each argument stringified
    const { transport, manager } = await openManager()
    transport.emit('Runtime.consoleAPICalled', {
      type: 'warning',
      args: [
        { value: 'hello' },
        { value: { answer: 42 } },
        { unserializableValue: 'NaN' },
        { type: 'function', description: 'function () {}' },
      ],
    }, 'session-1')
    const entry = manager.consoleEntries('tab-1')[0]
    expect(entry?.level).toBe('warning')
    expect(entry?.text).toBe('hello {"answer":42} NaN function () {}')
  })

  it('operator reads the console and a browser log entry appears beside the calls', async () => {
    // Given a tab
    // When the browser adds a log entry
    // Then the console ring holds that entry with its level, text and timestamp
    const { transport, manager } = await openManager()
    transport.emit('Log.entryAdded', { entry: { level: 'error', text: 'net::ERR_FAILED' } }, 'session-1')
    expect(manager.consoleEntries('tab-1')).toEqual([{ level: 'error', text: 'net::ERR_FAILED', at: 1_000 }])
  })

  it('operator receives a console event for another tab and this tab records nothing', async () => {
    // Given a tab
    // When a console event arrives for another tab session
    // Then this tab's console ring stays empty
    const { transport, manager } = await openManager()
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'other' }] }, 'session-2')
    expect(manager.consoleEntries('tab-1')).toEqual([])
  })
})

describe('network table', () => {
  it('operator records more requests than the ring holds and the newest keep request order', async () => {
    // Given a tab and more requests than the ring holds
    // When each request is emitted
    // Then exactly the ring size survives in request order, starting at request 20
    const { transport, manager } = await openManager()
    for (let index = 0; index < EVENT_RING_SIZE + 20; index += 1) {
      transport.emit('Network.requestWillBeSent', {
        requestId: `req-${index}`,
        request: { url: `https://example.test/${index}`, method: 'GET' },
      }, 'session-1')
    }
    const entries = manager.networkEntries('tab-1')
    expect(entries).toHaveLength(EVENT_RING_SIZE)
    expect(entries[0]?.url).toBe('https://example.test/20')
  })

  it('operator records a response for a request still in the ring and its status is filled in', async () => {
    // Given one request in the network ring
    // When its response arrives
    // Then the entry gains status 201 and the JSON mime type
    const { transport, manager } = await openManager()
    transport.emit('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://example.test/api', method: 'POST' },
    }, 'session-1')
    transport.emit('Network.responseReceived', {
      requestId: 'req-1',
      response: { status: 201, mimeType: 'application/json' },
    }, 'session-1')
    expect(manager.networkEntries('tab-1')).toEqual([{
      url: 'https://example.test/api',
      method: 'POST',
      status: 201,
      mimeType: 'application/json',
      at: 1_000,
    }])
  })

  it('operator records a response for an evicted request and it is not resurrected', async () => {
    // Given a request that already left the ring
    // When its response arrives
    // Then no entry for that url comes back
    const { transport, manager } = await openManager()
    transport.emit('Network.requestWillBeSent', {
      requestId: 'req-old',
      request: { url: 'https://example.test/old', method: 'GET' },
    }, 'session-1')
    for (let index = 0; index < EVENT_RING_SIZE; index += 1) {
      transport.emit('Network.requestWillBeSent', {
        requestId: `req-${index}`,
        request: { url: `https://example.test/${index}`, method: 'GET' },
      }, 'session-1')
    }
    transport.emit('Network.responseReceived', { requestId: 'req-old', response: { status: 200 } }, 'session-1')
    expect(manager.networkEntries('tab-1').some(entry => entry.url === 'https://example.test/old')).toBe(false)
  })

  it('operator records a failed request and the entry carries the failure text', async () => {
    // Given one request in the ring
    // When the load fails with a network error
    // Then the entry carries the failure text and status 0
    const { transport, manager } = await openManager()
    transport.emit('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://example.test/missing', method: 'GET' },
    }, 'session-1')
    transport.emit('Network.loadingFailed', { requestId: 'req-1', errorText: 'net::ERR_NAME_NOT_RESOLVED' }, 'session-1')
    expect(manager.networkEntries('tab-1')[0]?.failure).toBe('net::ERR_NAME_NOT_RESOLVED')
    expect(manager.networkEntries('tab-1')[0]?.status).toBe(0)
  })
})

describe('screencast', () => {
  it('operator streams frames and each one is acknowledged and counted', async () => {
    // Given one tab with a started screencast
    // When two frames arrive
    // Then each is acknowledged with its session id and the frame count runs one then two
    const { transport, manager, frames } = await openManager()
    await manager.startScreencast('tab-1')
    transport.emit('Page.screencastFrame', {
      data: 'FRAME-ONE',
      sessionId: 7,
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
    }, 'session-1')
    transport.emit('Page.screencastFrame', { data: 'FRAME-TWO', sessionId: 8 }, 'session-1')

    expect(transport.callsOf('Page.startScreencast')).toHaveLength(1)
    const acks = transport.callsOf('Page.screencastFrameAck').map(call => call.params.sessionId)
    expect(acks).toEqual([7, 8])
    expect(frames.map(frame => frame.seq)).toEqual([1, 2])
    expect(frames[0]).toEqual({
      tabId: 'tab-1',
      seq: 1,
      width: 1280,
      height: 800,
      data: 'FRAME-ONE',
    })
  })

  it('operator receives an empty frame and it is acknowledged but not painted', async () => {
    // Given one tab with a started screencast
    // When a frame carries no data
    // Then no frame is delivered but the ack is still sent
    const { transport, manager, frames } = await openManager()
    await manager.startScreencast('tab-1')
    transport.emit('Page.screencastFrame', { data: '', sessionId: 3 }, 'session-1')
    expect(frames).toEqual([])
    expect(transport.callsOf('Page.screencastFrameAck')).toHaveLength(1)
  })

  it('operator asks for a frame while the page is idle and one is emitted on demand', async () => {
    // Given one tab with no screencast
    // When a frame is requested on demand
    // Then the page returns the JPEG, it is numbered one and the callback sees it
    const { manager, frames } = await openManager()
    const frame = await manager.refreshFrame('tab-1')
    expect(frame.data).toBe('JPEG-BASE64')
    expect(frame.seq).toBe(1)
    expect(frames).toHaveLength(1)
  })

  it('operator starts and stops the screencast twice and each gesture reaches the page once', async () => {
    // Given one tab
    // When the screencast is started twice and stopped twice
    // Then the page sees exactly one start and one stop
    const { transport, manager } = await openManager()
    await manager.startScreencast('tab-1')
    await manager.startScreencast('tab-1')
    await manager.stopScreencast('tab-1')
    await manager.stopScreencast('tab-1')
    expect(transport.callsOf('Page.startScreencast')).toHaveLength(1)
    expect(transport.callsOf('Page.stopScreencast')).toHaveLength(1)
  })
})

describe('tab bookkeeping', () => {
  it('operator creates a tab and the four domains are enabled while the viewport is pinned', async () => {
    // Given a freshly created tab
    // When creation finishes
    // Then each of the four domains and the viewport override is enabled once, and the tab is listed and active
    const { transport, manager } = await openManager()
    for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'Emulation.setDeviceMetricsOverride']) {
      expect(transport.callsOf(method), method).toHaveLength(1)
    }
    expect(manager.list()[0]?.id).toBe('tab-1')
    expect(manager.activeTabId).toBe('tab-1')
  })

  it('operator captures a screenshot and receives bare base64 without the data prefix', async () => {
    // Given a tab
    // When a screenshot is captured
    // Then the resolved value is the base64 payload with no data prefix
    const { manager } = await openManager()
    await expect(manager.captureScreenshot('tab-1')).resolves.toBe('JPEG-BASE64')
  })

  it('operator captures a screenshot without parameters and the page receives the same three fields as before', async () => {
    // Given a tab and a manager on the default JPEG quality
    // When a screenshot is captured with no parameters
    // Then the page is asked for exactly the JPEG payload this call has always sent
    const { transport, manager } = await openManager()
    await manager.captureScreenshot('tab-1')
    expect(transport.lastCall('Page.captureScreenshot')?.params).toEqual({
      format: 'jpeg',
      quality: DEFAULT_JPEG_QUALITY,
      captureBeyondViewport: false,
    })
  })

  it('operator captures a planned clip and the page receives exactly the planned parameters', async () => {
    // Given a planned PNG clip of 300x200 at scale 2 on the default viewport
    // When that plan is captured
    // Then the page receives the plan parameters verbatim and the plan reports the doubled pixel size
    const { transport, manager } = await openManager()
    const viewport = { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height }
    const plan = planScreenshot(viewport, {
      format: 'png',
      clip: { x: 10, y: 20, width: 300, height: 200 },
      scale: 2,
    }, DEFAULT_JPEG_QUALITY)
    await manager.captureScreenshot('tab-1', plan.params)
    expect(transport.lastCall('Page.captureScreenshot')?.params).toEqual({
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 10, y: 20, width: 300, height: 200, scale: 2 },
    })
    expect(plan.width).toBe(600)
    expect(plan.height).toBe(400)
  })

  it('operator uses a ref no snapshot produced and the error asks for browser_snapshot first', async () => {
    // Given a tab whose snapshot produced only ref 2
    // When ref 2 is resolved before a snapshot, then after one
    // Then the first call throws asking for a snapshot and the second returns its selector
    const { manager } = await openManager()
    expect(() => manager.selectorForRef('tab-1', 2)).toThrow(/call browser_snapshot first/)
    manager.setSnapshotRefs('tab-1', new Map([[2, 'div > p']]))
    expect(manager.selectorForRef('tab-1', 2)).toBe('div > p')
  })

  it('operator reads an unknown tab and the error asks for browser_tabs', async () => {
    // Given a manager with one tab
    // When console entries are read for an unknown tab
    // Then it throws asking for browser_tabs
    const { manager } = await openManager()
    expect(() => manager.consoleEntries('nope')).toThrow(/call browser_tabs/)
  })

  it('operator closes the newest tab and the active tab falls back to the one still open', async () => {
    // Given two tabs where the second one is active
    // When the second tab closes
    // Then the first tab becomes active and only one tab is listed
    const transport = new FakeTransport()
    let counter = 0
    transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${++counter}` }))
    transport.responses.set('Target.attachToTarget', () => ({ sessionId: `session-${counter}` }))
    const manager = new TabManager({ transport })
    await manager.createTab()
    const second = await manager.createTab()
    expect(manager.activeTabId).toBe(second.id)
    await manager.closeTab(second.id)
    expect(manager.activeTabId).toBe('tab-1')
    expect(manager.list()).toHaveLength(1)
  })
})
describe('viewport reporting', () => {
  it('operator reads the viewport of a pinned tab and the configured size comes back with no metrics call', async () => {
    // Given a tab this host pinned to the default viewport
    // When its viewport is read
    // Then the configured size comes back and the page was never asked
    const { transport, manager } = await openManager()
    await expect(manager.viewportOf('tab-1')).resolves.toEqual({
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height,
    })
    expect(transport.callsOf('Page.getLayoutMetrics')).toHaveLength(0)
  })

  it('operator reads the viewport of a tab this host does not pin and the real page size comes back', async () => {
    // Given an adopted tab whose page really renders 1600x1000
    // When its viewport is read
    // Then the metrics from the page are reported instead of the configured size
    const transport = new FakeTransport()
    transport.responses.set('Target.createTarget', { targetId: 'tab-1' })
    transport.responses.set('Target.attachToTarget', { sessionId: 'session-1' })
    transport.responses.set('Page.getLayoutMetrics', {
      cssLayoutViewport: { clientWidth: 1600, clientHeight: 1000 },
    })
    const manager = new TabManager({ transport, pinViewport: false })
    await manager.createTab()

    await expect(manager.viewportOf('tab-1')).resolves.toEqual({ width: 1600, height: 1000 })
  })

  it('operator reads the viewport of an unknown tab and the error asks for browser_tabs', async () => {
    // Given a manager with one tab
    // When the viewport of a tab that does not exist is read
    // Then it rejects asking for browser_tabs
    const { manager } = await openManager()
    await expect(manager.viewportOf('nope')).rejects.toThrow(/call browser_tabs/)
  })
})

describe('document replacement', () => {
  it('operator navigates to a second page and the console and network tables describe only that page', async () => {
    // Given one tab whose first page logged a line and issued a request
    // When the top-level document is replaced by another page
    // Then the console ring and the request table are empty and the tab reports the new address
    const { transport, manager } = await openManager()
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'page-ready' }] }, 'session-1')
    transport.emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://a.test/', method: 'GET' },
    }, 'session-1')
    expect(manager.consoleEntries('tab-1')).toHaveLength(1)
    expect(manager.networkEntries('tab-1')).toHaveLength(1)

    transport.emit('Page.frameNavigated', { frame: { url: 'https://b.test/', loaderId: 'loader-2' } }, 'session-1')

    expect(manager.consoleEntries('tab-1')).toEqual([])
    expect(manager.networkEntries('tab-1')).toEqual([])
    expect(manager.list()[0]?.url).toBe('https://b.test/')
  })

  it('operator reloads the same address and the previous document entries are gone', async () => {
    // Given a document that logged a line at one address
    // When that same address loads again as a new document
    // Then the line from the previous document is no longer in the ring
    const { transport, manager } = await openManager()
    transport.emit('Page.frameNavigated', { frame: { url: 'https://a.test/', loaderId: 'loader-1' } }, 'session-1')
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'first-document' }] }, 'session-1')
    expect(manager.consoleEntries('tab-1')).toHaveLength(1)

    transport.emit('Page.frameNavigated', { frame: { url: 'https://a.test/', loaderId: 'loader-2' } }, 'session-1')

    expect(manager.consoleEntries('tab-1')).toEqual([])
  })

  it('operator changes only the fragment and the console keeps the page entries', async () => {
    // Given a tab with one console line from the current document
    // When the page navigates within the same document
    // Then the line survives, because the document that produced it is still loaded
    const { transport, manager } = await openManager()
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'kept' }] }, 'session-1')

    transport.emit('Page.navigatedWithinDocument', { url: 'https://a.test/#two' }, 'session-1')

    expect(manager.consoleEntries('tab-1').map(entry => entry.text)).toEqual(['kept'])
  })

  it('operator reads the console of a second page and only the second page line is there', async () => {
    // Given a first page that logged two lines
    // When a second page loads and logs one line
    // Then the console reports exactly that one line
    const { transport, manager } = await openManager()
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'page-ready' }] }, 'session-1')
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'clicked-once' }] }, 'session-1')

    transport.emit('Page.frameNavigated', { frame: { url: 'https://b.test/', loaderId: 'loader-2' } }, 'session-1')
    transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: 'enter-pressed' }] }, 'session-1')

    expect(manager.consoleEntries('tab-1').map(entry => entry.text)).toEqual(['enter-pressed'])
  })
})
