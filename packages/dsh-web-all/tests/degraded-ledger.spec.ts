/**
 * Degraded-ledger contract (issues #1528, #1730).
 *
 * The shell's health route is what a degraded family plugin's own panel reads
 * to name WHY its row failed: a plugin that throws during apply registers no
 * route, so the bare 404 from its own API is all the panel otherwise has. The
 * record shape must therefore carry a one-line reason next to the full
 * message/stack, and it must exist for the stage that used to be invisible
 * (import ok, apply threw).
 */
import { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetDegradedForTest, failureReason, listDegraded, recordDegraded } from '../src/degraded.ts'
import { shellState } from '../src/state.ts'
import { apply, _resetDegradedRouteForTest } from '../src/shell.ts'

/** Real module whose plugin body throws during start (the #1730 shape). */
const THROWING_ROW = fileURLToPath(new URL('./fixtures/throwing-row.ts', import.meta.url))
const MISSING_SPEC = '@linxin666/dsh-web-all/definitely-missing-row'

function resetAll(): void {
  _resetDegradedRouteForTest()
  _resetDegradedForTest()
}

/** Minimal response double for the route handler. */
function fakeRes() {
  const res = {
    status: undefined as number | undefined,
    headers: undefined as Record<string, string> | undefined,
    body: undefined as string | undefined,
    writeHead(status: number, headers: Record<string, string>) { res.status = status; res.headers = headers },
    end(body: string) { res.body = body },
  }
  return res
}

describe('degraded record shape', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator reads one degraded record with its stage, message, reason and timestamp', () => {
    // Given a family plugin that failed during start
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; the suite asserts the ledger, and the record's stack dump would otherwise flood the report
    // When the shell records the failure
    recordDegraded('@linxin666/example', 'start', new Error('task-board ledger is already owned by process 4242'))
    // Then the record carries both the full message and the one-line reason
    const [record] = listDegraded()
    expect(record.plugin).toBe('@linxin666/example')
    expect(record.stage).toBe('start')
    expect(record.message).toContain('already owned by process 4242')
    expect(record.reason).toBe('task-board ledger is already owned by process 4242')
    expect(Number.isNaN(Date.parse(record.at))).toBe(false)
    vi.mocked(console.error).mockRestore()
  })

  it('operator gets one bounded reason line from a stack-bearing failure', () => {
    // Given failures whose text spans lines, is empty, or is huge
    // When each is compressed for display
    // Then the result is one bounded, non-empty line
    expect(failureReason(new Error('first line\nsecond line'))).toBe('first line')
    expect(failureReason(new Error('x'.repeat(900))).length).toBe(500)
    expect(failureReason('plain string failure')).toBe('plain string failure')
    expect(failureReason(new Error('')).length).toBeGreaterThan(0)
  })

  it('operator sees one refreshed record when the same plugin fails twice', () => {
    // Given a plugin already recorded as degraded
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; the suite asserts the ledger
    recordDegraded('@linxin666/example', 'import', new Error('boom'))
    // When a later failure is recorded for the same plugin
    recordDegraded('@linxin666/example', 'start', new Error('boom again'))
    // Then the ledger holds one record, refreshed to the newer stage
    expect(listDegraded().map(record => record.stage)).toEqual(['start'])
    vi.mocked(console.error).mockRestore()
  })
})

describe('a shell row that fails during apply is recorded as degraded', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('operator whose plugin throws during start still sees the active row and its reason on the health route', async () => {
    // Given a live host whose family row mounts a plugin that throws on start
    // (the second-DSH-instance shape: the ledger lock belongs to the other process)
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; this case asserts the health payload instead
    const routes = new Map<string, (req: unknown, res: unknown) => Promise<void> | void>()
    const root = new Context()
    root.provide('webServer', {
      register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    } as never)

    // When the row applies and the plugin body throws
    await root.plugin(apply as never, { plugin: THROWING_ROW } as never)

    // Then the ledger names the failure reason…
    const [record] = listDegraded()
    expect(record.plugin).toBe(THROWING_ROW)
    expect(record.stage).toBe('start')
    expect(record.reason).toBe('task-board ledger is already owned by process 4242')
    // …and the health route serves that reason to the degraded plugin's panel.
    const handler = routes.get('/api/dsh-web-all/degraded')
    expect(typeof handler).toBe('function')
    const res = fakeRes()
    await handler?.({ socket: { remoteAddress: '127.0.0.1' } }, res)
    expect(res.status).toBe(200)
    const payload = JSON.parse(res.body ?? '{}') as { ok: boolean; degraded: Array<{ plugin: string; stage: string; reason: string }> }
    expect(payload.ok).toBe(true)
    expect(payload.degraded).toEqual([
      expect.objectContaining({ plugin: THROWING_ROW, stage: 'start', reason: 'task-board ledger is already owned by process 4242' }),
    ])
    vi.mocked(console.error).mockRestore()
  })

  it('operator whose row specifier cannot be resolved sees the import failure in the same ledger', async () => {
    // Given a live host and a family row naming a package that does not resolve
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; the suite asserts the ledger instead
    const routes = new Map<string, unknown>()
    const root = new Context()
    root.provide('webServer', {
      register(route: { path: string }) {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    } as never)

    // When the row applies
    await root.plugin(apply as never, { plugin: MISSING_SPEC } as never)

    // Then the ledger the health route serves names the import failure
    const [record] = listDegraded()
    expect(record.plugin).toBe(MISSING_SPEC)
    expect(record.stage).toBe('import')
    expect(record.reason.length).toBeGreaterThan(0)
    expect(routes.has('/api/dsh-web-all/degraded')).toBe(true)
    vi.mocked(console.error).mockRestore()
  })

  it('operator reading through either bundle copy sees the same process-wide ledger', () => {
    // Given the aggregate loads through two entry artifacts (lib/index.js and
    // lib/shells/shell.js) whose chunk split gives each its own module copy
    vi.spyOn(console, 'error').mockImplementation(() => {}) // test-standards-allow: console is the shell's own log sink, not a collaborator; the suite asserts the shared registry instead
    // When one copy records a failure
    recordDegraded('@linxin666/example', 'start', new Error('shared state'))
    // Then the process-wide registry holds it, so both copies and the route agree
    expect(shellState().degraded.get('@linxin666/example')?.reason).toBe('shared state')
    vi.mocked(console.error).mockRestore()
  })
})