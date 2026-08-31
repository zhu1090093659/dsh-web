import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main, parseArgv } from './dsh-better-session.mjs'

/** The CLI is a thin shell over the package core; these tests keep its wiring
 * honest: arg parsing, managed-block writes through the real profile path,
 * the --yes reminder gate, and status JSON shape. */

// The core runner is a build artifact (packages/dsh-perf/lib is gitignored),
// so no-build consistency gates like deploy-market's skip the tests that go
// through it; ci.yml covers them fully after its Build step.
const RUNNER_URL = new URL('../packages/dsh-perf/lib/better-session-import.mjs', import.meta.url)
const skipWithoutRunner = {
  skip: existsSync(RUNNER_URL) ? false : 'packages/dsh-perf/lib/better-session-import.mjs is a build artifact; run pnpm build first',
}

test('parseArgv consumes values only for valueful flags', () => {
  const parsed = parseArgv(['migrate', '--json', '--apply', '--yes', '--create-store', '--sessions-dir', '/tmp/x', '--db', '/tmp/y', 'positional'])
  assert.equal(parsed.command, 'migrate')
  assert.deepEqual(parsed.flags, { _: ['positional'], json: true, apply: true, yes: true, 'create-store': true, 'sessions-dir': '/tmp/x', db: '/tmp/y' })
})

async function withTempHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-bs-cli-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run(home)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
}

async function runCapture(argv) {
  let captured = ''
  const log = console.log
  console.log = (line) => { captured += `${line}\n` }
  try {
    return { code: await main(argv), captured }
  } finally {
    console.log = log
  }
}

test('enable writes the managed block only with --yes; disable removes it', { skip: skipWithoutRunner.skip }, async () => {
  await withTempHome(async (home) => {
    const patchPath = join(home, 'profiles', 'web', 'cordis.patch.yml')
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    const original = '# existing row\n- id: web-ui-remote-web-ui\n  config:\n    autoTunnel: true\n'
    writeFileSync(patchPath, original)

    // Without --yes the first enable only reminds and declines.
    const reminded = await runCapture(['enable'])
    assert.equal(reminded.code, 1)
    assert.match(reminded.captured, /reminder:/)
    assert.equal(readFileSync(patchPath, 'utf8'), original)

    const applied = await runCapture(['enable', '--yes'])
    assert.equal(applied.code, 0)
    const enabled = readFileSync(patchPath, 'utf8')
    assert.match(enabled, /# >>> better-session opt-in/)
    assert.match(enabled, /\n- id: web-ui-session-rdb\n  disabled: false\n/)

    // Re-enable replaces rather than duplicating the markers.
    await runCapture(['enable', '--yes'])
    assert.equal(readFileSync(patchPath, 'utf8').split('# >>> better-session opt-in').length - 1, 1)

    const off = await runCapture(['disable'])
    assert.equal(off.code, 0)
    const restored = readFileSync(patchPath, 'utf8')
    assert.ok(!restored.includes('# >>> better-session opt-in'))
    assert.match(restored, /# existing row\n/)
  })
})

test('status reports json shape and shipped posture from a temp home', { skip: skipWithoutRunner.skip }, async () => {
  await withTempHome(async (home) => {
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), '')
    const run = await runCapture(['status', '--json'])
    assert.equal(run.code, 0)
    const payload = JSON.parse(run.captured.slice(run.captured.indexOf('{')))
    assert.equal(typeof payload.legacyTotalSessions, 'number')
    assert.equal(payload.storeExists, false)
    // The script derives its own repo root, so the aggregate overrides are visible here.
    assert.ok(['inactive-by-default', 'not-installed'].includes(payload.mountState))
  })
})

test('migrate dry-run decodes a synthetic log, binds runImport, and writes nothing', { skip: skipWithoutRunner.skip }, async () => {
  await withTempHome(async (home) => {
    // Regression: migrateCommand once called bare `runImport` without the
    // loadCore() binding — every invocation crashed with a ReferenceError.
    const core = await import(new URL('../packages/dsh-perf/lib/better-session-import.mjs', import.meta.url))
    const sessionsDir = join(home, 'sessions-root')
    const segment = join(sessionsDir, '--Users-demo--', 'session-3f2504e0-4f89-11d3-9a0c-0305e82c3301')
    mkdirSync(segment, { recursive: true })
    const header = { type: 'session', version: 0, id: 'session-3f2504e0-4f89-11d3-9a0c-0305e82c3301', createdAt: Date.now(), cwd: '/tmp/demo' }
    const events = [[
      { type: 'user/text', seq: 1, time: Date.now(), data: { text: 'hello' } },
      { type: 'assistant/chunk', seq: 2, time: Date.now(), ignorable: true, data: {} },
    ]]
    writeFileSync(join(segment, 'session.jsonl.zstd'), core.encodeSessionLog(header, events))

    const dbPath = join(home, 'sessions', 'sessions.sqlite')
    const run = await runCapture(['migrate', '--sessions-dir', sessionsDir, '--db', dbPath])
    assert.equal(run.code, 0)
    assert.match(run.captured, /scanned 1/)
    assert.match(run.captured, /dry-run: nothing written/)
    assert.equal(existsSync(dbPath), false)
  })
})
