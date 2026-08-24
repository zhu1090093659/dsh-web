/**
 * Lockfile importer parsing, workspace settings, and profile inventory.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryFs } from '../src/core/fs.ts'
import { inventoryProfile, parseLockfileImporter, parseWorkspaceSettings } from '../src/core/inventory.ts'
import { parseProfileManifest } from '../src/core/manifest.ts'
import { createYamlEngine } from '../src/core/yaml.ts'

const engine = createYamlEngine()

const LOCK = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@deepseek-ai/dsh-mcp-client':
        specifier: 0.1.1-rc.2
        version: 0.1.1-rc.2
      '@linxin666/dsh-web-all':
        specifier: link:../packages/dsh-web-all
        version: link:../packages/dsh-web-all
      dsh-better-sidebar:
        specifier: ^0.14.0
        version: 0.14.0
`

describe('parseLockfileImporter', () => {
  it('parses importer dependencies with specifiers and versions', () => {
    const parsed = parseLockfileImporter(LOCK, engine)
    expect(parsed.status).toBe('ok')
    expect(parsed.lockfileVersion).toBe('9.0')
    expect(parsed.importer?.get('@linxin666/dsh-web-all')?.version).toBe('link:../packages/dsh-web-all')
    expect(parsed.importer?.get('dsh-better-sidebar')?.version).toBe('0.14.0')
  })

  it('flags broken lockfiles', () => {
    expect(parseLockfileImporter(']: bad', engine).status).toBe('broken')
    expect(parseLockfileImporter('- list', engine).status).toBe('broken')
  })

  it('accepts importer-less lockfiles as ok', () => {
    const parsed = parseLockfileImporter('lockfileVersion: 9.0\n', engine)
    expect(parsed.status).toBe('ok')
    expect(parsed.importer?.size).toBe(0)
  })
})

describe('parseWorkspaceSettings', () => {
  it('reads linker, peers, allowBuilds and release-age excludes', () => {
    const ws = parseWorkspaceSettings(`nodeLinker: hoisted
autoInstallPeers: false
allowBuilds:
  node-pty: true
minimumReleaseAgeExclude:
  - x@1.0.0
`, engine)
    expect(ws?.nodeLinker).toBe('hoisted')
    expect(ws?.autoInstallPeers).toBe(false)
    expect(ws?.allowBuilds).toEqual(['node-pty'])
    expect(ws?.minimumReleaseAgeExclude).toEqual(['x@1.0.0'])
  })

  it('returns undefined for missing or unparsable settings', () => {
    expect(parseWorkspaceSettings(undefined, engine)).toBeUndefined()
    expect(parseWorkspaceSettings('] bad', engine)).toBeUndefined()
  })
})

describe('inventoryProfile', () => {
  it('reports declared, locked, mismatch, and installed state', async () => {
    const fs = createMemoryFs()
    const dir = '/h/profiles/web'
    await fs.mkdir(dir, { recursive: true })
    await fs.writeText(dir + '/package.json', JSON.stringify({
      dependencies: {
        '@deepseek-ai/dsh-mcp-client': '0.1.1-rc.2',
        'dsh-better-sidebar': '^0.14.0',
        'dsh-exact-mismatch': '1.0.0',
      },
    }))
    await fs.writeText(dir + '/pnpm-lock.yaml', LOCK)
    await fs.writeText(dir + '/pnpm-workspace.yaml', `nodeLinker: hoisted
autoInstallPeers: false
`)
    await fs.mkdir(dir + '/node_modules/@deepseek-ai', { recursive: true })
    const manifest = parseProfileManifest(await fs.readText(dir + '/package.json'), dir + '/package.json').facts
    const report = await inventoryProfile(fs, dir, manifest, engine)
    expect(report.lockfile).toBe('ok')
    expect(report.lockfileVersion).toBe('9.0')
    expect(report.nodeModules).toBe('present')
    const sidebar = report.rows.find((row) => row.name === 'dsh-better-sidebar')
    expect(sidebar?.mismatch).toBe(false)
    expect(sidebar?.locked).toBe('0.14.0')
    const missing = report.rows.find((row) => row.name === 'dsh-exact-mismatch')
    expect(missing?.mismatch).toBe(true)
    expect(missing?.locked).toBeUndefined()
    expect(missing?.installed).toBe(false)
    expect(report.workspace?.nodeLinker).toBe('hoisted')
  })

  it('reports missing lockfile and node_modules', async () => {
    const fs = createMemoryFs()
    const dir = '/h/profiles/default'
    await fs.mkdir(dir, { recursive: true })
    await fs.writeText(dir + '/package.json', JSON.stringify({ dependencies: {} }))
    const manifest = parseProfileManifest(await fs.readText(dir + '/package.json'), dir + '/package.json').facts
    const report = await inventoryProfile(fs, dir, manifest, engine)
    expect(report.lockfile).toBe('missing')
    expect(report.nodeModules).toBe('missing')
    expect(report.rows).toEqual([])
  })
})

