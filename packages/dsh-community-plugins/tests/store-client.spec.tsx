/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => {
        value = next
        for (const listener of listeners) listener()
      },
      update: (mutator: (draft: never) => void) => {
        mutator(value as never)
        for (const listener of listeners) listener()
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  },
}))

import { CatalogStore } from '../src/client/catalog-store.ts'
import {
  CommunityPluginsCard,
  CommunityPluginsCardController,
  type CommunityPluginsCardProps,
  type CommunityPluginsSettings,
} from '../src/client/CommunityPluginsCard.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function apiCatalog() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-16T00:00:00.000Z',
    stats: { fetched: 1, verified: 1, categories: { development: 1 } },
    repositories: [{
      id: 'github:42',
      repositoryId: 42,
      name: 'Example plugin',
      fullName: 'example/dsh-plugin',
      description: 'Focused browser tooling for DSH.',
      projectType: 'plugin',
      category: 'development',
      stars: 12,
      pushedAt: '2026-08-16T00:00:00.000Z',
      validation: {
        overall: 'verified',
        label: 'Verified',
        tone: 'success',
        sourceSha: '0123456789abcdef0123456789abcdef01234567',
        stages: {
          discovery: { status: 'passed' },
          identification: { status: 'passed' },
          structure: { status: 'running' },
          sandbox: { status: 'pending' },
        },
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
    }],
  }
}

class FakeScope implements SettingsScope<CommunityPluginsSettings> {
  private listeners = new Set<() => void>()
  constructor(public value: CommunityPluginsSettings = {}) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot(): SettingsScopeSnapshot<CommunityPluginsSettings> {
    return {
      status: 'ready',
      writable: true,
      value: this.value,
      base: { enabled: true },
      user: this.value,
      revision: 1,
      mode: 'host',
    }
  }
  set = vi.fn(async (field: string, value: unknown) => {
    this.value = { ...this.value, [field]: value }
    for (const listener of this.listeners) listener()
  })
  unset = vi.fn(async (field: string) => {
    const next = { ...this.value }
    delete (next as Record<string, unknown>)[field]
    this.value = next
    for (const listener of this.listeners) listener()
  })
}

function translator(dictionary: Record<string, string>): CommunityPluginsCardProps['t'] {
  return (key, params) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{([^}]+)\}/g, (token, name: string) => {
      const value = params?.[name]
      return value === undefined ? token : String(value)
    })
  }
}

const t = translator(en)
const tZh = translator(zh)

function cardProps(
  scope: SettingsScope<CommunityPluginsSettings>,
  catalogStore: CatalogStore,
  lifecycleFetch: typeof fetch,
): ComponentProps<typeof CommunityPluginsCard> {
  const controller = new CommunityPluginsCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const useCommunityPluginsCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.communityPluginsCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.communityPluginsCard.subscribe,
      () => selector(hooks.communityPluginsCard.getSnapshot()),
    )
  return { t, catalogStore, lifecycleFetch, useCommunityPluginsCard, ...actions }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('CatalogStore', () => {
  it('loads the versioned API and keeps the last good catalog after refresh failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(apiCatalog()), { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    const store = new CatalogStore({ fetcher })
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', catalog: { repositories: [{ repositoryId: 42 }] } })
    await store.load({ force: true })
    expect(store.getSnapshot()).toMatchObject({ status: 'error', catalog: { repositories: [{ repositoryId: 42 }] } })
  })
})

