import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { REPO_ROOT, applySync, checkSync, copyEntries, headerFor, renderCopy, stripHeader } from './sync-shared.mjs'

test('header/strip round-trips every file kind', () => {
  for (const file of ['settings-form.ts', 'PluginSettingsCard.tsx', 'settings-card.module.css']) {
    const source = 'export const x = 1' + String.fromCharCode(10)
    const sourceRel = 'shared/client/settings/' + file
    const rendered = renderCopy(source, file, sourceRel)
    assert.ok(rendered.startsWith(headerFor(file, sourceRel)))
    assert.equal(stripHeader(rendered, file, sourceRel), source)
    assert.equal(stripHeader('mangled ' + rendered.slice(10), file, sourceRel), undefined)
  }
})

test('copies cover the settings trio for all consumers plus host and http helpers', () => {
  // Normalize separators: node:path join yields backslashes on Windows, and
  // the copy-count buckets below match on forward slashes.
  const entries = copyEntries().map(entry => ({ ...entry, target: entry.target.replaceAll('\\', '/') }))
  assert.equal(entries.length, 102)
  const clientTrio = entries.filter(entry => entry.target.includes('/src/client/'))
  assert.equal(clientTrio.length, 39)
  const hostCopies = entries.filter(entry => entry.target.includes('/src/host/')
    || entry.target.includes('/src/dsh-home.ts')
    || entry.target.includes('/src/mount-once.ts')
    || entry.target.includes('/src/loopback.ts')
    || entry.target.includes('/src/pair-access.ts')
    || entry.target.includes('/src/agent/')
    || entry.target.endsWith('/packages/dsh-task-board/src/http.ts'))
  assert.equal(hostCopies.length, 51)
})

test('checkSync detects drift and applySync repairs it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-shared-test-'))
  try {
    // Fake tree: shared source + one consumer copy with wrong content.
    const sourceDir = join(root, 'shared', 'client', 'settings')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(join(sourceDir, 'settings-form.ts'), 'export const good = 1' + String.fromCharCode(10))
    await writeFile(join(sourceDir, 'PluginSettingsCard.tsx'), 'export const card = 1' + String.fromCharCode(10))
    await writeFile(join(sourceDir, 'settings-card.module.css'), '.card { color: red }' + String.fromCharCode(10))
    await writeFile(join(root, 'shared', 'client', 'telemetry.ts'), 'export const beat = 1' + String.fromCharCode(10))
    await writeFile(join(root, 'shared', 'client', 'sse-leader.ts'), 'export const leader = 1' + String.fromCharCode(10))
    await writeFile(join(root, 'shared', 'client', 'sidebar-entry-core.ts'), 'export const sidecore = 1' + String.fromCharCode(10))
    const hostDir = join(root, 'shared', 'host')
    await mkdir(hostDir, { recursive: true })
    await writeFile(join(hostDir, 'poll-guard.ts'), 'export const guard = 1' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'dsh-home.ts'), 'export const home = 1' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'loopback.ts'), 'export const loop = 1' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'pair-access.ts'), 'export const fence = 1' + String.fromCharCode(10))
    await writeFile(join(root, 'shared', 'vitest.setup.ts'), 'export {}' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'git-runner.ts'), 'export const runner = 1' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'mount-once.ts'), 'export const once = 1' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'http.ts'), 'export const http = 1' + String.fromCharCode(10))
    await writeFile(join(hostDir, 'legacy-migration.ts'), 'export const legacy = 1' + String.fromCharCode(10))
    const targetDir = join(root, 'packages', 'dsh-pet', 'src', 'client')
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(targetDir, 'settings-form.ts'), renderCopy('export const bad = 2' + String.fromCharCode(10), 'settings-form.ts', 'shared/client/settings/settings-form.ts'))

    // checkSync compares all consumers; the missing files count as drift too.
    const before = await checkSync(root)
    assert.ok(before.some(entry => entry.reason === 'content drifted from shared source'))
    assert.ok(before.some(entry => entry.reason === 'missing'))

    await applySync(root)
    const after = await checkSync(root)
    assert.deepEqual(after, [])
    const fixed = await readFile(join(targetDir, 'settings-form.ts'), 'utf8')
    assert.equal(stripHeader(fixed, 'settings-form.ts', 'shared/client/settings/settings-form.ts'), 'export const good = 1' + String.fromCharCode(10))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the live tree is in sync', async () => {
  const drift = await checkSync()
  assert.deepEqual(drift, [])
})