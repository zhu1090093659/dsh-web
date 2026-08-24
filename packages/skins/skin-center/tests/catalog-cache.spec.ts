/**
 * Catalog cache tests: repeated snapshots reuse the memoized catalog until
 * the source fingerprint changes, then invalidate immediately — a workshop
 * install (new skin dir), an in-place skin.json edit, and a removed skin dir
 * all force the next request to rescan. Active-state writes (POST /active)
 * live outside the sources and must never invalidate the cache.
 */

import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeActiveState } from '../src/active-state.ts'
import { loadSkinCatalog } from '../src/skin-repo.ts'
import type { CatalogCacheEntry } from '../src/skin-repo.ts'

// Count catalog I/O without changing behavior: the file reads are what the
// cache must avoid on a second unchanged request, re-reads are what a
// successful invalidation requires.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
    statSync: vi.fn(actual.statSync),
  }
})

// Reads of catalog manifests only: other modules in the test graph (active
// state) legitimately read their own json files.
const readManifestCalls = (): number => vi.mocked(fs.readFileSync).mock.calls
  .filter(([p]) => typeof p === "string" && p.endsWith("skin.json")).length
const readdirCalls = (): number => vi.mocked(fs.readdirSync).mock.calls.length
const statCalls = (): number => vi.mocked(fs.statSync).mock.calls.length

let root: string
let builtin: string
let user: string

function writeSkin(baseDir: string, id: string, manifest: Record<string, unknown>): void {
  const dir = join(baseDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'skin.json'), JSON.stringify(manifest, null, 2))
}

function v2(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skinManifestVersion: 2,
    id,
    name: id,
    nameEn: id,
    version: '1.0.0',
    author: 'tester',
    contributes: { stylesheet: 'skin.css' },
    ...extra,
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skin-catalog-cache-'))
  builtin = join(root, 'builtin')
  user = join(root, 'user')
  mkdirSync(builtin)
  mkdirSync(user)
  vi.mocked(fs.readFileSync).mockClear()
  vi.mocked(fs.readdirSync).mockClear()
  vi.mocked(fs.statSync).mockClear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('skin catalog cache', () => {
  it('serves a second snapshot from the cache without re-reading skin.json', () => {
    writeSkin(builtin, 'harbor', v2('harbor'))
    writeSkin(user, 'custom', v2('custom'))
    const cache = new Map<string, CatalogCacheEntry>()

    const first = loadSkinCatalog({ builtinDir: builtin, userDir: user, now: () => 100, catalogCache: cache })
    expect(first.skins.map((s) => s.manifest.id).sort()).toEqual(['custom', 'harbor'])
    expect(first.capturedAt).toBe(100)
    // One manifest read per skin on the cold scan.
    expect(readManifestCalls()).toBe(2)

    const second = loadSkinCatalog({ builtinDir: builtin, userDir: user, now: () => 200, catalogCache: cache })
    // Same immutable entries, capturedAt re-stamped to the observation time,
    // and not a single skin.json read on the warm request.
    expect(second.skins.map((s) => s.manifest.id).sort()).toEqual(['custom', 'harbor'])
    expect(second.capturedAt).toBe(200)
    expect(readManifestCalls()).toBe(2)
    // The mtime fingerprint still re-reads both roots and stats each manifest
    // (4 readdirs cold: 2 fingerprint + 2 scan; 2 readdirs warm), but no scan.
    expect(readdirCalls()).toBe(6)
    expect(statCalls()).toBe(4)
  })

  it('re-scans when a new skin directory appears in the user source (workshop install)', () => {
    writeSkin(builtin, 'harbor', v2('harbor'))
    const cache = new Map<string, CatalogCacheEntry>()
    const first = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(first.skins.map((s) => s.manifest.id)).toEqual(['harbor'])
    const readsAfterFirstScan = readManifestCalls()

    writeSkin(user, 'workshop', v2('workshop'))
    const second = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(second.skins.map((s) => s.manifest.id)).toEqual(['harbor', 'workshop'])
    // The invalidated request re-reads every manifest, including the new skin.
    expect(readManifestCalls()).toBe(readsAfterFirstScan + 2)
  })

  it('re-scans when an existing skin.json is modified in place', () => {
    const manifestPath = join(builtin, 'harbor', 'skin.json')
    writeSkin(builtin, 'harbor', v2('harbor', { version: '1.0.0' }))
    // Deterministic mtimes: a plain rewrite is ns-precise on modern filesystems
    // but coarse on FAT-style media, so pin distinct values explicitly.
    utimesSync(manifestPath, 1_700_000_000, 1_700_000_000)
    const cache = new Map<string, CatalogCacheEntry>()
    const first = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(first.skins[0].manifest.version).toBe('1.0.0')

    writeFileSync(manifestPath, JSON.stringify(v2('harbor', { version: '2.0.0' }), null, 2))
    utimesSync(manifestPath, 1_700_000_001, 1_700_000_001)
    const second = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(second.skins[0].manifest.version).toBe('2.0.0')
    expect(readManifestCalls()).toBe(2)
  })

  it('re-scans when a skin directory is removed', () => {
    writeSkin(builtin, 'harbor', v2('harbor'))
    writeSkin(builtin, 'xp', v2('xp'))
    const cache = new Map<string, CatalogCacheEntry>()
    const first = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(first.skins.map((s) => s.manifest.id)).toEqual(['harbor', 'xp'])

    rmSync(join(builtin, 'xp'), { recursive: true, force: true })
    const second = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(second.skins.map((s) => s.manifest.id)).toEqual(['harbor'])
  })

  it('keys snapshots by the (builtinDir, userDir) pair', () => {
    const otherUser = join(root, 'other-user')
    mkdirSync(otherUser)
    writeSkin(builtin, 'harbor', v2('harbor'))
    writeSkin(user, 'alpha', v2('alpha'))
    writeSkin(otherUser, 'beta', v2('beta'))
    const cache = new Map<string, CatalogCacheEntry>()

    const a = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    const b = loadSkinCatalog({ builtinDir: builtin, userDir: otherUser, catalogCache: cache })
    const a2 = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(a.skins.map((s) => s.manifest.id)).toEqual(['alpha', 'harbor'])
    expect(b.skins.map((s) => s.manifest.id)).toEqual(['beta', 'harbor'])
    expect(a2.skins.map((s) => s.manifest.id)).toEqual(['alpha', 'harbor'])
  })

  it('keeps the cache warm across active-state writes (POST /active semantics)', () => {
    writeSkin(builtin, 'harbor', v2('harbor'))
    const cache = new Map<string, CatalogCacheEntry>()
    loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    const readsAfterScan = readManifestCalls()
    const readdirsAfterScan = readdirCalls()

    // The active selection persists next to the skins root, outside both
    // catalog sources (defaultActiveStatePath), so switching skins never
    // invalidates the catalog cache.
    writeActiveState(join(root, 'state', 'active.json'), { active: 'harbor' })

    const reload = loadSkinCatalog({ builtinDir: builtin, userDir: user, catalogCache: cache })
    expect(reload.skins.map((s) => s.manifest.id)).toEqual(['harbor'])
    // No manifest re-reads; only the two roots are re-fingerprinted (2 readdirs).
    expect(readManifestCalls()).toBe(readsAfterScan)
    expect(readdirCalls()).toBe(readdirsAfterScan + 2)
  })
})