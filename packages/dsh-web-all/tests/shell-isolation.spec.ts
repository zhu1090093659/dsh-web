/**
 * Shell isolation contract, exercised through the REAL dsh-app-boot boot()
 * (imported from the installed host package when available) with the actually
 * built shell artifact (lib/index.js). The contract: a family patch row that
 * mounts @linxin666/dsh-web-all with `config.plugin` degrades alone when the
 * real plugin fails to import or start, while healthy siblings mount and
 * provide services as usual. The control pins the alpha.2 native floor: the
 * host boot itself now isolates a direct-mount failing plugin (FAILED entry,
 * siblings ACTIVE), and the shell adds the audit-friendly ACTIVE state plus
 * the degraded ledger and health routes on top of it.
 *
 * The installed host is an optional peer: when dsh-app-boot is not resolvable
 * (clean CI checkout without the host face), the suite skips with a note — the
 * cordis-level semantics are separately covered by the shell unit tests.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PACKAGE_DIR, HOST_BOOT, dshIt, runBootScript } from './boot-harness.ts'
import { apply, _resetDegradedRouteForTest } from '../src/shell.ts'

/**
 * Run one boot() simulation over the standard fixtures.
 * @param rows - the loader rows to insert.
 * @returns the child's JSON facts line, or the failure that replaced it.
 */
function runBootScenario(rows: unknown[]): { ok: boolean; output: string; error?: string } {
  const script = [
    `const { boot } = await import(${JSON.stringify(HOST_BOOT)})`,
    `const rows = ${JSON.stringify(rows)}`,
    `try {`,
    `  const ctx = await boot('shell-it', '__DIR__/cordis.yml', rows)`,
    `  const loader = ctx.get('loader')`,
    `  const include = [...loader.entries()][0]`,
    `  const entries = [...include.subtree.entries()].map(e => ({ id: e.options.id, state: e.fiber ? e.fiber.state : null }))`,
    `  await new Promise(r => setTimeout(r, 100))`,
    `  console.log(JSON.stringify({ ok: true, entries, goodSvc: ctx.get('goodSvc') ?? null, regs: globalThis.__REGS ?? null }))`,
    `} catch (error) {`,
    `  console.log(JSON.stringify({ ok: false, error: String(error.message).slice(0, 160) }))`,
    `}`,
  ].join('\n')
  return runBootScript(script)
}

