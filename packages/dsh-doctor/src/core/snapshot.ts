/**
 * Snapshot capture, verification, and restore.
 *
 * A snapshot stores the deterministic state of one profile: manifest files
 * (never node_modules), redacted copies of every text file, dump fingerprints,
 * and an opaque engine-state payload. All writes go through the injected
 * FsLike so tests run against the in-memory tree and partial-write failures
 * are observable.
 */
import { join } from 'node:path'
import { sha256Hex, sha256Short } from './hash.ts'
import type { FsLike } from './fs.ts'
import { safeRelativePath } from './paths.ts'
import type { RedactionResult, SnapshotDump, SnapshotFileEntry, SnapshotManifest } from './types.ts'

export interface SnapshotDeps {
  fs: FsLike
  /** Resolved harness home of the captured profile. */
  home: string
  profile: string
  /** Profile directory to capture. */
  profileDir: string
  /** Destination snapshot directory. */
  snapshotDir: string
  /** ISO timestamp provider. */
  now(): string
  /** Redact text for file copies and fingerprints. */
  redactTexts(text: string): RedactionResult
  /** Optional dsh version tag recorded in the manifest. */
  dshVersion?: string
  /** Optional engine state captured alongside (inventory, gate reports). */
  state?: unknown
  /** Optional config dumps captured by the caller. */
  dumps?: SnapshotDump[]
  /** Directory names excluded at any depth (default node_modules, .git, .pnpm). */
  excludeDirs?: string[]
  /** Files larger than this are recorded but not stored (default 1 MiB). */
  maxFileBytes?: number
}

/** Recursively list files under dir, sorted by path, skipping exclude dirs. */
export async function listProfileFiles(fs: FsLike, dir: string, excludeDirs: string[]): Promise<{ path: string; rel: string }[]> {
  const found: { path: string; rel: string }[] = []
  const walk = async (current: string, rel: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(current)
    } catch {
      return
    }
    for (const entry of entries) {
      if (excludeDirs.includes(entry.name) && entry.kind === 'dir') continue
      if (entry.kind !== 'file') continue
      found.push({ path: join(current, entry.name), rel: rel === '' ? entry.name : rel + '/' + entry.name })
    }
    for (const entry of entries) {
      if (excludeDirs.includes(entry.name) && entry.kind === 'dir') continue
      if (entry.kind !== 'dir') continue
      await walk(join(current, entry.name), rel === '' ? entry.name : rel + '/' + entry.name)
    }
  }
  await walk(dir, '')
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/** Capture one profile snapshot and write the manifest. */
export async function captureSnapshot(deps: SnapshotDeps): Promise<SnapshotManifest> {
  const exclude = deps.excludeDirs ?? ['node_modules', '.git', '.pnpm']
  const maxBytes = deps.maxFileBytes ?? 1024 * 1024
  const files = await listProfileFiles(deps.fs, deps.profileDir, exclude)
  const entries: SnapshotFileEntry[] = []
  for (const file of files) {
    const safeRel = safeRelativePath(file.rel)
    // Stat first so over-limit files are recorded without a full read or hash;
    // peak memory for large profiles stays bounded by the largest stored file.
    const stat = await deps.fs.stat(file.path)
    if (stat.kind === 'file' && stat.size > maxBytes) {
      entries.push({ path: safeRel, size: stat.size, omitted: true })
      continue
    }
    const data = await deps.fs.readBytes(file.path)
    const bytes = data.byteLength
    const binary = isBinary(data)
    if (bytes > maxBytes) {
      // The file grew after stat; still record it as omitted rather than store it.
      entries.push({ path: safeRel, hash: sha256Hex(data), size: bytes, kind: binary ? 'binary' : 'text', omitted: true })
      continue
    }
    const hash = sha256Hex(data)
    await deps.fs.mkdir(join(deps.snapshotDir, 'files'), { recursive: true })
    await deps.fs.mkdir(join(deps.snapshotDir, 'redacted'), { recursive: true })
    await mkdirFor(deps.fs, join(deps.snapshotDir, 'redacted', safeRel))
    const entry: SnapshotFileEntry = { path: safeRel, hash, size: bytes, kind: binary ? 'binary' : 'text' }
    if (!binary) {
      const text = new TextDecoder('utf-8').decode(data)
      const redacted = deps.redactTexts(text)
      await deps.fs.writeText(join(deps.snapshotDir, 'redacted', safeRel), redacted.text)
      entry.redactedHash = redacted.fingerprint
    }
    await mkdirFor(deps.fs, join(deps.snapshotDir, 'files', safeRel))
    await deps.fs.writeBytes(join(deps.snapshotDir, 'files', safeRel), data)
    entries.push(entry)
  }
  const manifestCore = {
    schemaVersion: 1,
    profile: deps.profile,
    files: entries,
  }
  const tsCompact = deps.now().replace(/[^0-9]/g, '').slice(0, 14)
  const snapshotId = deps.profile + '.' + tsCompact + '-' + sha256Short(JSON.stringify(manifestCore), 8)
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    snapshotId,
    createdAt: deps.now(),
    sourceHome: deps.home,
    profile: deps.profile,
    dshVersion: deps.dshVersion,
    files: entries,
    dumps: deps.dumps ?? [],
    state: deps.state,
  }
  await deps.fs.writeText(join(deps.snapshotDir, 'manifest.json'), JSON.stringify(manifest, undefined, 2) + '\n')
  return manifest
}

