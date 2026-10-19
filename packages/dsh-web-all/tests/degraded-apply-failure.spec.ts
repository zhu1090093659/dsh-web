/**
 * Apply-stage failure ledger contract (issue #1850).
 *
 * The shell captures a family plugin's start failure in two places: the
 * synchronous throw out of ctx.plugin() and the rejection of the fiber it
 * returns. Only the first has a fixture (fixtures/throwing-row.ts) and a spec
 * today, so the async half is unpinned: deleting the fiber-rejection handler
 * leaves the whole suite green while a row whose apply awaits before failing
 * disappears from the ledger — exactly the "import ok, apply threw" class this
 * contract exists for, and the reason a degraded panel reads an empty ledger.
 */
import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetDegradedForTest, listDegraded } from '../src/degraded.ts'
import { apply, _resetDegradedRouteForTest } from '../src/shell.ts'

/** Real module whose plugin body rejects during start, after an await. */
const ASYNC_THROWING_ROW = fileURLToPath(new URL('./fixtures/async-throwing-row.ts', import.meta.url))
/** Real module whose apply cordis DEFERS until its injected service appears. */
const DEFERRED_THROWING_ROW = fileURLToPath(new URL('./fixtures/deferred-throwing-row.ts', import.meta.url))
const OWNED_LOCK_REASON = 'task-board ledger is already owned by process 4242'

function resetAll(): void {
  _resetDegradedRouteForTest()
  _resetDegradedForTest()
}

/** A live cordis root whose webServer records the shell's health routes. */
function liveHost(): { root: Context; routes: Map<string, (req: unknown, res: unknown) => Promise<void> | void> } {
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void> | void>()
  const root = new Context()
  root.provide('webServer', {
    register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) {
      routes.set(route.path, route.handler)
      return () => { routes.delete(route.path) }
    },
  } as never)
  return { root, routes }
}

/**
 * Run the pending microtask queue to completion.
 *
 * Cordis resumes a deferred plugin on microtasks (its reload awaits an already
 * resolved promise before invoking the plugin body), and the shell's failure
 * handler hops once more before it records. Draining a bounded number of turns
 * therefore settles that sequence deterministically — no wall-clock wait, so
 * the case cannot flake under load.
 * @returns a promise resolving once the queue has drained.
 */
async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 32; turn += 1) await Promise.resolve()
}

/** Minimal response double for the route handler. */
function fakeRes() {
  const res = {
    status: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(status: number) { res.status = status },
    end(body: string) { res.body = body },
  }
  return res
}

describe('a family row that fails asynchronously during apply is recorded as degraded (#1850)', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator whose plugin rejects after an await still sees the row and its reason in the ledger', async () => {
    // Given a live host whose family row mounts a plugin that awaits, then fails
    // (the second-DSH-instance shape: the ledger lock belongs to the other process)
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; this case asserts the ledger and the health payload
    const { root, routes } = liveHost()

    // When the row applies and the plugin body rejects
    await root.plugin(apply as never, { plugin: ASYNC_THROWING_ROW } as never)

    // Then the ledger names the failure…
    const [record] = listDegraded()
    expect(record.plugin).toBe(ASYNC_THROWING_ROW)
    expect(record.stage).toBe('start')
    expect(record.reason).toBe(OWNED_LOCK_REASON)
    // …and the health route the task board's panel reads serves it.
    const handler = routes.get('/api/dsh-web-all/degraded')
    expect(typeof handler).toBe('function')
    const res = fakeRes()
    await handler?.({ socket: { remoteAddress: '127.0.0.1' } }, res)
    expect(res.status).toBe(200)
    const payload = JSON.parse(res.body ?? '{}') as { ok: boolean; degraded: Array<{ plugin: string; reason: string }> }
    expect(payload.ok).toBe(true)
    expect(payload.degraded).toEqual([
      expect.objectContaining({ plugin: ASYNC_THROWING_ROW, stage: 'start', reason: OWNED_LOCK_REASON }),
    ])
    vi.mocked(console.error).mockRestore()
  })

  it('operator whose deferred plugin throws when its injected service appears sees it in the ledger', async () => {
    // Given a live host whose family row names a plugin that INJECTS a service
    // (every real family plugin does: the task board injects systemPrompt,
    // typertGateway, workspaceRegistry, webServer, agents and commands), so
    // cordis defers its apply until that service exists and the shell's mount
    // call returns on a fiber that is still PENDING — long before the failure
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; this case asserts the ledger
    const { root } = liveHost()
    await root.plugin(apply as never, { plugin: DEFERRED_THROWING_ROW } as never)
    expect(listDegraded()).toEqual([])

    // When the injected service finally appears and the deferred apply throws
    root.provide('lateSvc', {} as never)
    // Cordis starts the now-satisfied plugin on microtasks (its reload awaits a
    // resolved promise before running the body, and the shell's own failure
    // handler hops once more), so draining them settles the whole sequence
    // without a wall-clock wait.
    await drainMicrotasks()

    // Then the row is recorded with its reason, not silently lost
    expect(listDegraded()).toEqual([
      expect.objectContaining({ plugin: DEFERRED_THROWING_ROW, stage: 'start', reason: OWNED_LOCK_REASON }),
    ])
    vi.mocked(console.error).mockRestore()
  })
})