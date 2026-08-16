/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import { en } from '../src/client/locales.ts'

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

const t: CommunityPluginsCardProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{([^}]+)\}/g, (token, name: string) => {
    const value = params?.[name]
    return value === undefined ? token : String(value)
  })
}

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
  it('searches live entries and installs only after risk acknowledgement', async () => {
    const catalogStore = new CatalogStore({
      fetcher: vi.fn(async () => new Response(JSON.stringify(apiCatalog()), { status: 200 })),
    })
    const lifecycleFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/plugins')) {
        return new Response(JSON.stringify({ ok: true, plugins: [] }), { status: 200 })
      }
      expect(String(input)).toMatch(/\/install$/)
      expect(JSON.parse(String(init?.body))).toEqual({ repositoryId: 42 })
      return new Response(JSON.stringify({ ok: true, action: 'install', needsRestart: true, output: 'installed' }), { status: 200 })
    }) as unknown as typeof fetch

    render(<CommunityPluginsCard {...cardProps(new FakeScope(), catalogStore, lifecycleFetch)} />)
    expect(await screen.findByText('Example plugin')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } })
    expect(screen.queryByText('Example plugin')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'browser tooling' } })
    expect(screen.getByText('Example plugin')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: /confirm install/i })
    expect(confirm.getAttribute('disabled')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /understand the risk/i }))
    fireEvent.click(confirm)
    expect(await screen.findByText(/restart DSH Web/i)).toBeTruthy()
    expect(lifecycleFetch).toHaveBeenCalledTimes(3)
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
