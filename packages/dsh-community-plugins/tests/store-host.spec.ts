import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import {
  COMMUNITY_STORE_API_PREFIX,
  createStoreRoutes,
  installCatalogProject,
  isAuthorizedLocalRequest,
  isAuthorizedMutationRequest,
  listInstalledPlugins,
  removeInstalledPlugin,
} from '../src/store-manager.ts'
import { createStoreApprovalGate, createStoreTools } from '../src/store-tools.ts'
import { parseBundledStoreSkill } from '../src/store-skill.ts'

const signal = new AbortController().signal
const SHA = '0123456789abcdef0123456789abcdef01234567'

function catalogResponse(): Response {
  return new Response(JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-16T00:00:00.000Z',
    repositories: [{
      id: 'github:42',
      repositoryId: 42,
      name: 'Example plugin',
      fullName: 'example/dsh-plugin',
      description: 'Example',
      projectType: 'plugin',
      category: 'development',
      stars: 1,
      pushedAt: '2026-08-16T00:00:00.000Z',
      validation: { overall: 'verified', label: 'Verified', sourceSha: SHA },
      install: {
        status: 'recognized',
        candidate: {
          source: 'github',
          target: 'example/dsh-plugin',
          command: `dsh plugin --profile web add github:example/dsh-plugin#${SHA}`,
          args: ['plugin', '--profile', 'web', 'add', `github:example/dsh-plugin#${SHA}`],
          executable: true,
        },
      },
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('Host plugin lifecycle', () => {
  it('re-fetches the API-owned plan by exact repository id before installation', async () => {
    const fetcher = vi.fn(async () => catalogResponse()) as unknown as typeof fetch
    const runner = vi.fn(async () => ({ stdout: 'installed', stderr: '' })) as unknown as NativeCommandRunner
    const result = await installCatalogProject('42', {
      fetcher,
      runner,
      execPath: '/node',
      cliPath: '/dsh.js',
      signal,
      listInstalled: async () => [],
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(runner).toHaveBeenCalledWith('/node', [
      '/dsh.js',
      'plugin',
      '--profile',
      'web',
      'add',
      `github:example/dsh-plugin#${SHA}`,
    ], signal)
    expect(result).toMatchObject({ action: 'install', fullName: 'example/dsh-plugin', needsRestart: true })
  })

  it('lists direct Web-profile dependencies through the native DSH command', async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify([{ dependencies: { 'dsh-a': { version: '1.0.0' } } }]),
      stderr: '',
    })) as unknown as NativeCommandRunner
    await expect(listInstalledPlugins({ runner, execPath: '/node', cliPath: '/dsh.js', signal }))
      .resolves.toEqual([{ name: 'dsh-a', version: '1.0.0' }])
    expect(runner).toHaveBeenCalledWith('/node', [
      '/dsh.js', 'plugin', '--profile', 'web', 'list', '--depth=0', '--json',
    ], signal)
  })

  it('refuses to remove anything that is not a direct dependency', async () => {
    const runner = vi.fn() as unknown as NativeCommandRunner
    await expect(removeInstalledPlugin('not-installed', {
      runner,
      execPath: '/node',
      cliPath: '/dsh.js',
      signal,
      installed: [{ name: 'dsh-a' }],
    })).rejects.toThrow(/direct dependency/i)
    expect(runner).not.toHaveBeenCalled()
  })

  it('registers package-owned lifecycle routes', () => {
    const routes = createStoreRoutes({
      fetcher: vi.fn() as unknown as typeof fetch,
      runner: vi.fn() as unknown as NativeCommandRunner,
      execPath: '/node',
      cliPath: '/dsh.js',
    })
    expect(routes.map(route => route.path)).toEqual([
      `${COMMUNITY_STORE_API_PREFIX}/plugins`,
      `${COMMUNITY_STORE_API_PREFIX}/install`,
      `${COMMUNITY_STORE_API_PREFIX}/remove`,
    ])
  })

  it('limits inventory to loopback and mutations to a matching browser origin', () => {
    const request = (remoteAddress: string, host: string, origin?: string) => ({
      socket: { remoteAddress },
      headers: { host, ...(origin === undefined ? {} : { origin }) },
    }) as unknown as IncomingMessage

    expect(isAuthorizedLocalRequest(request('127.0.0.1', 'localhost:19111'))).toBe(true)
    expect(isAuthorizedLocalRequest(request('192.168.1.4', 'localhost:19111'))).toBe(false)
    expect(isAuthorizedMutationRequest(request('127.0.0.1', 'localhost:19111', 'http://localhost:19111'))).toBe(true)
    expect(isAuthorizedMutationRequest(request('127.0.0.1', 'localhost:19111', 'https://example.com'))).toBe(false)
  })
})

describe('conversation integration', () => {
  it('defines live Store read and approved mutation tools', () => {
    const tools = createStoreTools({
      fetcher: vi.fn() as unknown as typeof fetch,
      listInstalled: async () => [],
      install: vi.fn(),
      remove: vi.fn(),
    })
    expect(tools.map(tool => tool.name)).toEqual([
      'store_search',
      'store_catalog',
      'store_details',
      'store_installed',
      'store_install',
      'store_remove',
    ])
  })

  it('parses the bundled skill as a model and user invocable definition', () => {
    const skill = parseBundledStoreSkill(`---\nname: search-dsh-store\ndescription: Search the live DSH Store.\n---\n\nUse store_search.`)
    expect(skill).toEqual({
      name: 'search-dsh-store',
      description: 'Search the live DSH Store.',
      source: 'bundled',
      content: 'Use store_search.',
    })
  })

  it('asks for approval before conversation mutations but not Store reads', async () => {
    const gate = createStoreApprovalGate()
    const next = vi.fn(async () => ({ kind: 'allow' as const }))

    await expect(gate({ name: 'store_search' } as never, next)).resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledOnce()

    next.mockClear()
    await expect(gate({ name: 'store_install', arguments: { repository_id: '42' } } as never, next))
      .resolves.toMatchObject({ kind: 'ask', reason: expect.stringContaining('42') })
    expect(next).not.toHaveBeenCalled()
  })
})
