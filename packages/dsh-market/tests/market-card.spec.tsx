/** @vitest-environment jsdom */

/**
 * Market card smoke contract: renders the three tabs from injected remote
 * data, the asset install buttons call the injected gateway, plugin installs
 * go through the injected pluginManager face, and likes post to the market
 * origin. The gateway is injected — the live host routes are covered by the
 * installer core tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useSyncExternalStore, type ComponentProps } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  return {
    Button: (props: Record<string, unknown>) =>
      create('button', { disabled: props['disabled'], onClick: props['onClick'], className: props['className'] }, props['children']),
    Modal: (props: Record<string, unknown>) =>
      props['open'] === true ? create('div', { role: 'dialog' }, props['title'], props['children']) : null,
  }
})

import {
  MarketCard,
  MarketCardController,
  type MarketCardProps,
  type MarketSettings,
} from '../src/client/MarketCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const t: MarketCardProps['t'] = (key, params) => {
  const text = (zh as Record<string, string>)[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

class FakeScope implements SettingsScope<MarketSettings> {
  value: MarketSettings
  base: MarketSettings
  user: Partial<MarketSettings> = {}
  writable = true
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => {
    (this.user as Record<string, unknown>)[field] = value
    this.reflect()
  })
  unset = vi.fn(async (field: string) => {
    delete (this.user as Record<string, unknown>)[field]
    this.reflect()
  })
  constructor(value: MarketSettings) {
    this.value = value
    this.base = value
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async mutate(): Promise<void> {
    return undefined
  }
  getSnapshot(): SettingsScopeSnapshot<MarketSettings> {
    return {
      status: 'ready',
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
    for (const listener of this.listeners) listener()
  }
}

function cardProps(
  scope: SettingsScope<MarketSettings>,
  overrides: Partial<MarketCardProps> = {},
): ComponentProps<typeof MarketCard> {
  const controller = new MarketCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const useMarketCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.marketCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.marketCard.subscribe,
      () => selector(hooks.marketCard.getSnapshot()),
    )
  return { t, useMarketCard, ...actions, ...overrides } as unknown as ComponentProps<typeof MarketCard>
}

const REMOTE = {
  items: {
    skin: [
      { id: 'whale-song', name: '鲸吟', nameEn: 'Whale Song', author: 'dsh-web', rank: 1, preview: { light: 'a.png' }, description: '深海', repo: 'https://github.com/zhu1090093659/dsh-web/tree/dev/packages/skins/skin-center/skins/whale-song' },
    ],
    pet: [
      { id: 'whale-girl', displayName: '鲸鱼娘（原版）', author: '', rank: 1, previews: ['idle.gif'] },
    ],
    plugin: [
      { id: 'dsh-tui', name: 'dsh-TUI', nameEn: 'dsh-TUI', author: 'ccch1mneyyy', rank: 1, repo: 'https://github.com/ccch1mneyyy/dsh-TUI', npm: 'dsh-tui', category: 'ui', description: '终端' },
    ],
  },
  stats: { skin: { 'whale-song': 3 }, pet: {}, plugin: {} },
}

describe('MarketCard', () => {
  it('renders the skins tab with remote data and votes', () => {
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    expect(screen.getByText('鲸吟')).toBeTruthy()
    expect(screen.getByText(/赞 3/)).toBeTruthy()
  })

  it('renders install and npm download metrics separately from votes', () => {
    const withMetrics = {
      ...REMOTE,
      stats: {
        ...REMOTE.stats,
        installs: { skin: { 'whale-song': 3 }, pet: {}, plugin: { 'dsh-tui': 12 } },
      },
    }
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: withMetrics, gateway: null, pluginManager: null, npmDownloads: { 'dsh-tui': 1_234 } })} />)
    expect(screen.getByText(/赞 3/)).toBeTruthy()
    expect(screen.getByText('安装 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    expect(screen.getByText('安装 12')).toBeTruthy()
    expect(screen.getByText('npm 近 30 天 1.2k')).toBeTruthy()
  })

  it('links skin and plugin names plus source-repository addresses to GitHub (issue 1120)', () => {
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    const skinName = screen.getByRole('link', { name: /鲸吟/ })
    expect(skinName.getAttribute('href')).toBe('https://github.com/zhu1090093659/dsh-web/tree/dev/packages/skins/skin-center/skins/whale-song')
    expect(screen.getByRole('link', { name: /源码仓库/ }).getAttribute('href')).toBe('https://github.com/zhu1090093659/dsh-web/tree/dev/packages/skins/skin-center/skins/whale-song')
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    expect(screen.getByRole('link', { name: /dsh-TUI/ }).getAttribute('href')).toBe('https://github.com/ccch1mneyyy/dsh-TUI')
  })

  it('makes the dsh-market.com domain in the header description clickable', () => {
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    const domain = screen.getByRole('link', { name: 'dsh-market.com' })
    expect(domain.getAttribute('href')).toBe('https://dsh-market.com')
  })

  it('leaves items without a declared source URL link-free', () => {
    const plain = {
      items: {
        skin: [{ id: 'plain-skin', name: '素色皮肤', rank: 1, preview: { light: 'a.png' } }],
        pet: [],
        plugin: [],
      },
      stats: { skin: {}, pet: {}, plugin: {} },
    }
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: plain, gateway: null, pluginManager: null })} />)
    expect(screen.queryByRole('link', { name: /素色皮肤/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /源码仓库/ })).toBeNull()
  })

  it('switches tabs and shows plugins with a repo link and install command', () => {
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    expect(screen.getByText('dsh-TUI')).toBeTruthy()
    expect(screen.getByRole('link', { name: /源码仓库/ }).getAttribute('href')).toBe('https://github.com/ccch1mneyyy/dsh-TUI')
  })

  it('calls the gateway install for skins (loopback) and marks installed', async () => {
    const install = vi.fn(async () => ({ dest: '/home/.dsh/skins/whale-song' }))
    const list = vi.fn(async () => ({ skins: ['whale-song'], pets: [] }))
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: REMOTE,
      gateway: { install, list },
      pluginManager: null,
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /一键安装/ }))
    await waitFor(() => expect(install).toHaveBeenCalledWith('skin', 'whale-song', false))
    await waitFor(() => expect(screen.getAllByText('已安装').length).toBeGreaterThan(0))
  })

  it('surfaces the conflict dialog and retries with force', async () => {
    const install = vi.fn(async () => { throw { code: 'conflict' } })
    const list = vi.fn(async () => ({ skins: [], pets: [] }))
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: REMOTE,
      gateway: { install, list },
      pluginManager: null,
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /一键安装/ }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /覆盖并安装/ }))
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2))
    expect(install).toHaveBeenLastCalledWith('skin', 'whale-song', true)
  })

  it('installs plugins through the pluginManager face when loopback', async () => {
    const install = vi.fn(async () => ({ id: 'dsh-tui', name: 'dsh-TUI', version: '1.0.0', source: { kind: 'npm', spec: 'dsh-tui' }, installedAt: '', enabled: true }))
    const list = vi.fn(async () => [])
    const face = { isLoopback: true, install, list, uninstall: vi.fn(), status: vi.fn(), onChange: vi.fn((): (() => void) => () => {}), failures: vi.fn(), setEnabled: vi.fn() }
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: REMOTE,
      gateway: null,
      pluginManager: face as unknown as import('../src/client/plugin-manager-bridge.ts').PluginManagerService,
    })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    fireEvent.click(screen.getByRole('button', { name: /一键安装/ }))
    await waitFor(() => expect(install).toHaveBeenCalledWith('dsh-tui'))
  })

  it('refuses an invalid manifest spec: shows an error and never calls pluginManager.install', async () => {
    const install = vi.fn(async () => ({ id: 'evil-plugin', name: 'evil', version: '1.0.0', source: { kind: 'git' as const, spec: '' }, installedAt: '', enabled: true }))
    const list = vi.fn(async () => [])
    const face = { isLoopback: true, install, list, uninstall: vi.fn(), status: vi.fn(), onChange: vi.fn((): (() => void) => () => {}), failures: vi.fn(), setEnabled: vi.fn() }
    const poisoned = {
      items: {
        skin: [],
        pet: [],
        plugin: [{ id: 'evil-plugin', name: 'evil', rank: 1, repo: 'ssh://git@evil.example/repo.git' }],
      },
      stats: { skin: {}, pet: {}, plugin: {} },
    }
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: poisoned,
      gateway: null,
      pluginManager: face as unknown as import('../src/client/plugin-manager-bridge.ts').PluginManagerService,
    })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    fireEvent.click(screen.getByRole('button', { name: /一键安装/ }))
    await waitFor(() => expect(screen.getByText(/安装来源无效/)).toBeTruthy())
    expect(install).not.toHaveBeenCalled()
  })

  it('hides the install buttons for remote browsers (gateway null, face not loopback)', () => {
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    expect(screen.queryByRole('button', { name: /一键安装/ })).toBeNull()
  })
  it('rolls back an optimistic like when Turnstile fails', async () => {
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: REMOTE,
      gateway: null,
      pluginManager: null,
      turnstileToken: async () => { throw new Error('captcha unavailable') },
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /赞 3/ }))
    expect(screen.getByRole('button', { name: /赞 4/ })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: /赞 3/ })).toBeTruthy())
    expect(screen.getByText('点赞失败')).toBeTruthy()
  })

  it('sends a Turnstile token and never a bypass header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, votes: 9 })))
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: REMOTE,
      gateway: null,
      pluginManager: null,
      turnstileToken: async () => 'verified-token',
    })} />)
    fireEvent.click(screen.getByRole('button', { name: /赞 3/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/api/like')
    const headers = new Headers(init.headers)
    expect(headers.has('x-dsh-market-client')).toBe(false)
    const body = JSON.parse(String(init.body)) as { turnstile_token?: string }
    expect(body.turnstile_token).toBe('verified-token')
  })

  it('retries a failed live manifest load', async () => {
    const good = (value: unknown) => new Response(JSON.stringify(value))
    let calls = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      calls += 1
      if (calls <= 5) return Promise.reject(new Error('offline'))
      if (url.endsWith('/manifest/skins.json')) return Promise.resolve(good({ items: REMOTE.items.skin }))
      if (url.endsWith('/manifest/pets.json')) return Promise.resolve(good({ items: REMOTE.items.pet }))
      if (url.endsWith('/manifest/plugins.json')) return Promise.resolve(good({ items: REMOTE.items.plugin }))
      if (url.endsWith('/api/stats')) return Promise.resolve(good(REMOTE.stats))
      if (url.endsWith('/api/npm-downloads')) return Promise.resolve(good({ downloads: { 'dsh-tui': 120 } }))
      return Promise.reject(new Error('offline'))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MarketCard {...cardProps(new FakeScope({}), { gateway: null, pluginManager: null })} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByText('鲸吟')).toBeTruthy())
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(10)
  })

  it('does not report success when copy fallback fails (issue #1091)', async () => {
    const execMock = vi.fn().mockReturnValue(false)
    document.execCommand = execMock
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    const copyBtn = screen.getByRole('button', { name: /复制安装命令/ })
    fireEvent.click(copyBtn)
    expect(execMock).toHaveBeenCalledWith('copy')
    expect(screen.queryByText('已复制')).toBeNull()
    expect(screen.getByRole('button', { name: /复制安装命令/ })).toBeTruthy()
  })

  it('reports success when copy fallback succeeds', async () => {
    const execMock = vi.fn().mockReturnValue(true)
    document.execCommand = execMock
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    const copyBtn = screen.getByRole('button', { name: /复制安装命令/ })
    fireEvent.click(copyBtn)
    expect(execMock).toHaveBeenCalledWith('copy')
    await waitFor(() => expect(screen.getByText('已复制')).toBeTruthy())
  })

  it('handles clipboard.writeText rejection with fallback result', async () => {
    const execMock = vi.fn().mockReturnValue(false)
    document.execCommand = execMock
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('permission denied')) },
      configurable: true,
    })
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    const copyBtn = screen.getByRole('button', { name: /复制安装命令/ })
    fireEvent.click(copyBtn)
    await waitFor(() => expect(execMock).toHaveBeenCalledWith('copy'))
    expect(screen.queryByText('已复制')).toBeNull()
  })
  it('filters plugins by category and second-level subcategory', () => {
    const remote = {
      items: {
        skin: [],
        pet: [],
        plugin: [
          { id: 'p-terminal', name: '终端 A', rank: 1, repo: 'https://github.com/x/p-terminal', category: 'ui', subcategory: 'terminal' },
          { id: 'p-chat', name: '对话 B', rank: 2, repo: 'https://github.com/x/p-chat', category: 'ui', subcategory: 'chat' },
          { id: 'p-dev', name: '工具 C', rank: 3, repo: 'https://github.com/x/p-dev', category: 'tools', subcategory: 'dev' },
        ],
      },
      stats: { skin: {}, pet: {}, plugin: {} },
    }
    render(<MarketCard {...cardProps(new FakeScope({}), { remote, gateway: null, pluginManager: null })} />)
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    // Category chips show labels and counts; the two-level row appears only after a category is picked.
    expect(screen.getAllByRole('button', { name: /^全部/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^界面/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^工具/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^界面/ }))
    expect(screen.getAllByRole('button', { name: /^全部/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^终端界面/ })).toBeTruthy()
    expect(screen.queryByText('工具 C')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^终端界面/ }))
    expect(screen.getByText('终端 A')).toBeTruthy()
    expect(screen.queryByText('对话 B')).toBeNull()
    // Card badges show localized labels instead of raw ids.
    expect(screen.getAllByText('界面').length).toBeGreaterThan(0)
    expect(screen.getAllByText('终端界面').length).toBeGreaterThan(0)
    // Switching tabs resets both filter levels.
    fireEvent.click(screen.getByRole('tab', { name: /皮肤/ }))
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    expect(screen.getByText('工具 C')).toBeTruthy()
  })
})

