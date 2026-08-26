/**
 * Skin repository tests: dual-source discovery, fail-closed validation,
 * user-shadows-builtin, immutable snapshots, path containment.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findSkin, loadSkinCatalog, resolveInsideSkin, shippedSkinIds, userSkinsDir } from '../src/skin-repo.ts'
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

describe('shippedSkinIds', () => {
  function fixturePackage(files: string[]): string {
    const pkgRoot = join(root, 'pkg-' + files.length)
    mkdirSync(join(pkgRoot, 'lib'), { recursive: true })
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({ files }))
    return pathToFileURL(join(pkgRoot, 'lib', 'x.js')).href
  }

  it('derives shipped ids from the package.json files whitelist', () => {
    const ids = shippedSkinIds(fixturePackage(['lib', 'skins/blue-fantasy', 'skins/whale-song/README.md', 'README.md']))
    expect([...ids].sort()).toEqual(['blue-fantasy', 'whale-song'])
  })

  it('returns an empty set without a skins whitelist entry', () => {
    expect(shippedSkinIds(fixturePackage(['lib', 'README.md'])).size).toBe(0)
  })

  it('returns an empty set when the package.json cannot be read', () => {
    const missing = join(root, 'missing', 'lib', 'x.js')
    expect(shippedSkinIds(pathToFileURL(missing).href).size).toBe(0)
  })
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

  describe('market hooks provenance (issue #1073)', () => {
    const HOOKS = 'export default function defineSkinHooks() { return { apply() {} } }'

    function writeMarketSkin(id: string, provenance: Record<string, unknown> | null): string {
      const dir = join(user, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'skin.json'), JSON.stringify(v2(id, {
        facets: { client: { entry: 'hooks.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } },
      }), null, 2))
      writeFileSync(join(dir, 'skin.css'), '.a { color: red; }')
      writeFileSync(join(dir, 'hooks.mjs'), HOOKS)
      if (provenance !== null) {
        writeFileSync(join(dir, 'dsh-market.provenance.json'), JSON.stringify(provenance, null, 2))
      }
      return dir
    }

    function provenanceFor(dir: string, id: string, rels: string[]): Record<string, unknown> {
      const files: Record<string, string> = {}
      for (const rel of rels) {
        files[rel] = createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')
      }
      return { version: 1, source: 'https://dsh-market.com', kind: 'skin', id, installedAt: new Date().toISOString(), files }
    }

    it('trusts hooks when skin.json and hooks hash-match market provenance', () => {
      const dir = writeMarketSkin('matrix', null)
      writeFileSync(join(dir, 'dsh-market.provenance.json'), JSON.stringify(provenanceFor(dir, 'matrix', ['skin.json', 'hooks.mjs', 'skin.css'])))
      const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
      const entry = catalog.skins.find((s) => s.manifest.id === 'matrix')
      expect(entry?.hooksTrusted).toBe(true)
      expect(entry?.warnings.join(' ')).not.toContain('refused')
    })

    it('recovers a legacy Workshop install only when reviewed manifest and hooks bytes match', () => {
      const reviewed = join(import.meta.dirname, '..', 'skins', 'matrix')
      const dir = join(user, 'matrix')
      mkdirSync(dir, { recursive: true })
      for (const rel of ['skin.json', 'skin.css', 'hooks.mjs']) {
        writeFileSync(join(dir, rel), readFileSync(join(reviewed, rel)))
      }
      // Declarative files that are outside the executable identity may differ;
      // recovery trusts only the complete manifest plus declared hook bytes.
      writeFileSync(join(dir, 'skin.css'), '.customized { color: lime; }')

      const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
      const entry = catalog.skins.find((skin) => skin.manifest.id === 'matrix')
      expect(entry?.origin).toBe('user')
      expect(entry?.hooksTrusted).toBe(true)
      expect(entry?.warnings.join(' ')).not.toContain('refused')
      expect(() => readFileSync(join(dir, 'dsh-market.provenance.json'))).toThrow()
    })

    it('keeps a legacy Workshop-shaped skin refused after manifest or hooks tampering', () => {
      const reviewed = join(import.meta.dirname, '..', 'skins', 'matrix')
      for (const id of ['matrix', 'matrix-copy']) {
        const dir = join(user, id)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'skin.css'), readFileSync(join(reviewed, 'skin.css')))
        writeFileSync(join(dir, 'hooks.mjs'), readFileSync(join(reviewed, 'hooks.mjs')))
        const manifest = JSON.parse(readFileSync(join(reviewed, 'skin.json'), 'utf8'))
        manifest.id = id
        writeFileSync(join(dir, 'skin.json'), JSON.stringify(manifest, null, 2))
      }
      writeFileSync(join(user, 'matrix', 'hooks.mjs'), 'export default () => ({ apply() {} }) // tampered')

      const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
      for (const id of ['matrix', 'matrix-copy']) {
        const entry = catalog.skins.find((skin) => skin.manifest.id === id)
        expect(entry?.hooksTrusted).toBeUndefined()
        expect(entry?.warnings.join(' ')).toContain('hooks facet will be refused')
      }
    })

    it('refuses hooks without provenance or after tampering', () => {
      // no provenance at all
      writeMarketSkin('noprovenance', null)
      // provenance, then the hooks bytes were replaced afterwards
      const tampered = writeMarketSkin('tampered', null)
      writeFileSync(join(tampered, 'dsh-market.provenance.json'), JSON.stringify(provenanceFor(tampered, 'tampered', ['skin.json', 'hooks.mjs'])))
      writeFileSync(join(tampered, 'hooks.mjs'), 'export default () => ({ apply() { return 1 } }) // tampered')
      // provenance from a foreign source
      const foreign = writeMarketSkin('foreign', null)
      const prov = provenanceFor(foreign, 'foreign', ['skin.json', 'hooks.mjs']) as { source: string }
      prov.source = 'https://example.com'
      writeFileSync(join(foreign, 'dsh-market.provenance.json'), JSON.stringify(prov))
      const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
      for (const id of ['noprovenance', 'tampered', 'foreign']) {
        const entry = catalog.skins.find((s) => s.manifest.id === id)
        expect(entry?.hooksTrusted).toBeUndefined()
        expect(entry?.warnings.join(' ')).toContain('hooks facet will be refused')
      }
    })

    it('pins the facet entry path through the skin.json hash', () => {
      const dir = writeMarketSkin('repinned', null)
      writeFileSync(join(dir, 'dsh-market.provenance.json'), JSON.stringify(provenanceFor(dir, 'repinned', ['skin.json', 'hooks.mjs'])))
      // post-install manifest rewrite pointing the facet at another file
      writeFileSync(join(dir, 'skin.json'), JSON.stringify(v2('repinned', {
        facets: { client: { entry: 'other.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } },
      }), null, 2))
      writeFileSync(join(dir, 'other.mjs'), HOOKS)
      const catalog = loadSkinCatalog({ builtinDir: builtin, userDir: user })
      const entry = catalog.skins.find((s) => s.manifest.id === 'repinned')
      expect(entry?.hooksTrusted).toBeUndefined()
    })
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