async function mkdirFor(fs: FsLike, file: string): Promise<void> {
  const index = file.lastIndexOf('/')
  const parent = index <= 0 ? '/' : file.slice(0, index)
  await fs.mkdir(parent, { recursive: true })
}

function isBinary(data: Uint8Array): boolean {
  const sample = data.subarray(0, 4096)
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) return true
  }
  return false
}


export interface SnapshotVerifyResult {
  ok: boolean
  snapshotId?: string
  mismatches: { path: string; expected: string; actual: string }[]
  missing: string[]
}

/** Re-hash every stored file and compare against the manifest. */
export async function verifySnapshot(fs: FsLike, snapshotDir: string): Promise<SnapshotVerifyResult> {
  let manifest: SnapshotManifest
  try {
    manifest = JSON.parse(await fs.readText(join(snapshotDir, 'manifest.json'))) as SnapshotManifest
  } catch (error) {
    return { ok: false, mismatches: [], missing: [] }
  }
  const mismatches: SnapshotVerifyResult['mismatches'] = []
  const missing: string[] = []
  for (const entry of manifest.files) {
    if (entry.omitted === true) continue
    const stored = join(snapshotDir, 'files', entry.path)
    try {
      const data = await fs.readBytes(stored)
      const actual = sha256Hex(data)
      if (actual !== entry.hash) mismatches.push({ path: entry.path, expected: entry.hash ?? '', actual })
    } catch (error) {
      missing.push(entry.path)
    }
  }
  return { ok: mismatches.length === 0 && missing.length === 0, snapshotId: manifest.snapshotId, mismatches, missing }
}

/** Restore stored files into a target directory (never escapes it). */
export async function restoreSnapshot(fs: FsLike, snapshotDir: string, targetDir: string): Promise<{ restored: number; skipped: string[] }> {
  let manifest: SnapshotManifest
  try {
    manifest = JSON.parse(await fs.readText(join(snapshotDir, 'manifest.json'))) as SnapshotManifest
  } catch (error) {
    throw new Error('cannot restore: manifest.json missing or unparsable in ' + snapshotDir)
  }
  let restored = 0
  const skipped: string[] = []
  for (const entry of manifest.files.sort(byPath)) {
    const safeRel = entry.path
    try {
      safeRelativePath(safeRel, 'snapshot entry')
    } catch (error) {
      skipped.push(safeRel + ' (unsafe relative path)')
      continue
    }
    if (entry.omitted === true) {
      skipped.push(safeRel + ' (omitted large file)')
      continue
    }
    const data = await fs.readBytes(join(snapshotDir, 'files', safeRel))
    if (sha256Hex(data) !== entry.hash) {
      skipped.push(safeRel + ' (hash mismatch)')
      continue
    }
    const target = join(targetDir, safeRel)
    await fs.mkdir(dirnameOf(target), { recursive: true })
    await fs.writeBytes(target, data)
    restored += 1
  }
  return { restored, skipped }
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

function dirnameOf(p: string): string {
  const index = p.lastIndexOf('/')
  return index <= 0 ? '/' : p.slice(0, index)
}
