/**
 * Service tests: laziness, per-session tab binding, the broadcast fan-out, the
 * panel commands, and the shutdown order. The browser itself is the fake
 * session from tests/helpers/fake-browser.ts.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_JPEG_QUALITY, type BrowserViewEvent } from '../../src/core/protocol.ts'
import type { BrowserViewSink } from '../../src/host/service.ts'
import { createFakeBrowser } from '../helpers/fake-browser.ts'

/** A sink that records every event it is handed. */
function recordingSink(): { sink: BrowserViewSink; events: BrowserViewEvent[]; closed: () => boolean } {
  const events: BrowserViewEvent[] = []
  let closed = false
  return {
    events,
    closed: () => closed,
    sink: {
      send: (event: BrowserViewEvent) => { events.push(event) },
      close: () => { closed = true },
    },
  }
}

describe('lazy start', () => {
  it('operator opens the panel before any tool runs and no browser is started', async () => {
    // Given a fake browser that has never been asked for anything
    // When the panel lists tabs
    // Then the list is empty and no browser process was opened
    const browser = createFakeBrowser()
    await expect(browser.service.listTabs()).resolves.toEqual({ tabs: [], activeTabId: null })
    expect(browser.opens()).toBe(0)
  })

  it('operator runs a tool when Chrome cannot start and both the panel and the tool report it', async () => {
    // Given a fake browser whose launch fails
    // When a tool call runs
    // Then the tool rejects, the panel receives a browser-launch-failed event and the state carries the message
    const browser = createFakeBrowser({ failLaunch: () => new Error('No Chrome binary found.') })
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    await expect(browser.service.console(undefined)).rejects.toThrow(/No Chrome binary found/)
    expect(events.at(-1)).toEqual({ v: 1, kind: 'error', code: 'browser-launch-failed', message: 'No Chrome binary found.' })
    expect(browser.service.state().message).toBe('No Chrome binary found.')
  })
})

describe('session binding', () => {
  it('operator asks for a tab twice in one session and each session keeps its own tab', async () => {
    // Given two sessions asking for tabs
    // When the first session asks twice and the second once
    // Then the repeat returns the same tab, the second session gets a different one and the list reports two tabs with their sessions
    const browser = createFakeBrowser()
    const first = await browser.service.ensureTab('session-a')
    const again = await browser.service.ensureTab('session-a')
    const other = await browser.service.ensureTab('session-b')
    expect(again.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
    expect((await browser.service.listTabs()).tabs).toHaveLength(2)
    expect((await browser.service.listTabs()).tabs[0]?.sessionId).toBe('session-a')
  })

  it('operator issues two concurrent first calls and both land on one tab', async () => {
    // Given two concurrent first calls for one session
    // When both resolve
    // Then they share one tab and only one create-target call reached the browser
    const browser = createFakeBrowser()
    const [first, second] = await Promise.all([
      browser.service.ensureTab('session-a'),
      browser.service.ensureTab('session-a'),
    ])
    expect(second.id).toBe(first.id)
    expect(browser.transport.callsOf('Target.createTarget')).toHaveLength(1)
  })

  it('operator names another tab and the caller is rebound to it', async () => {
    // Given two sessions with one tab each
    // When the first session names the second session's tab
    // Then that tab is returned, later calls resolve to it and the two tabs stay distinct
    const browser = createFakeBrowser()
    const a = await browser.service.ensureTab('session-a')
    const b = await browser.service.ensureTab('session-b')
    const picked = await browser.service.tabFor('session-a', b.id)
    expect(picked.id).toBe(b.id)
    expect((await browser.service.tabFor('session-a')).id).toBe(b.id)
    expect(a.id).not.toBe(b.id)
  })

  it('operator names a tab that does not exist and the error asks for browser_tabs', async () => {
    // Given a session with no tabs
    // When it names a tab that does not exist
    // Then the call rejects and the message points at browser_tabs
    const browser = createFakeBrowser()
    await expect(browser.service.tabFor('session-a', 'tab-nope')).rejects.toThrow(/call browser_tabs/)
  })
})

describe('panel commands', () => {
  it('operator attaches the panel and receives a hello carrying the current state', async () => {
    // Given a fake browser and one panel
    // When the panel attaches
    // Then the first event is a hello with no tabs, no active tab and nothing running, and no browser was opened
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    expect(events[0]).toEqual({
      v: 1,
      kind: 'hello',
      state: { tabs: [], activeTabId: null, running: false, mode: 'isolated' },
    })
    expect(browser.opens()).toBe(0)
  })

  it('operator selects a real tab from the panel and the active tab follows', async () => {
    // Given two tabs and one attached panel
    // When the panel selects the first tab
    // Then the active tab is the first one and the last state event lists both tabs
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    const first = await browser.service.ensureTab('session-a')
    const second = await browser.service.ensureTab('session-b')
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: first.id })
    expect(browser.service.state().activeTabId).toBe(first.id)
    const states = events.filter(event => event.kind === 'state')
    expect(states.at(-1)?.state.tabs).toHaveLength(2)
    expect(second.id).not.toBe(first.id)
  })

  it('operator requests a frame and every attached panel receives it', async () => {
    // Given two attached panels and one tab
    // When one panel requests a frame
    // Then both panels receive exactly one frame carrying the tab id and the JPEG bytes
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.service.attach(bob.sink)
    await browser.service.handleCommand(alice.sink, { v: 1, kind: 'request-frame' })
    const frames = alice.events.filter(event => event.kind === 'frame')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ tabId: 'tab-1', data: 'JPEG-BYTES' })
    expect(bob.events.filter(event => event.kind === 'frame')).toHaveLength(1)
  })

  it('operator closes a tab and the next request opens a fresh one', async () => {
    // Given a session holding one tab
    // When the panel closes that tab
    // Then the tab list is empty and the next request opens a different tab
    const browser = createFakeBrowser()
    const { sink } = recordingSink()
    const tab = await browser.service.ensureTab('session-a')
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'close-tab', tabId: tab.id })
    expect((await browser.service.listTabs()).tabs).toHaveLength(0)
    const reopened = await browser.service.ensureTab('session-a')
    expect(reopened.id).not.toBe(tab.id)
  })
})

