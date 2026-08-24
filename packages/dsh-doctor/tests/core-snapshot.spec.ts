/**
 * Snapshot capture, verify, restore.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryFs } from '../src/core/fs.ts'
import type { FsLike } from '../src/core/fs.ts'
import { captureSnapshot, listProfileFiles, restoreSnapshot, verifySnapshot } from '../src/core/snapshot.ts'
import { defaultRules, redactText } from '../src/core/redact.ts'
import type { SnapshotDeps } from '../src/core/snapshot.ts'

const NOW = '2026-08-21T23:00:00.000Z'

function makeDeps(fs: ReturnType<typeof createMemoryFs>, profile = 'web', dir = '/h/profiles/web'): SnapshotDeps {
  return {
    fs,
    home: '/h',
    profile,
    profileDir: dir,
    snapshotDir: '/h/.dsh-doctor/snapshots/' + profile,
    now: () => NOW,
    redactTexts: (text) => redactText(text, defaultRules()),
    dshVersion: '0.1.1-rc.2',
  }
}

async function seedProfile(fs: ReturnType<typeof createMemoryFs>): Promise<void> {
  await fs.mkdir('/h/profiles/web', { recursive: true })
  await fs.writeText('/h/profiles/web/package.json', JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))
  await fs.writeText('/h/profiles/web/cordis.patch.yml', `- id: settings
  config:
    apiKey: sk-abcdefghijklmnop
`)
  await fs.writeText('/h/profiles/web/cordis.yml', `[]
`)
  await fs.mkdir('/h/profiles/web/node_modules/@deepseek-ai/dsh-base', { recursive: true })
  await fs.writeText('/h/profiles/web/node_modules/@deepseek-ai/dsh-base/package.json', '{}')
  await fs.mkdir('/h/profiles/web/dir', { recursive: true })
  await fs.writeText('/h/profiles/web/dir/notes.txt', 'notes')
}

describe('captureSnapshot', () => {
  it('captures manifest files, redacts text, and skips node_modules', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    const manifest = await captureSnapshot(makeDeps(fs))
    expect(manifest.profile).toBe('web')
    expect(manifest.sourceHome).toBe('/h')
    expect(manifest.files.map((f) => f.path)).toEqual(['cordis.patch.yml', 'cordis.yml', 'dir/notes.txt', 'package.json'])
    const patch = manifest.files.find((f) => f.path === 'cordis.patch.yml')
    expect(patch?.redactedHash).toBeDefined()
    expect(patch?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(patch?.kind).toBe('text')
    const redacted = await fs.readText('/h/.dsh-doctor/snapshots/web/redacted/cordis.patch.yml')
    expect(redacted).not.toContain('sk-abcdefghijklmnop')
    expect(redacted).toContain('REDACTION')
    expect(manifest.snapshotId).toMatch(/^web\.[0-9]{14}-[0-9a-f]{8}$/)
  })

  it('produces identical manifests for identical state (deterministic)', async () => {
    const fs1 = createMemoryFs()
    const fs2 = createMemoryFs()
    await seedProfile(fs1)
    await seedProfile(fs2)
    const a = await captureSnapshot(makeDeps(fs1))
    const b = await captureSnapshot(makeDeps(fs2))
    expect(a.files).toEqual(b.files)
    expect(a.snapshotId).toBe(b.snapshotId)
  })

  it('records large files as omitted without reading or hashing them', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    await fs.writeText('/h/profiles/web/big.bin', 'x'.repeat(2048))
    const reads: string[] = []
    const countingFs: FsLike = {
      ...fs,
      async readBytes(path) {
        reads.push(path)
        return fs.readBytes(path)
      },
    }
    const deps = makeDeps(countingFs)
    deps.maxFileBytes = 1024
    const manifest = await captureSnapshot(deps)
    const big = manifest.files.find((f) => f.path === 'big.bin')
    expect(big).toEqual({ path: 'big.bin', size: 2048, omitted: true })
    expect(reads).not.toContain('/h/profiles/web/big.bin')
    const verify = await verifySnapshot(countingFs, '/h/.dsh-doctor/snapshots/web')
    expect(verify.ok).toBe(true)
    const restored = await restoreSnapshot(countingFs, '/h/.dsh-doctor/snapshots/web', '/restore/web')
    expect(restored.restored).toBe(4)
    expect(restored.skipped).toContain('big.bin (omitted large file)')
  })

  it('stores files exactly at the size limit', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    await fs.writeText('/h/profiles/web/boundary.bin', 'x'.repeat(1024))
    const deps = makeDeps(fs)
    deps.maxFileBytes = 1024
    const manifest = await captureSnapshot(deps)
    const entry = manifest.files.find((f) => f.path === 'boundary.bin')
    expect(entry?.size).toBe(1024)
    expect(entry?.omitted).toBeUndefined()
    expect(entry?.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('listProfileFiles', () => {
  it('sorts and excludes nested excluded dirs', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    const files = await listProfileFiles(fs, '/h/profiles/web', ['node_modules', '.git', '.pnpm'])
    expect(files.map((f) => f.rel)).toEqual(['cordis.patch.yml', 'cordis.yml', 'dir/notes.txt', 'package.json'])
  })
})

describe('verifySnapshot', () => {
  it('verifies intact snapshots and flags tampering', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    await captureSnapshot(makeDeps(fs))
    const ok = await verifySnapshot(fs, '/h/.dsh-doctor/snapshots/web')
    expect(ok.ok).toBe(true)
    await fs.writeText('/h/.dsh-doctor/snapshots/web/files/cordis.yml', 'tampered\n')
    const bad = await verifySnapshot(fs, '/h/.dsh-doctor/snapshots/web')
    expect(bad.ok).toBe(false)
    expect(bad.mismatches.some((m) => m.path === 'cordis.yml')).toBe(true)
  })
})

describe('restoreSnapshot', () => {
  it('restores files into a target dir and skips unsafe entries', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    await captureSnapshot(makeDeps(fs))
    const manifest = JSON.parse(await fs.readText('/h/.dsh-doctor/snapshots/web/manifest.json'))
    manifest.files.push({ path: '../../evil.txt', hash: 'x'.repeat(64), size: 0, kind: 'text' })
    await fs.writeText('/h/.dsh-doctor/snapshots/web/manifest.json', JSON.stringify(manifest) + '\n')
    const target = '/restore/web'
    const result = await restoreSnapshot(fs, '/h/.dsh-doctor/snapshots/web', target)
    expect(result.restored).toBe(4)
    expect(result.skipped.some((s) => s.includes('unsafe relative path'))).toBe(true)
    expect(await fs.readText(target + '/package.json')).toContain('dsh-base')
  })

  it('skips hash-mismatched stored files', async () => {
    const fs = createMemoryFs()
    await seedProfile(fs)
    await captureSnapshot(makeDeps(fs))
    await fs.writeText('/h/.dsh-doctor/snapshots/web/files/cordis.yml', 'changed\n')
    const result = await restoreSnapshot(fs, '/h/.dsh-doctor/snapshots/web', '/restore/web')
    expect(result.skipped.some((s) => s.includes('hash mismatch'))).toBe(true)
  })
})

