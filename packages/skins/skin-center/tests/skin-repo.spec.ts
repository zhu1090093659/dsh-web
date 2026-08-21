/**
 * Skin repository tests: dual-source discovery, fail-closed validation,
 * user-shadows-builtin, immutable snapshots, path containment.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findSkin, loadSkinCatalog, resolveInsideSkin, userSkinsDir } from '../src/skin-repo.ts'
import type { SkinCatalogEntry } from '../src/skin-repo.ts'

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
  root = mkdtempSync(join(tmpdir(), 'skin-repo-'))
  builtin = join(root, 'builtin')
  user = join(root, 'user')
  mkdirSync(builtin)
  mkdirSync(user)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadSkinCatalog', () => {
  it('collects valid skins from both sources, sorted by order then id', () => {
    writeSkin(builtin, 'harbor', v2('harbor', { order: 3 }))
    writeSkin(builtin, 'xp', v2('xp', { order: 1 }))
    writeSkin(user, 'custom', v2('custom'))
    const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user, now: () => 42 })
    expect(catalog.skins.map((s) => s.manifest.id)).toEqual(['xp', 'harbor', 'custom'])
    expect(catalog.skins.find((s) => s.manifest.id === 'custom')?.origin).toBe('user')
    expect(catalog.capturedAt).toBe(42)
    expect(catalog.diagnostics).toEqual([])
  })

  it('excludes invalid skins fail-closed with diagnostics', () => {
    writeSkin(builtin, 'good', v2('good'))
    writeSkin(builtin, 'bad-json', {})
    writeFileSync(join(builtin, 'bad-json', 'skin.json'), '{nope')
    writeSkin(builtin, 'bad-schema', { hello: 'world' })
    writeSkin(builtin, 'bad-id', v2('different-id'))
    const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
    expect(catalog.skins.map((s) => s.manifest.id)).toEqual(['good'])
    const subjects = catalog.diagnostics.map((d) => d.subject).sort()
    expect(subjects).toEqual(['bad-id', 'bad-json', 'bad-schema'])
  })

  it('lets a user skin shadow the built-in one', () => {
    writeSkin(builtin, 'harbor', v2('harbor', { version: '1.0.0' }))
    writeSkin(user, 'harbor', v2('harbor', { version: '2.0.0' }))
    const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
    const entries = catalog.skins.filter((s) => s.manifest.id === 'harbor')
    expect(entries).toHaveLength(1)
    expect(entries[0].origin).toBe('user')
    expect(entries[0].manifest.version).toBe('2.0.0')
    expect(entries[0].warnings.join(' ')).toContain('shadows')
  })

  it('carries deprecated-field warnings without failing the skin', () => {
    writeSkin(builtin, 'legacy', v2('legacy', { package: '@linxin666/old', bodyAttr: 'data-dsh-x' }))
    const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
    expect(catalog.skins).toHaveLength(1)
    expect(catalog.skins[0].warnings).toHaveLength(2)
  })

  it('tolerates missing roots', () => {
    const catalog = loadSkinCatalog({ builtinDir: join(root, 'nope'), userDir: join(root, 'nada') })
    expect(catalog.skins).toEqual([])
    expect(catalog.diagnostics).toEqual([])
  })
})

describe('userSkinsDir', () => {
  it('uses DSH_SKINS_HOME, then DSH_SKINS_DIR, then DSH_HOME/skins', () => {
    expect(userSkinsDir({ DSH_SKINS_HOME: join(root, 'home'), DSH_SKINS_DIR: join(root, 'dir') })).toBe(join(root, 'home'))
    expect(userSkinsDir({ DSH_SKINS_DIR: join(root, 'dir') })).toBe(join(root, 'dir'))
    expect(userSkinsDir({ DSH_HOME: join(root, 'dsh') })).toBe(join(root, 'dsh', 'skins'))
  })
})

describe('findSkin / resolveInsideSkin', () => {
  it('finds by id and rejects escapes', () => {
    writeSkin(builtin, 'harbor', v2('harbor'))
    const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
    const entry = findSkin(catalog, 'harbor') as SkinCatalogEntry
    expect(entry.manifest.id).toBe('harbor')
    expect(resolveInsideSkin(entry, 'assets/bg.png')).toBe(join(entry.dir, 'assets/bg.png'))
    expect(resolveInsideSkin(entry, '../secret')).toBeNull()
    expect(resolveInsideSkin(entry, '../../etc/passwd')).toBeNull()
    expect(resolveInsideSkin(entry, 'a/../../secret')).toBeNull()
    expect(findSkin(catalog, 'nope')).toBeNull()
  })
})