describe('panel attach follows, never creates', () => {
  it('operator attaches a panel with no tab of its session and no tab is created', async () => {
    // Given one tab created by an agent session and a panel from another session
    // When that panel attaches
    // Then the tab count is unchanged and the panels still watch the agent tab
    const browser = createFakeBrowser()
    const agentTab = await browser.service.ensureTab('session-agent')
    const { sink } = recordingSink()
    browser.service.attach(sink)

    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })

    const state = browser.service.state()
    expect(state.tabs.map(tab => tab.id)).toEqual([agentTab.id])
    expect(state.activeTabId).toBe(agentTab.id)
    expect(browser.transport.callsOf('Target.createTarget')).toHaveLength(1)
  })

  it('operator attaches a panel whose session already owns a tab and that tab is shown', async () => {
    // Given a panel session with its own tab and a later agent tab that is watched
    // When the panel attaches
    // Then the watched tab becomes the panel session's own tab
    const browser = createFakeBrowser()
    const panelTab = await browser.service.ensureTab('session-panel')
    const agentTab = await browser.service.ensureTab('session-agent')
    expect(browser.service.state().activeTabId).toBe(agentTab.id)
    const { sink } = recordingSink()

    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })

    expect(browser.service.state().activeTabId).toBe(panelTab.id)
    expect(panelTab.id).not.toBe(agentTab.id)
  })

  it('operator attaches a following panel and the agent navigating in another session moves the view', async () => {
    // Given a panel following the page the agent drives
    // When the agent navigates in a different session
    // Then the panels watch that session's tab without anyone selecting it
    const browser = createFakeBrowser()
    await browser.service.ensureTab('session-a')
    const second = await browser.service.ensureTab('session-b')
    const { sink } = recordingSink()
    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })
    expect(browser.service.state().activeTabId).toBe(second.id)

    await browser.service.navigate('session-a', 'https://a.test/')

    expect(browser.service.state().activeTabId).toBe('tab-1')
    expect((await browser.service.listTabs()).tabs).toHaveLength(2)
  })

  it('operator picks a tab in the panel and a later agent navigation elsewhere does not steal the selection', async () => {
    // Given a panel whose operator chose the first tab
    // When an agent opens and navigates a new tab in another session
    // Then the panels keep showing the chosen tab
    const browser = createFakeBrowser()
    const chosen = await browser.service.ensureTab('session-agent')
    const { sink } = recordingSink()
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: chosen.id })

    await browser.service.navigate('session-other', 'https://other.test/', undefined, { newTab: true })

    const state = browser.service.state()
    expect(state.activeTabId).toBe(chosen.id)
    expect(state.tabs.map(tab => tab.id)).toEqual([chosen.id, 'tab-2'])
  })

  it('operator attaches a panel before any tab exists and the browser is not started', async () => {
    // Given no browser and no tab
    // When a panel attaches and sends its attach command
    // Then nothing is created and no browser process is opened
    const browser = createFakeBrowser()
    const { sink } = recordingSink()
    browser.service.attach(sink)

    await browser.service.handleCommand(sink, { v: 1, kind: 'attach', sessionId: 'session-panel' })

    expect(browser.service.state()).toEqual({ tabs: [], activeTabId: null, running: false, mode: 'isolated' })
    expect(browser.opens()).toBe(0)
  })
})