describe('dsh-web-all fault-isolation shell (real boot)', () => {
  it('has a built shell artifact and a shell-pointing patch', () => {
    expect(existsSync(join(PACKAGE_DIR, 'lib/shell.js'))).toBe(true)
    const patch = await_import_patch()
    expect(patch).toContain("name: '@linxin666/dsh-web-all'")
    // Family rows mount the real plugin package (issue #1901), so the loader
    // serves that package's own browser half instead of one inlined copy...
    expect(patch).toMatch(/- id: web-ui-usage\n      name: '@linxin666\/dsh-usage'\n/)
    // ...and the built shells re-export still exists for the subpath names a
    // pre-#1901 profile may record.
    expect(existsSync(join(PACKAGE_DIR, 'lib/shells/shell.js'))).toBe(true)
    // The exempted i18n row keeps its direct name.
    expect(patch).toMatch(/- id: web-ui-i18n\n      name: '@linxin666\/dsh-i18n'/)
  })

  dshIt('a family subpath row degrades alone exactly like the main-face shell', () => {
    // The subpath module is a pure re-export of the main face — prove the
    // isolation semantics through the artifact the loader actually imports.
    const result = runBootScenario([
      { insert: [{ id: 'shell-subpath', name: '__PKG__/shells/shell.js', config: { plugin: '__DIR__/bad.mjs' } }] },
      { insert: [{ id: 'good-entry-d', name: '__DIR__/good.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; goodSvc: unknown }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-subpath')?.state).toBe(2)
    expect(facts.entries.find(e => e.id === 'good-entry-d')?.state).toBe(2)
    expect(facts.goodSvc).toEqual({ ok: true })
  })

  dshIt('config-less row (the aggregate self row) mounts as a no-op, not an error', () => {
    // The self row web-ui-compat mounts this package with NO config. The
    // compat shim's host half is a no-op; treating it as a mis-generated row
    // killed real boots (regression fixed 2026-09-01).
    const result = runBootScenario([
      { insert: [{ id: 'web-ui-compat', name: '__PKG__/index.js' }] },
      { insert: [{ id: 'good-entry', name: '__DIR__/good.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; goodSvc: unknown }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'web-ui-compat')?.state).toBe(2)
    expect(facts.entries.find(e => e.id === 'good-entry')?.state).toBe(2)
    expect(facts.goodSvc).toEqual({ ok: true })
  })

  dshIt('a row WITH config but no plugin name degrades loudly without killing the boot', () => {
    // A mis-generated row used to throw from the async apply — the rejection
    // escaped the loader lifecycle as unhandled and the host fail-loud guard
    // killed the real `dsh web` (2026-09-01 boot regression). The shell now
    // records + returns; loudness lives in the log and the degraded ledger.
    const result = runBootScenario([
      { insert: [{ id: 'shell-bad-config', name: '__PKG__/index.js', config: { notPlugin: true } }] },
      { insert: [{ id: 'good-entry', name: '__DIR__/good.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; goodSvc: unknown }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-bad-config')?.state).toBe(2)
    expect(facts.entries.find(e => e.id === 'good-entry')?.state).toBe(2)
    expect(facts.goodSvc).toEqual({ ok: true })
  })

  dshIt('start-failing plugin degrades alone; healthy sibling mounts', () => {
    const result = runBootScenario([
      { insert: [{ id: 'shell-entry', name: '__PKG__/index.js', config: { plugin: '__DIR__/bad.mjs' } }] },
      { insert: [{ id: 'good-entry', name: '__DIR__/good.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; goodSvc: unknown }
    expect(facts.ok).toBe(true)
    const shell = facts.entries.find(e => e.id === 'shell-entry')
    const good = facts.entries.find(e => e.id === 'good-entry')
    expect(shell?.state).toBe(2) // ACTIVE — the boot audit sees a healthy entry
    expect(good?.state).toBe(2)
    expect(facts.goodSvc).toEqual({ ok: true }) // sibling service reachable at root
  })

  dshIt('import-failing plugin degrades alone; healthy sibling mounts', () => {
    const result = runBootScenario([
      { insert: [{ id: 'shell-bad-import', name: '__PKG__/index.js', config: { plugin: '__DIR__/missing-package.mjs' } }] },
      { insert: [{ id: 'good-entry-b', name: '__DIR__/good.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; goodSvc: unknown }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-bad-import')?.state).toBe(2)
    expect(facts.entries.find(e => e.id === 'good-entry-b')?.state).toBe(2)
    expect(facts.goodSvc).toEqual({ ok: true })
  })

  dshIt('control: the alpha.2 native boot isolates a direct-mount failing plugin', () => {
    // Behavior change anchored 2026-09-23: before alpha.2 a direct-mount
    // start-failing plugin rejected boot() ('failed to apply loader entry
    // include') and killed the whole process — the fault-isolation shell's
    // raison d'être. The alpha.2 host (cordis 4.0.4) isolates the fault
    // natively: boot resolves, the failing entry stays FAILED(3), and healthy
    // siblings mount and serve. The shell still earns its keep on top of the
    // native floor: it keeps family rows ACTIVE for the boot audit and owns
    // the degraded ledger plus the /api/dsh-web-all/degraded|/rows routes.
    const result = runBootScenario([
      { insert: [{ id: 'bad-direct', name: '__DIR__/bad.mjs' }] },
      { insert: [{ id: 'good-entry-c', name: '__DIR__/good.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output || '{}') as { ok: boolean; entries: Array<{ id: string; state: number }>; goodSvc: unknown }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'bad-direct')?.state).toBe(3) // FAILED — isolated, not fatal
    expect(facts.entries.find(e => e.id === 'good-entry-c')?.state).toBe(2) // ACTIVE
    expect(facts.goodSvc).toEqual({ ok: true })
  })

  dshIt('a late-provided webServer still gets the health route (boot ordering)', () => {
    // Real web boots: the shell applies with inject=[] BEFORE the web app
    // provides webServer, so the routes must register through the nested
    // inject fiber once the service appears — never stay absent. A sibling
    // entry providing webServer after the shell row reproduces that ordering.
    const result = runBootScenario([
      { insert: [{ id: 'shell-late-web', name: '__PKG__/index.js', config: { plugin: '__DIR__/good.mjs' } }] },
      { insert: [{ id: 'late-web-provider', name: '__DIR__/late-web.mjs' }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }>; regs: string[] | null }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-late-web')?.state).toBe(2)
    expect(facts.regs).toContain('/api/dsh-web-all/degraded')
  })

  dshIt('shell without webServer still boots (optional degraded route skips)', () => {
    // No webServer service in this scenario tree: the shell must not fail
    // — the route is best-effort.
    const result = runBootScenario([
      { insert: [{ id: 'shell-no-web', name: '__PKG__/index.js', config: { plugin: '__DIR__/bad.mjs' } }] },
    ])
    expect(result.error).toBeUndefined()
    const facts = JSON.parse(result.output) as { ok: boolean; entries: Array<{ id: string; state: number }> }
    expect(facts.ok).toBe(true)
    expect(facts.entries.find(e => e.id === 'shell-no-web')?.state).toBe(2)
  })

  it('multiple shell entries share the singleton degraded route without duplicate exact route error (#1363)', async () => {
    _resetDegradedRouteForTest()
    try {
      const routes = new Set<string>()
      let unregisters = 0
      const mockWebServer = {
        register: vi.fn((route: { path: string }) => {
          if (routes.has(route.path)) {
            throw new Error(`webserver: duplicate exact route "${route.path}"`)
          }
          routes.add(route.path)
          return () => {
            unregisters += 1
            routes.delete(route.path)
          }
        }),
      }

      const effects: Array<() => void> = []
      const pendingInject: Array<(scoped: unknown) => void> = []
      const createMockCtx = () => ({
        // The shell applies before webServer exists in the real boot;
        // registration rides this nested inject fiber.
        inject: (_deps: readonly string[], cb: (scoped: unknown) => void) => {
          pendingInject.push(cb)
        },
        effect: (fn: () => () => void) => {
          effects.push(fn())
        },
        // A settings edit reaches the mounted plugin through this event; the
        // mount itself goes through ctx.plugin.
        on: vi.fn(),
        plugin: vi.fn(() => ({ dispose: async () => {} })),
      })

      // Simulate 17 family subpath rows mounting sequentially
      for (let i = 0; i < 17; i++) {
        await apply(createMockCtx() as any, { plugin: 'node:events' })
      }
      // webServer arrives only now (real boot ordering: it did not exist yet).
      expect(mockWebServer.register).not.toHaveBeenCalled()
      const scoped = {
        webServer: mockWebServer,
        effect: (fn: () => () => void) => {
          effects.push(fn())
        },
      }
      for (const cb of pendingInject.splice(0)) cb(scoped)

      // The health route was registered exactly once for every entry
      expect(mockWebServer.register).toHaveBeenCalledTimes(1)
      expect(routes.has('/api/dsh-web-all/degraded')).toBe(true)

      // Each entry contributes one effect: the shared route hold when
      // webServer arrived (indexes 0-16). Release 16 of the 17 holds: the
      // route must remain active.
      for (let i = 0; i < 16; i++) {
        effects[i]?.()
      }
      expect(routes.has('/api/dsh-web-all/degraded')).toBe(true)
      expect(unregisters).toBe(0)

      // Final route-hold release: the route is disposed
      effects[16]?.()
      expect(routes.has('/api/dsh-web-all/degraded')).toBe(false)
      expect(unregisters).toBe(1)
    } finally {
      _resetDegradedRouteForTest()
    }
  })
})

/** Read the generated aggregate patch for the artifact contract assertions. */
function await_import_patch(): string {
  return readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')
}