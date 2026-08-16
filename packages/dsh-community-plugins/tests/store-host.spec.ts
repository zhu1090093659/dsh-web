import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

function routeRequest(method: 'GET' | 'POST', body?: unknown): IncomingMessage {
  return {
    method,
    headers: {
      host: '127.0.0.1:3080',
      ...(method === 'POST'
        ? { origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }
        : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    once: vi.fn(),
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  } as unknown as IncomingMessage
}

function routeResponse(): {
  response: ServerResponse
  status: () => number
  json: () => Record<string, unknown>
} {
  let status = 0
  let body = ''
  const response = {
    set statusCode(value: number) { status = value },
    get statusCode() { return status },
    setHeader: vi.fn(),
    end: (chunk?: unknown) => { if (chunk !== undefined) body += String(chunk) },
  } as unknown as ServerResponse
  return {
    response,
    status: () => status,
    json: () => JSON.parse(body) as Record<string, unknown>,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

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
    const result = await installCatalogProject('42', 'verified', {
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

  it('installs the latest GitHub revision only after that mode is selected', async () => {
    const runner = vi.fn(async () => ({ stdout: 'installed latest', stderr: '' })) as unknown as NativeCommandRunner
    const result = await installCatalogProject('42', 'latest', {
      fetcher: vi.fn(async () => catalogResponse()) as unknown as typeof fetch,
      runner,
      execPath: '/node',
      cliPath: '/dsh.js',
      signal,
      listInstalled: async () => [],
    })

    expect(runner).toHaveBeenCalledWith('/node', [
      '/dsh.js',
      'plugin',
      '--profile',
      'web',
      'add',
      'github:example/dsh-plugin',
    ], signal)
    expect(result.output).toBe('installed latest')
  })

  it('requires an explicit mode when verified and latest GitHub plans both exist', async () => {
    await expect(installCatalogProject('42', undefined, {
      fetcher: vi.fn(async () => catalogResponse()) as unknown as typeof fetch,
      runner: vi.fn() as unknown as NativeCommandRunner,
      execPath: '/node',
      cliPath: '/dsh.js',
      signal,
      listInstalled: async () => [],
    })).rejects.toThrow(/verified.*latest/i)
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
      `${COMMUNITY_STORE_API_PREFIX}/operation`,
      `${COMMUNITY_STORE_API_PREFIX}/install`,
      `${COMMUNITY_STORE_API_PREFIX}/remove`,
    ])
  })

  it('exposes the active install stages before the native command completes', async () => {
    const command = deferred<{ stdout: string; stderr: string }>()
    const runner = vi.fn(async (_execPath: string, args: readonly string[]) => {
      if (args.includes('list')) return { stdout: JSON.stringify([{ dependencies: {} }]), stderr: '' }
      return await command.promise
    }) as unknown as NativeCommandRunner
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const routes = createStoreRoutes({
      fetcher: vi.fn(async () => catalogResponse()) as unknown as typeof fetch,
      runner,
      execPath: '/node',
      cliPath: '/dsh.js',
      logger,
    })
    const installRoute = routes.find(route => route.path.endsWith('/install'))!
    const operationRoute = routes.find(route => route.path.endsWith('/operation'))!
    const installResponse = routeResponse()
    const installing = installRoute.handler(routeRequest('POST', {
      repositoryId: 42,
      installMode: 'verified',
      operationId: 'operation-test-1',
    }), installResponse.response)

    await vi.waitFor(() => { expect(runner).toHaveBeenCalledTimes(2) })
    const progressResponse = routeResponse()
    await operationRoute.handler(routeRequest('GET'), progressResponse.response)
    expect(progressResponse.status()).toBe(200)
    expect(progressResponse.json()).toMatchObject({
      ok: true,
      operation: {
        id: 'operation-test-1',
        action: 'install',
        status: 'running',
        command: `dsh plugin --profile web add github:example/dsh-plugin#${SHA}`,
        stages: [
          { name: 'preparing', status: 'success' },
          { name: 'catalog', status: 'success' },
          { name: 'inventory', status: 'success' },
          { name: 'executing', status: 'running' },
        ],
      },
    })

    command.resolve({ stdout: 'installed 115 packages', stderr: 'one peer warning' })
    await installing
    expect(installResponse.status()).toBe(200)
    expect(installResponse.json()).toMatchObject({
      ok: true,
      operation: {
        status: 'success',
        output: expect.stringContaining('installed 115 packages'),
        stages: [{ name: 'preparing' }, { name: 'catalog' }, { name: 'inventory' }, { name: 'executing' }, { name: 'complete', status: 'success' }],
      },
    })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('operation-test-1'))
  })

  it('retains captured command output when an install fails', async () => {
    const failure = Object.assign(new Error('Command failed with exit code 1'), {
      code: 1,
      stdout: 'partial install output',
      stderr: 'registry request failed',
    })
    const runner = vi.fn(async (_execPath: string, args: readonly string[]) => {
      if (args.includes('list')) return { stdout: JSON.stringify([{ dependencies: {} }]), stderr: '' }
      throw failure
    }) as unknown as NativeCommandRunner
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const routes = createStoreRoutes({
      fetcher: vi.fn(async () => catalogResponse()) as unknown as typeof fetch,
      runner,
      execPath: '/node',
      cliPath: '/dsh.js',
      logger,
    })
    const response = routeResponse()
    await routes.find(route => route.path.endsWith('/install'))!.handler(routeRequest('POST', {
      repositoryId: 42,
      installMode: 'verified',
      operationId: 'operation-test-2',
    }), response.response)

    expect(response.status()).toBe(502)
    expect(response.json()).toMatchObject({
      ok: false,
      output: expect.stringContaining('registry request failed'),
      operation: {
        id: 'operation-test-2',
        status: 'error',
        output: expect.stringContaining('partial install output'),
        stages: expect.arrayContaining([expect.objectContaining({ name: 'executing', status: 'error' })]),
      },
    })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('registry request failed'))
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
    const skill = parseBundledStoreSkill(
      `---\nname: search-dsh-store\ndescription: Search the live DSH Store.\n---\n\nUse store_search.`,
      'Ask the user to choose verified or latest.',
    )
    expect(skill).toEqual({
      name: 'search-dsh-store',
      description: 'Search the live DSH Store.',
      source: 'bundled',
      content: 'Use store_search.\n\nAsk the user to choose verified or latest.',
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