describe('agent tab priority', () => {
  it('operator pins the panel to one page and an agent navigation without a tab id still drives the agent own last page', async () => {
    // Given an agent session with its own page and a panel pinned to a different page
    // When the agent navigates without naming a tab
    // Then only the agent page is navigated, the pinned page keeps its url and the panel keeps its selection
    const browser = createFakeBrowser()
    const agentTab = await browser.service.ensureTab('session-agent')
    const watched = await browser.service.ensureTab('session-watcher')
    const { sink } = recordingSink()
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: watched.id })

    const navigated = await browser.service.navigate('session-agent', 'https://agent.test/')

    // Tab creation navigates to about:blank, so the pages that really moved are
    // the non-blank navigations, reported as their tab's CDP session.
    const moved = browser.transport.callsOf('Page.navigate')
      .filter(call => call.params.url !== 'about:blank')
      .map(call => `${call.sessionId}:${String(call.params.url)}`)
    expect(moved).toEqual(['session-1:https://agent.test/'])
    expect(navigated.tab.id).toBe(agentTab.id)
    expect(watched.id).not.toBe(agentTab.id)
    expect(browser.service.state().activeTabId).toBe(watched.id)
  })

  it('operator watches a page one session owns and a second session opens its own tab instead of driving it', async () => {
    // Given a page owned by one session and watched through the panel
    // When a different session navigates without naming a tab
    // Then the watched page is untouched and the newcomer ends up on a tab of its own
    const browser = createFakeBrowser()
    const owned = await browser.service.ensureTab('session-owner')
    const { sink } = recordingSink()
    browser.service.attach(sink)
    await browser.service.handleCommand(sink, { v: 1, kind: 'select-tab', tabId: owned.id })

    const navigated = await browser.service.navigate('session-newcomer', 'https://new.test/')

    const tabs = (await browser.service.listTabs()).tabs
    const moved = browser.transport.callsOf('Page.navigate')
      .filter(call => call.params.url !== 'about:blank')
      .map(call => `${call.sessionId}:${String(call.params.url)}`)
    // The newcomer drives a session of its own: the watched page is never the
    // tab that received this navigation.
    expect(moved).toEqual(['session-2:https://new.test/'])
    expect(navigated.tab.id).not.toBe(owned.id)
    expect(tabs.map(tab => tab.id)).toEqual([owned.id, navigated.tab.id])
  })
})

describe('additional tabs', () => {
  it('operator navigates twice and only the second call asks for a new tab so both pages stay open', async () => {
    // Given a session whose first navigation opened one page in its tab
    // When the same session navigates to a second page with newTab
    // Then two tabs are listed, the new one is active and the session is bound to it
    const browser = createFakeBrowser()
    const first = await browser.service.navigate('session-a', 'https://a.test/')
    const second = await browser.service.navigate('session-a', 'https://b.test/', undefined, { newTab: true })
    const state = await browser.service.listTabs()
    expect(state.tabs.map(tab => tab.id)).toEqual([first.tab.id, second.tab.id])
    expect(state.activeTabId).toBe(second.tab.id)
    expect((await browser.service.tabFor('session-a')).id).toBe(second.tab.id)
  })

  it('operator navigates a third time without newTab and the current tab is reused', async () => {
    // Given a session that already opened a second tab on purpose
    // When it navigates again without asking for a new tab
    // Then no third tab appears and the navigation happens in the current one
    const browser = createFakeBrowser()
    await browser.service.navigate('session-a', 'https://a.test/')
    const second = await browser.service.navigate('session-a', 'https://b.test/', undefined, { newTab: true })

    const third = await browser.service.navigate('session-a', 'https://c.test/')

    expect(third.tab.id).toBe(second.tab.id)
    expect((await browser.service.listTabs()).tabs).toHaveLength(2)
  })

  it('operator asks for a new tab and each request really opens one', async () => {
    // Given a session with one tab
    // When two more navigations each ask for a new tab
    // Then three tabs are listed and each has its own id
    const browser = createFakeBrowser()
    await browser.service.ensureTab('session-a')

    await browser.service.navigate('session-a', 'https://a.test/', undefined, { newTab: true })
    await browser.service.navigate('session-a', 'https://b.test/', undefined, { newTab: true })

    const tabs = (await browser.service.listTabs()).tabs
    expect(tabs.map(tab => tab.id)).toEqual(['tab-1', 'tab-2', 'tab-3'])
  })
})

