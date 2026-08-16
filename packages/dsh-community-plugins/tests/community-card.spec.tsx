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

import {
  CommunityPluginsCard,
  CommunityPluginsCardController,
  type CommunityPluginsCardProps,
  type CommunityPluginsSettings,
} from '../src/client/CommunityPluginsCard.tsx'
import { CatalogStore } from '../src/client/catalog-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: CommunityPluginsCardProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{([^}]+)\}/g, (token, name: string) => {
    const value = params?.[name]
    return value === undefined ? token : String(value)
  })
}

class FakeScope implements SettingsScope<CommunityPluginsSettings> {
  private listeners = new Set<() => void>()
  readonly base: CommunityPluginsSettings = { enabled: true }
  user: Partial<CommunityPluginsSettings>
  value: CommunityPluginsSettings

  constructor(value: CommunityPluginsSettings = {}) {
    this.user = value
    this.value = { ...this.base, ...value }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): SettingsScopeSnapshot<CommunityPluginsSettings> {
    return {
      status: 'ready',
      writable: true,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }

  set = vi.fn(async (field: string, value: unknown) => {
    this.user = { ...this.user, [field]: value }
    this.reflect()
  })

  unset = vi.fn(async (field: string) => {
    const next = { ...this.user }
    delete (next as Record<string, unknown>)[field]
    this.user = next
    this.reflect()
  })

  private reflect(): void {
    this.value = { ...this.base, ...this.user }
    for (const listener of this.listeners) listener()
  }
}

function catalogResponse(): Response {
  return new Response(JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-16T00:00:00.000Z',
    stats: { fetched: 1, verified: 0, categories: { development: 1 } },
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
      validation: null,
      install: null,
    }],
  }), { status: 200 })
}

function cardProps(
  scope: SettingsScope<CommunityPluginsSettings>,
  catalogFetch = vi.fn(async () => catalogResponse()),
  lifecycleFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, plugins: [] }), { status: 200 })),
): ComponentProps<typeof CommunityPluginsCard> {
  const controller = new CommunityPluginsCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const useCommunityPluginsCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.communityPluginsCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.communityPluginsCard.subscribe,
      () => selector(hooks.communityPluginsCard.getSnapshot()),
    )
  return {
    t,
    catalogStore: new CatalogStore({ fetcher: catalogFetch as unknown as typeof fetch }),
    lifecycleFetch: lifecycleFetch as unknown as typeof fetch,
    useCommunityPluginsCard,
    ...actions,
  }
}

describe('CommunityPluginsCard', () => {
  it('keeps the existing first-level card open while loading entries from the API', async () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope())} />)
    expect(screen.getByText('Community Plugins')).toBeTruthy()
    expect(await screen.findByRole('link', { name: 'Example plugin' })).toHaveProperty(
      'href',
      'https://dshmk.com/plugins/42',
    )
  })

  it('hides the Store without requesting API data when the existing switch is off', () => {
    const catalogFetch = vi.fn(async () => catalogResponse())
    const lifecycleFetch = vi.fn(async () => new Response('{}'))
    render(<CommunityPluginsCard {...cardProps(new FakeScope({ enabled: false }), catalogFetch, lifecycleFetch)} />)
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByText('The community plugin store is turned off.')).toBeTruthy()
    expect(catalogFetch).not.toHaveBeenCalled()
    expect(lifecycleFetch).not.toHaveBeenCalled()
  })

  it('continues to persist the enable switch through community-plugins.enabled', async () => {
    const scope = new FakeScope()
    render(<CommunityPluginsCard {...cardProps(scope)} />)
    fireEvent.change(screen.getByLabelText('Enable the community plugin store'), { target: { value: 'false' } })
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => { expect(scope.set).toHaveBeenCalledWith('enabled', false) })
  })
})
