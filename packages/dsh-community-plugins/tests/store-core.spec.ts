import { describe, expect, it } from 'vitest'
import {
  buildInstallPlan,
  filterCatalogRepositories,
  getInstallModes,
  isUpdateAvailable,
  matchInstalledPlugin,
  parseCatalog,
  parseInstalledPluginList,
  type CatalogRepository,
} from '../src/core/store-catalog.ts'

function repository(overrides: Partial<CatalogRepository> = {}): CatalogRepository {
  return {
    id: 'github:42',
    repositoryId: 42,
    name: 'Example plugin',
    fullName: 'example/dsh-plugin',
    description: 'A focused DSH plugin.',
    projectType: 'plugin',
    category: 'development',
    stars: 12,
    pushedAt: '2026-08-16T00:00:00.000Z',
    validation: {
      overall: 'verified',
      label: 'Verified',
      sourceSha: '0123456789abcdef0123456789abcdef01234567',
    },
    install: {
      status: 'recognized',
      candidate: {
        source: 'github',
        target: 'example/dsh-plugin',
        command: 'dsh plugin --profile web add github:example/dsh-plugin#0123456789abcdef0123456789abcdef01234567',
        args: [
          'plugin',
          '--profile',
          'web',
          'add',
          'github:example/dsh-plugin#0123456789abcdef0123456789abcdef01234567',
        ],
        executable: true,
      },
    },
    ...overrides,
  }
}

describe('API catalog contract', () => {
  it('accepts the versioned API response and rejects malformed bodies', () => {
    const catalog = parseCatalog({
      schemaVersion: 1,
      generatedAt: '2026-08-16T00:00:00.000Z',
      stats: { fetched: 1, verified: 1 },
      repositories: [repository()],
    })
    expect(catalog.repositories).toHaveLength(1)
    expect(() => parseCatalog({ schemaVersion: 2, repositories: [] })).toThrow(/format/i)
    expect(() => parseCatalog({ schemaVersion: 1, repositories: 'not-an-array' })).toThrow(/format/i)
  })

  it('offers verified and latest plans for a verified GitHub project', () => {
    expect(getInstallModes(repository())).toEqual(['verified', 'latest'])
    expect(buildInstallPlan(repository(), 'verified')).toEqual({
      source: 'github',
      target: 'example/dsh-plugin',
      command: 'dsh plugin --profile web add github:example/dsh-plugin#0123456789abcdef0123456789abcdef01234567',
      args: [
        'plugin',
        '--profile',
        'web',
        'add',
        'github:example/dsh-plugin#0123456789abcdef0123456789abcdef01234567',
      ],
      executable: true,
    })
    expect(buildInstallPlan(repository(), 'latest')).toEqual({
      source: 'github',
      target: 'example/dsh-plugin',
      command: 'dsh plugin --profile web add github:example/dsh-plugin',
      args: [
        'plugin',
        '--profile',
        'web',
        'add',
        'github:example/dsh-plugin',
      ],
      executable: true,
    })

    const wrongSha = repository({
      install: {
        status: 'recognized',
        candidate: {
          source: 'github',
          target: 'example/dsh-plugin',
          command: 'ignored',
          args: ['plugin', '--profile', 'web', 'add', 'github:example/dsh-plugin#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
          executable: true,
        },
      },
    })
    expect(buildInstallPlan(wrongSha, 'verified')).toBeNull()
    expect(buildInstallPlan(wrongSha, 'latest')?.args[4]).toBe('github:example/dsh-plugin')
  })

  it('rejects shell-like and cross-repository install instructions', () => {
    const malicious = repository({
      install: {
        status: 'recognized',
        candidate: {
          source: 'github',
          target: 'attacker/other',
          command: 'dsh plugin --profile web add github:attacker/other && curl bad',
          args: ['plugin', '--profile', 'web', 'add', 'github:attacker/other'],
          executable: true,
        },
      },
    })
    expect(buildInstallPlan(malicious)).toBeNull()
  })
})

describe('installed plugin comparison', () => {
  it('parses direct Web-profile dependencies and matches npm packages', () => {
    const installed = parseInstalledPluginList(JSON.stringify([{
      dependencies: {
        '@example/dsh-plugin': {
          from: '@example/dsh-plugin@1.0.0',
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/@example/dsh-plugin/-/dsh-plugin-1.0.0.tgz',
        },
      },
    }]))
    const npmRepository = repository({
      version: '1.1.0',
      install: {
        status: 'recognized',
        candidate: {
          source: 'npm',
          target: '@example/dsh-plugin',
          command: 'dsh plugin --profile web add @example/dsh-plugin',
          args: ['plugin', '--profile', 'web', 'add', '@example/dsh-plugin'],
          executable: true,
        },
      },
    })
    const match = matchInstalledPlugin(npmRepository, installed)
    expect(match?.name).toBe('@example/dsh-plugin')
    expect(isUpdateAvailable(npmRepository, match)).toBe(true)
  })

  it('detects a changed verified GitHub revision', () => {
    const installed = [{
      name: 'dsh-plugin',
      from: 'github:example/dsh-plugin#1111111111111111111111111111111111111111',
    }]
    const match = matchInstalledPlugin(repository(), installed)
    expect(match).not.toBeNull()
    expect(isUpdateAvailable(repository(), match)).toBe(true)
  })
})

describe('catalog filtering', () => {
  it('searches metadata, applies facets, and puts updates first', () => {
    const update = { ...repository(), installed: true, updateAvailable: true }
    const other = repository({
      id: 'github:43',
      repositoryId: 43,
      name: 'Other tool',
      fullName: 'example/other',
      category: 'data',
      stars: 100,
    })
    expect(filterCatalogRepositories([other, update], {
      query: 'focused plugin',
      category: 'development',
      sort: 'recommended',
      verifiedOnly: true,
      installedOnly: false,
    })).toEqual([update])
  })
})
