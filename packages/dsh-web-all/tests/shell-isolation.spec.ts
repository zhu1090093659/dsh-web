/**
 * Shell isolation contract, exercised through the REAL dsh-app-boot boot()
 * (imported from the installed host package when available) with the actually
 * built shell artifact (lib/index.js). The contract: a family patch row that
 * mounts @linxin666/dsh-web-all with `config.plugin` degrades alone when the
 * real plugin fails to import or start, while healthy siblings mount and
 * provide services as usual. The control proves today's direct-mount shape
 * still kills the whole boot, anchoring why the shell exists.
 *
 * The installed host is an optional peer: when dsh-app-boot is not resolvable
 * (clean CI checkout without the host face), the suite skips with a note — the
 * cordis-level semantics are separately covered by the shell unit tests.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** Locate the installed host's dsh-app-boot (the shell contract's authority). */
function resolveHostBoot(): string | null {
  for (const base of [PACKAGE_DIR, join(PACKAGE_DIR, '../..'), '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot']) {
    try {
      return require.resolve('@deepseek-ai/dsh-app-boot', { paths: [base] })
    } catch {
      continue
    }
  }
  return null
}

const HOST_BOOT = resolveHostBoot()
const dshIt = HOST_BOOT ? it : it.skip

function dirname(path: string): string {
  return resolve(path, '..')
}

/**
 * Run one boot() simulation in a child node process: boot() installs process
 * handlers and may exit; isolation demands the child, not the suite. The
 * child prints one JSON line on stdout with the verification facts.
 */
function runBootScenario(rows: unknown[]): { ok: boolean; output: string; error?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-shell-it-'))
  writeFileSync(join(dir, 'bad.mjs'), 'export function apply() { throw new Error("real plugin start boom") }\n')
  writeFileSync(
    join(dir, 'good.mjs'),
    'export function apply(ctx) { ctx.provide("goodSvc", { ok: true }); globalThis.__GOOD = 1 }\n',
  )
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const script = [
    `const { boot } = await import(${JSON.stringify(HOST_BOOT)})`,
    // __DIR__ = the scenario dir (bad/good plugins, cordis.yml);
    // __PKG__ = this package's built lib/ (the shell artifact).
    `const rows = ${JSON.stringify(rows).replaceAll('__DIR__', dir).replaceAll('__PKG__', join(PACKAGE_DIR, 'lib'))}`,
    `try {`,
    `  const ctx = await boot('shell-it', ${JSON.stringify(join(dir, 'cordis.yml'))}, rows)`,
    `  const loader = ctx.get('loader')`,
    `  const include = [...loader.entries()][0]`,
    `  const entries = [...include.subtree.entries()].map(e => ({ id: e.options.id, state: e.fiber ? e.fiber.state : null }))`,
    `  console.log(JSON.stringify({ ok: true, entries, goodSvc: ctx.get('goodSvc') ?? null }))`,
    `} catch (error) {`,
    `  console.log(JSON.stringify({ ok: false, error: String(error.message).slice(0, 160) }))`,
    `}`,
  ].join('\n')
  writeFileSync(join(dir, 'scenario.mjs'), script)
  try {
    const stdout = execFileSync(process.execPath, [join(dir, 'scenario.mjs')], { encoding: 'utf8', timeout: 30_000 })
    const line = stdout.trim().split('\n').find(l => l.startsWith('{'))
    return { ok: true, output: line ?? '' }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string }
    const line = (e.stdout ?? '').trim().split('\n').find(l => l.startsWith('{'))
    if (line) return { ok: true, output: line }
    return { ok: false, output: '', error: (e.stderr ?? String(error)).slice(0, 200) }
  }
}

describe('dsh-web-all fault-isolation shell (real boot)', () => {
  it('has a built shell artifact and a shell-pointing patch', () => {
    expect(existsSync(join(PACKAGE_DIR, 'lib/shell.js'))).toBe(true)
    const patch = await_import_patch()
    expect(patch).toContain("name: '@linxin666/dsh-web-all'")
    // Family rows mount per-family subpath exports (distinct inventory
    // titles) while still carrying the real plugin name in config...
    expect(patch).toMatch(/- id: web-ui-usage\n      name: '@linxin666\/dsh-web-all\/usage'\n      config:\n        plugin: '@linxin666\/dsh-usage'/)
    // ...and the built shells re-export exists for those specifiers.
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

  dshIt('control: direct-mount failing plugin still kills the boot (today\'s behavior)', () => {
    const result = runBootScenario([
      { insert: [{ id: 'bad-direct', name: '__DIR__/bad.mjs' }] },
      { insert: [{ id: 'good-entry-c', name: '__DIR__/good.mjs' }] },
    ])
    const facts = JSON.parse(result.output || '{}') as { ok: boolean; error?: string }
    expect(facts.ok).toBe(false)
    expect(facts.error).toContain('failed to apply loader entry include')
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
})

/** Read the generated aggregate patch for the artifact contract assertions. */
function await_import_patch(): string {
  // Lazy require keeps vitest happy without top-level await.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(join(PACKAGE_DIR, 'cordis.patch.yml'), 'utf8')
}