describe('action traces', () => {
  it('operator clicks a ref and one trace is broadcast while the outcome carries its summary', async () => {
    // Given an attached panel and one snapshot
    // When a ref from that snapshot is clicked
    // Then the outcome summary comes from the host and exactly one action trace carries it
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    // A ref only exists after an observation; take one and click its first node.
    await browser.service.snapshot('session-a')
    const outcome = await browser.service.click('session-a', { ref: 0 })
    expect(outcome.summary).toContain('Clicked')
    const traces = events.filter(event => event.kind === 'action')
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      trace: { tool: 'click', summary: outcome.summary, at: 500 },
    })
  })

  it('operator clicks and the panel receives a fresh frame so it cannot show the old state', async () => {
    // Given an attached panel
    // When a click by selector resolves
    // Then at least one frame reaches the panel after the click
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    browser.service.attach(sink)
    await browser.service.click('session-a', { selector: 'button' })
    expect(events.filter(event => event.kind === 'frame').length).toBeGreaterThan(0)
  })

  it('operator clicks with no target and the page is never touched', async () => {
    // Given a session with no target named
    // When the click runs
    // Then it rejects naming the accepted targets and no mouse event reaches the page
    const browser = createFakeBrowser()
    await expect(browser.service.click('session-a', {})).rejects.toThrow(/click needs one of/)
    expect(browser.transport.callsOf('Input.dispatchMouseEvent')).toHaveLength(0)
  })

  it('operator clicks a ref no snapshot produced and the error asks for browser_snapshot', async () => {
    // Given a session whose snapshot never produced ref 9
    // When the click names that ref
    // Then it rejects and asks for browser_snapshot first
    const browser = createFakeBrowser()
    await browser.service.ensureTab('session-a')
    await expect(browser.service.click('session-a', { ref: 9 })).rejects.toThrow(/call browser_snapshot first/)
  })

  it('operator navigates, snapshots and screenshots through one bound tab', async () => {
    // Given one bound tab
    // When navigate, snapshot and screenshot run in sequence
    // Then the summary names the url, the snapshot numbers three nodes with Go named, and the screenshot returns that tab's JPEG
    const browser = createFakeBrowser()
    const navigated = await browser.service.navigate('session-a', 'https://a.test/')
    expect(navigated.outcome.summary).toContain('https://a.test/')
    const snapshot = await browser.service.snapshot('session-a')
    expect(snapshot.nodes.map(node => node.ref)).toEqual([0, 1, 2])
    expect(snapshot.nodes[2]?.name).toBe('Go')
    const shot = await browser.service.screenshot('session-a')
    expect(shot.data).toBe('JPEG-BYTES')
    expect(shot.tabId).toBe(navigated.tab.id)
  })

  it('operator reads console and network entries and the limit keeps the newest entries', async () => {
    // Given three console lines and one request on the tab session
    // When console is read with a limit of two and network with a limit of ten
    // Then only the newest two console lines survive, the request keeps its url and the tab id is reported
    const browser = createFakeBrowser()
    const tab = await browser.service.ensureTab('session-a')
    for (const text of ['one', 'two', 'three']) {
      browser.transport.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ value: text }] }, 'session-1')
    }
    browser.transport.emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://a.test/x', method: 'GET' },
    }, 'session-1')
    const console_ = await browser.service.console('session-a', 2)
    expect(console_.entries.map(entry => entry.text)).toEqual(['two', 'three'])
    const network = await browser.service.network('session-a', 10)
    expect(network.entries[0]?.url).toBe('https://a.test/x')
    expect(console_.tabId).toBe(tab.id)
  })
})