describe('API-backed Community Plugins UI', () => {
  it('keeps localized category chips, the category select, and the inline save action synchronized', async () => {
    const scope = new FakeScope()
    const catalogStore = new CatalogStore({
      fetcher: vi.fn(async () => new Response(JSON.stringify(apiCatalog()), { status: 200 })),
    })
    const lifecycleFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, plugins: [] }), { status: 200 })) as unknown as typeof fetch
    const props = cardProps(scope, catalogStore, lifecycleFetch)
    render(<CommunityPluginsCard {...props} t={tZh} />)

    const categorySelect = await screen.findByRole('combobox', { name: '分类' }) as HTMLSelectElement
    expect(screen.getByRole('option', { name: '开发工具' })).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: '搜索名称、作者、描述或标签' })
    const sortSelect = screen.getByRole('combobox', { name: '排序' })
    expect(search.parentElement).toBe(categorySelect.parentElement)
    expect(sortSelect.parentElement).toBe(categorySelect.parentElement)

    const development = screen.getByRole('button', { name: '开发工具' })
    expect(development.textContent).toBe('开发工具')
    fireEvent.click(development)
    expect(categorySelect.value).toBe('development')
    expect(development.getAttribute('aria-pressed')).toBe('true')

    const categoryToggle = screen.getByRole('button', { name: '展开全部分类' })
    expect(categoryToggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(categoryToggle)
    expect(screen.getByRole('button', { name: '收起全部分类' }).getAttribute('aria-expanded')).toBe('true')

    const verifiedOnly = screen.getByRole('checkbox', { name: '只看已验证' })
    const installedOnly = screen.getByRole('checkbox', { name: '只看已安装' })
    expect(verifiedOnly.parentElement?.parentElement).toBe(installedOnly.parentElement?.parentElement)

    const enabledSelect = screen.getByRole('combobox', { name: '启用社区插件市场' })
    const save = screen.getByRole('button', { name: '保存' })
    expect(screen.getAllByRole('button', { name: '保存' })).toHaveLength(1)
    expect(enabledSelect.parentElement).toBe(save.parentElement?.parentElement)
    fireEvent.change(enabledSelect, { target: { value: 'true' } })
    expect(save.getAttribute('disabled')).toBeNull()
    fireEvent.click(save)
    await waitFor(() => { expect(scope.set).toHaveBeenCalledWith('enabled', true) })
  })

  it('searches live entries and installs only after risk acknowledgement', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const catalogStore = new CatalogStore({
      fetcher: vi.fn(async () => new Response(JSON.stringify(apiCatalog()), { status: 200 })),
    })
    const lifecycleFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/plugins')) {
        return new Response(JSON.stringify({ ok: true, plugins: [] }), { status: 200 })
      }
      if (String(input).endsWith('/operation')) {
        return new Response(JSON.stringify({ ok: true, operation: null }), { status: 200 })
      }
      expect(String(input)).toMatch(/\/install$/)
      expect(JSON.parse(String(init?.body))).toMatchObject({ repositoryId: 42, installMode: 'latest', operationId: expect.any(String) })
      return new Response(JSON.stringify({ ok: true, action: 'install', needsRestart: true, output: 'installed' }), { status: 200 })
    }) as unknown as typeof fetch

    const view = render(<CommunityPluginsCard {...cardProps(new FakeScope(), catalogStore, lifecycleFetch)} />)
    expect(await screen.findByText('Example plugin')).toBeTruthy()
    expect(screen.getByLabelText('12 stars')).toBeTruthy()
    expect(screen.getByLabelText('Validation status: Verified')).toBeTruthy()
    expect([...view.container.querySelectorAll('[data-validation-step]')].map(step => step.getAttribute('data-status')))
      .toEqual(['passed', 'passed', 'running', 'pending'])
    const verifiedCommand = 'dsh plugin --profile web add github:example/dsh-plugin#0123456789abcdef0123456789abcdef01234567'
    expect(screen.getByText(verifiedCommand)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /copy install command/i }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(verifiedCommand) })
    expect(screen.getByRole('button', { name: /install command copied/i })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    expect(screen.queryByText('Example plugin')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'browser tooling' } })
    expect(screen.getByText('Example plugin')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: /confirm install/i })
    expect(confirm.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('radio', { name: /verified version/i })).toBeTruthy()
    expect(screen.getByText(/choose the verified or latest version first/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /latest version/i }))
    expect(screen.getByText('dsh plugin --profile web add github:example/dsh-plugin')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /understand the risk/i }))
    fireEvent.click(confirm)
    expect(await screen.findByText(/restart DSH Web/i)).toBeTruthy()
    expect(lifecycleFetch.mock.calls.filter(([input]) => String(input).endsWith('/install'))).toHaveLength(1)
  })

  it('shows lifecycle stages while an installation is still running', async () => {
    const installResponse = deferred<Response>()
    let operationId = ''
    const operation = () => ({
      id: operationId,
      action: 'install',
      status: 'running',
      target: 'github:example/dsh-plugin',
      command: `dsh plugin --profile web add github:example/dsh-plugin#${'0123456789abcdef0123456789abcdef01234567'}`,
      startedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:01.000Z',
      output: '',
      stages: [
        { name: 'preparing', status: 'success', startedAt: '2026-08-17T00:00:00.000Z', finishedAt: '2026-08-17T00:00:00.100Z' },
        { name: 'catalog', status: 'success', startedAt: '2026-08-17T00:00:00.100Z', finishedAt: '2026-08-17T00:00:00.200Z' },
        { name: 'inventory', status: 'success', startedAt: '2026-08-17T00:00:00.200Z', finishedAt: '2026-08-17T00:00:00.300Z' },
        { name: 'executing', status: 'running', startedAt: '2026-08-17T00:00:00.300Z' },
      ],
    })
    const lifecycleFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/plugins')) return new Response(JSON.stringify({ ok: true, plugins: [] }), { status: 200 })
      if (url.endsWith('/operation')) return new Response(JSON.stringify({ ok: true, operation: operationId === '' ? null : operation() }), { status: 200 })
      operationId = String((JSON.parse(String(init?.body)) as { operationId: string }).operationId)
      return await installResponse.promise
    }) as unknown as typeof fetch
    const catalogStore = new CatalogStore({
      fetcher: vi.fn(async () => new Response(JSON.stringify(apiCatalog()), { status: 200 })),
    })
    render(<CommunityPluginsCard {...cardProps(new FakeScope(), catalogStore, lifecycleFetch)} />)

    fireEvent.click(await screen.findByRole('button', { name: /^install$/i }))
    fireEvent.click(screen.getByRole('radio', { name: /verified version/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /understand the risk/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm install/i }))

    expect(await screen.findByText(/operation progress/i)).toBeTruthy()
    expect(await screen.findByText(/reading store catalog/i)).toBeTruthy()
    expect(screen.getByText(/checking installed plugins/i)).toBeTruthy()
    expect(screen.getByText(/running install command/i)).toBeTruthy()
    expect(screen.getByText(operation().command)).toBeTruthy()

    const completed = { ...operation(), status: 'success', output: 'installed 115 packages', stages: [...operation().stages.map(stage => ({ ...stage, status: 'success' })), { name: 'complete', status: 'success' }] }
    installResponse.resolve(new Response(JSON.stringify({ ok: true, needsRestart: true, output: completed.output, operation: completed }), { status: 200 }))
    expect(await screen.findByText(/restart DSH Web/i)).toBeTruthy()
    expect(screen.getByText(/installed 115 packages/i)).toBeTruthy()
    await waitFor(() => {
      const operationCalls = lifecycleFetch.mock.calls.filter(([input]) => String(input).endsWith('/operation')).length
      expect(operationCalls).toBeGreaterThan(0)
    })
  })

  it('shows update and remove actions for a matched direct dependency', async () => {
    const catalogStore = new CatalogStore({
      fetcher: vi.fn(async () => new Response(JSON.stringify(apiCatalog()), { status: 200 })),
    })
    const lifecycleFetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/plugins')) {
        return new Response(JSON.stringify({
          ok: true,
          plugins: [{
            name: 'dsh-plugin',
            from: 'github:example/dsh-plugin#1111111111111111111111111111111111111111',
          }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, needsRestart: true }), { status: 200 })
    }) as unknown as typeof fetch
    render(<CommunityPluginsCard {...cardProps(new FakeScope(), catalogStore, lifecycleFetch)} />)
    expect(await screen.findByRole('button', { name: /^update$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /remove example plugin/i })).toBeTruthy()
  })
})
