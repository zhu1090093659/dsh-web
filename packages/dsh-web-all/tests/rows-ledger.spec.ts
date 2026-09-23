/**
 * Active-row ledger and row-state route contract (src/rows.ts + the shell's
 * /api/dsh-web-all/rows registration): the browser half gates folded client
 * children on this answer (#1372), so the ledger must track shell applies and
 * disposals exactly, and the route must stay up even when every family row is
 * disabled (the config-less self row holds it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, _resetDegradedRouteForTest } from '../src/shell.ts'
import { _resetActiveRowsForTest, listActiveRows, recordActiveRow, removeActiveRow } from '../src/rows.ts'

function fakeRes() {
  const res = {
    status: undefined as number | undefined,
    headers: undefined as Record<string, string> | undefined,
    body: undefined as string | undefined,
    writeHead(status: number, headers: Record<string, string>) {
      res.status = status
      res.headers = headers
    },
    end(body: string) {
      res.body = body
    },
  }
  return res
}

function fakeReq(remote = '203.0.113.10') {
  return { socket: { remoteAddress: remote } }
}

function mockHost() {
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void>>()
  let unregisters = 0
  const webServer = {
    register: vi.fn((route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
      if (routes.has(route.path)) throw new Error('webserver: duplicate exact route ' + route.path)
      routes.set(route.path, route.handler)
      return () => { unregisters += 1; routes.delete(route.path) }
    }),
  }
  const effects: Array<() => void> = []
  const pendingInject: Array<(scoped: unknown) => void> = []
  const createCtx = () => ({
    // The shell applies before the web app provides webServer; route
    // registration rides this nested inject fiber, fired by provideWebServer().
    inject: (_deps: readonly string[], cb: (scoped: unknown) => void) => { pendingInject.push(cb) },
    effect: (fn: () => () => void) => { effects.push(fn()) },
    plugin: vi.fn(),
  })
  const provideWebServer = () => {
    const scoped = { webServer, effect: (fn: () => () => void) => { effects.push(fn()) } }
    for (const cb of pendingInject.splice(0)) cb(scoped)
  }
  return { routes, createCtx, effects, webServer, provideWebServer, unregisterCount: () => unregisters }
}

function resetAll(): void {
  _resetDegradedRouteForTest()
  _resetActiveRowsForTest()
}

describe('active-row ledger', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('records and removes rows in insertion order', () => {
    recordActiveRow('@linxin666/dsh-pet')
    recordActiveRow('@linxin666/dsh-usage')
    expect(listActiveRows()).toEqual(['@linxin666/dsh-pet', '@linxin666/dsh-usage'])
    removeActiveRow('@linxin666/dsh-pet')
    expect(listActiveRows()).toEqual(['@linxin666/dsh-usage'])
  })
})

describe('shell row-state surface', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('a family row apply records the real plugin and registers both routes', async () => {
    const host = mockHost()
    await apply(host.createCtx() as never, { plugin: 'node:events' })
    host.provideWebServer()
    expect(listActiveRows()).toEqual(['node:events'])
    expect(host.routes.has('/api/dsh-web-all/degraded')).toBe(true)
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(true)
    expect(host.webServer.register).toHaveBeenCalledTimes(2)
  })

  it('the config-less self row holds the routes without recording a row', async () => {
    const host = mockHost()
    await apply(host.createCtx() as never, undefined)
    host.provideWebServer()
    expect(listActiveRows()).toEqual([])
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(true)
  })

  it('entry disposal removes the row; the last disposal lifts both routes', async () => {
    const host = mockHost()
    await apply(host.createCtx() as never, { plugin: 'node:events' })
    await apply(host.createCtx() as never, { plugin: 'node:path' })
    host.provideWebServer()
    expect(listActiveRows()).toEqual(['node:events', 'node:path'])
    // Each entry contributed two effects: ledger removal at apply time
    // (indexes 0-1), route hold when webServer arrived (indexes 2-3).
    expect(host.effects).toHaveLength(4)
    host.effects[0]?.() // ledger removal of the first entry
    expect(listActiveRows()).toEqual(['node:path'])
    host.effects[2]?.() // route hold release of the first entry
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(true)
    host.effects[1]?.()
    host.effects[3]?.()
    expect(listActiveRows()).toEqual([])
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(false)
    expect(host.unregisterCount()).toBe(2)
  })

  it('registers the routes when webServer appears only AFTER the shell applied', async () => {
    // Real boot ordering: the shell runs with inject=[] before the web app
    // provides webServer; a synchronous read at apply time misses it, so the
    // routes must register late via the inject fiber — never stay absent.
    const host = mockHost()
    await apply(host.createCtx() as never, { plugin: 'node:events' })
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(false)
    expect(host.webServer.register).not.toHaveBeenCalled()
    // The ledger does not wait for webServer: the row counts as active now.
    expect(listActiveRows()).toEqual(['node:events'])
    host.provideWebServer()
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(true)
    expect(host.routes.has('/api/dsh-web-all/degraded')).toBe(true)
  })

  it('a retired plugin row holds the routes but records nothing', async () => {
    const host = mockHost()
    await apply(host.createCtx() as never, { plugin: '@linxin666/dsh-perf' })
    host.provideWebServer()
    expect(listActiveRows()).toEqual([])
    expect(host.routes.has('/api/dsh-web-all/rows')).toBe(true)
  })

  it('the rows route answers the active set without a loopback fence', async () => {
    const host = mockHost()
    await apply(host.createCtx() as never, { plugin: 'node:events' })
    host.provideWebServer()
    const handler = host.routes.get('/api/dsh-web-all/rows')
    expect(handler).toBeDefined()
    const res = fakeRes()
    // A REMOTE address must still be served: remote browsers read this route
    // same-origin for mount gating.
    await handler?.(fakeReq('203.0.113.10'), res)
    expect(res.status).toBe(200)
    expect(res.headers?.['cache-control']).toBe('no-store')
    expect(JSON.parse(res.body ?? '{}')).toEqual({ ok: true, children: ['node:events'] })
  })

  it('two module copies share one ledger and one route registration (chunk split)', async () => {
    // The built package loads through two entry artifacts (lib/index.js for
    // the self row, lib/shells/shell.js for family rows) whose chunk split
    // gives each its own module copy. A fresh dynamic import reproduces that
    // split: both copies must see ONE ledger and register the routes ONCE.
    const host = mockHost()
    await apply(host.createCtx() as never, undefined) // the "index.js" copy
    vi.resetModules()
    const freshShell = await import('../src/shell.ts')
    const freshRows = await import('../src/rows.ts')
    try {
      await freshShell.apply(host.createCtx() as never, { plugin: 'node:events' }) // the "shells chunk" copy
      host.provideWebServer()
      expect(host.webServer.register).toHaveBeenCalledTimes(2) // not 4
      // The chunk copy recorded; BOTH copies read the same ledger.
      expect(freshRows.listActiveRows()).toEqual(['node:events'])
      expect(listActiveRows()).toEqual(['node:events'])
      const res = fakeRes()
      await host.routes.get('/api/dsh-web-all/rows')?.(fakeReq(), res)
      expect(JSON.parse(res.body ?? '{}')).toEqual({ ok: true, children: ['node:events'] })
    } finally {
      freshShell._resetDegradedRouteForTest()
      freshRows._resetActiveRowsForTest()
    }
  })

  it('an import-failing row still counts as active (degraded, not disabled)', async () => {
    const host = mockHost()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await apply(host.createCtx() as never, { plugin: '@linxin666/definitely-missing-package' })
    expect(listActiveRows()).toEqual(['@linxin666/definitely-missing-package'])
    vi.mocked(console.error).mockRestore()
  })
})