describe('screenshot requests', () => {
  it('operator screenshots a clip at scale 2 and the plan decides the payload and the reported size', async () => {
    // Given one bound tab on the default viewport and JPEG quality
    // When a JPEG clip of 100x50 at scale 2 is captured
    // Then the page receives the planned parameters and the result reports the JPEG media type with the doubled pixel size
    const browser = createFakeBrowser()
    const tab = await browser.service.ensureTab('session-a')

    const shot = await browser.service.screenshot('session-a', tab.id, {
      format: 'jpeg',
      clip: { x: 0, y: 0, width: 100, height: 50 },
      scale: 2,
    })

    expect(browser.transport.lastCall('Page.captureScreenshot')?.params).toEqual({
      format: 'jpeg',
      quality: DEFAULT_JPEG_QUALITY,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: 100, height: 50, scale: 2 },
    })
    expect(shot.mediaType).toBe('image/jpeg')
    expect(shot.width).toBe(200)
    expect(shot.height).toBe(100)
    expect(shot.tabId).toBe(tab.id)
    expect(shot.data).toBe('JPEG-BYTES')
  })

  it('operator screenshots a clip at the pinned viewport edge and the page is never asked for its metrics', async () => {
    // Given a tab pinned to the default 1280x800 viewport
    // When a clip that reaches the bottom-right corner of that viewport is captured
    // Then the clip is accepted against the pinned size and no layout-metrics call was made
    const browser = createFakeBrowser()
    const tab = await browser.service.ensureTab('session-a')

    const shot = await browser.service.screenshot('session-a', tab.id, {
      clip: { x: 1180, y: 700, width: 100, height: 100 },
      scale: 1,
    })

    expect(browser.transport.callsOf('Page.getLayoutMetrics')).toHaveLength(0)
    expect(shot.width).toBe(100)
    expect(shot.height).toBe(100)
  })

  it('operator screenshots a clip past the configured viewport on a real 1600x1000 page and it is accepted', async () => {
    // Given a tab adopted from a browser whose page really renders 1600x1000
    // When a clip at x=1500, outside the configured 1280x800, is captured
    // Then the plan uses the page size and the reported pixels match the clip
    const browser = createFakeBrowser({
      pinViewport: false,
      layoutViewport: { width: 1600, height: 1000 },
    })
    const tab = await browser.service.ensureTab('session-a')

    const shot = await browser.service.screenshot('session-a', tab.id, {
      clip: { x: 1500, y: 900, width: 100, height: 100 },
      scale: 1,
    })

    expect(browser.transport.lastCall('Page.captureScreenshot')?.params).toEqual({
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 1500, y: 900, width: 100, height: 100, scale: 1 },
    })
    expect(shot.width).toBe(100)
    expect(shot.height).toBe(100)
  })

  it('operator asks for a clip past the real page and the error quotes the page viewport', async () => {
    // Given the same 1600x1000 page
    // When a clip that ends at 1650 is captured
    // Then it is refused and the message names the 1600x1000 viewport, not the configured one
    const browser = createFakeBrowser({
      pinViewport: false,
      layoutViewport: { width: 1600, height: 1000 },
    })
    const tab = await browser.service.ensureTab('session-a')

    await expect(browser.service.screenshot('session-a', tab.id, {
      clip: { x: 1550, y: 0, width: 100, height: 100 },
    })).rejects.toThrow(/screenshot clip must stay inside the 1600x1000 viewport/)
  })
})

describe('dispose', () => {
  it('operator disposes the service and every panel socket closes with one session dispose', async () => {
    // Given two attached panels and one open tab
    // When the service is disposed twice
    // Then both panels are closed and the browser session reports disposed
    const browser = createFakeBrowser()
    const alice = recordingSink()
    const bob = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(alice.sink)
    browser.service.attach(bob.sink)

    await browser.service.dispose()

    expect(alice.closed()).toBe(true)
    expect(bob.closed()).toBe(true)
    expect(browser.disposed()).toBe(true)
    await browser.service.dispose()
    expect(browser.disposed()).toBe(true)
  })

  it('operator broadcasts after dispose and no panel receives it', async () => {
    // Given one attached panel and a disposed service
    // When an error is broadcast
    // Then the panel receives nothing new
    const browser = createFakeBrowser()
    const { sink, events } = recordingSink()
    await browser.service.ensureTab('session-a')
    browser.service.attach(sink)
    const seen = events.length
    await browser.service.dispose()
    browser.service.broadcast({ v: 1, kind: 'error', code: 'ignored', message: 'ignored' })
    expect(events).toHaveLength(seen)
  })
})