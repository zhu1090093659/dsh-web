/** @vitest-environment jsdom */

/**
 * Market card smoke contract: renders the catalog tabs and the fixed
 * editor-picks category from injected remote data, the asset install buttons
 * call the injected gateway, plugin installs go through the injected
 * pluginManager face, and likes post to the market origin. The gateway is
 * injected — the live host routes are covered by the installer core tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useSyncExternalStore, type ComponentProps } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

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

class FakeScope implements ConfigForm<MarketSettings> {
  value: MarketSettings
  base: MarketSettings
  user: Partial<MarketSettings> = {}
  writable = true
  status: ConfigFormSnapshot<MarketSettings>['status'] = 'ready'
  /** The Host answer every queued write settles with: true accepts, false refuses. */
  accepts = true
  /**
   * Whether a refusal nonetheless folds its writes into the read model — a
   * Host that refuses after applying, or a mirror that already carries the
   * value. Only the boolean answer can report such a write as failed.
   */
  refusesButFolds = false
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown): Promise<boolean> => {
    if (!this.accepts) return false
    const user = this.user as Record<string, unknown>
    user[field] = value
    this.reflect()
    return true
  })
  unset = vi.fn(async (field: string): Promise<boolean> => {
    if (!this.accepts) return false
    delete (this.user as Record<string, unknown>)[field]
    this.reflect()
    return true
  })
  constructor(value: MarketSettings, status: ConfigFormSnapshot<MarketSettings>['status'] = 'ready') {
    this.value = value
    this.base = value
    this.status = status
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /**
   * Answer one queued mutation. `false` is the Host's refusal or skipped
   * write, and it is reported as such even when the read model already shows
   * the value.
   */
  mutate = vi.fn(async (ops: readonly { op: string; path: readonly string[]; value?: unknown }[]): Promise<boolean> => {
    if (!this.accepts && !this.refusesButFolds) return false
    const user = this.user as Record<string, unknown>
    for (const op of ops) {
      const field = op.path[0] as string
      if (op.op === 'unset') delete user[field]
      else user[field] = op.value
    }
    this.reflect()
    return this.accepts
  })
  getSnapshot(): ConfigFormSnapshot<MarketSettings> {
    return {
      status: this.status,
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
  scope: ConfigForm<MarketSettings>,
  overrides: Partial<MarketCardProps> = {},
): ComponentProps<typeof MarketCard> {
  const controller = new MarketCardController(scope)
  const face = controller.inject(() => {})
  const { hooks, ...actions } = face
  const useMarketCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.marketCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.marketCard.subscribe,
      () => selector(hooks.marketCard.getSnapshot()),
    )
  // The workshop panel slot is normally injected by the framework; the card
  // test renders the shell, so a stub keeps the preset tab renderable.
  return { t, useMarketCard, renderSlot: () => null, ...actions, ...overrides } as unknown as ComponentProps<typeof MarketCard>
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
    preset: [
      { id: 'demo-preset', name: '演示预设', nameEn: 'Demo preset', author: 'dsh-web', rank: 1, version: '1.0.0', description: '社区预设' },
    ],
  },
  stats: { skin: { 'whale-song': 3 }, pet: {}, plugin: {}, preset: {} },
}

describe('MarketCard', () => {
  it('user sees the skins tab rendered from remote data with its vote count', () => {
    // Given a remote catalog whose only skin carries 3 votes
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    // When the skins tab renders
    // Then the card shows the remote skin name and the like button shows the remote vote count
    expect(screen.getByText('鲸吟').textContent).toBe('鲸吟')
    expect(screen.getByText(/赞 3/).textContent).toBe('赞 3')
  })

  it('user sees install and npm download metrics rendered apart from votes', () => {
    // Given a catalog whose skin and plugin carry install counts and whose plugin has a download figure
    const withMetrics = {
      ...REMOTE,
      stats: {
        ...REMOTE.stats,
        installs: { skin: { 'whale-song': 3 }, pet: {}, plugin: { 'dsh-tui': 12 }, preset: {} },
      },
    }
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: withMetrics, gateway: null, pluginManager: null, npmDownloads: { 'dsh-tui': 1_234 } })} />)
    // When the skins tab renders
    // Then votes and the install count stay separate figures on the skin card
    expect(screen.getByText(/赞 3/).textContent).toBe('赞 3')
    expect(screen.getByText('安装 3').textContent).toBe('安装 3')
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    // Then the plugin card carries its own install count and npm download figure
    expect(screen.getByText('安装 12').textContent).toBe('安装 12')
    expect(screen.getByText('npm 近 30 天 1.2k').textContent).toBe('npm 近 30 天 1.2k')
  })

  it('user follows skin and plugin names plus source-repository addresses to GitHub (issue 1120)', () => {
    // Given a remote catalog whose skin and plugin declare repository URLs
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    const skinName = screen.getByRole('link', { name: /鲸吟/ })
    // Then the skin name and the repository label carry the skin's declared repository
    expect(skinName.getAttribute('href')).toBe('https://github.com/zhu1090093659/dsh-web/tree/dev/packages/skins/skin-center/skins/whale-song')
    expect(screen.getByRole('link', { name: /源码仓库/ }).getAttribute('href')).toBe('https://github.com/zhu1090093659/dsh-web/tree/dev/packages/skins/skin-center/skins/whale-song')
    // When the user opens the plugins tab
    fireEvent.click(screen.getByRole('tab', { name: /插件/ }))
    // Then the plugin name carries the plugin's declared repository
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
        preset: [],
      },
      stats: { skin: {}, pet: {}, plugin: {}, preset: {} },
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
    const list = vi.fn(async () => ({ skins: ['whale-song'], pets: [], presets: [] }))
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
    const list = vi.fn(async () => ({ skins: [], pets: [], presets: [] }))
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
        preset: [],
      },
      stats: { skin: {}, pet: {}, plugin: {}, preset: {} },
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
      if (url.endsWith('/manifest/presets.json')) return Promise.resolve(good({ items: REMOTE.items.preset }))
      if (url.endsWith('/api/stats')) return Promise.resolve(good(REMOTE.stats))
      if (url.endsWith('/api/npm-downloads')) return Promise.resolve(good({ downloads: { 'dsh-tui': 120 } }))
      return Promise.reject(new Error('offline'))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MarketCard {...cardProps(new FakeScope({}), { gateway: null, pluginManager: null })} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByText('鲸吟')).toBeTruthy())
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(12)
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
        preset: [],
      },
      stats: { skin: {}, pet: {}, plugin: {}, preset: {} },
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

  it('filters presets by category and hands the filtered records to the panel', () => {
    const renderSlot = vi.fn(() => null)
    const remote = {
      items: {
        skin: [],
        pet: [],
        plugin: [],
        preset: [
          { id: 'roleplay-a', name: '角色 A', rank: 1, category: 'roleplay' },
          { id: 'roleplay-b', name: '角色 B', rank: 2, category: 'roleplay' },
          { id: 'plain-c', name: '未分类 C', rank: 3 },
        ],
      },
      stats: { skin: {}, pet: {}, plugin: {}, preset: {} },
    }
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote,
      gateway: null,
      pluginManager: null,
      renderSlot: renderSlot as unknown as ComponentProps<typeof MarketCard>['renderSlot'],
    })} />)
    fireEvent.click(screen.getByRole('tab', { name: /预设/ }))
    const slotItems = (): string[] => {
      const call = renderSlot.mock.calls.at(-1) as unknown as [string, { items: { id: string }[] }]
      return call[1].items.map((item) => item.id)
    }
    // Preset categories render one level: no second-level vocabulary exists yet.
    expect(screen.getAllByRole('button', { name: /^全部/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^角色扮演/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^其他/ })).toBeTruthy()
    expect(screen.queryByRole('group', { name: '二级分类' })).toBeNull()
    expect(slotItems()).toEqual(['roleplay-a', 'roleplay-b', 'plain-c'])
    fireEvent.click(screen.getByRole('button', { name: /^角色扮演/ }))
    expect(slotItems()).toEqual(['roleplay-a', 'roleplay-b'])
    fireEvent.click(screen.getByRole('button', { name: /^其他/ }))
    expect(slotItems()).toEqual(['plain-c'])
    // Switching tabs resets the filter, like the plugin tab does.
    fireEvent.click(screen.getByRole('tab', { name: /皮肤/ }))
    fireEvent.click(screen.getByRole('tab', { name: /预设/ }))
    expect(slotItems()).toEqual(['roleplay-a', 'roleplay-b', 'plain-c'])
  })

  it('renders the contributed preset panel with the catalog records and gateway face', () => {
    const renderSlot = vi.fn(() => null)
    const install = vi.fn(async () => ({ dest: '/home/.dsh/agent-presets/demo-preset' }))
    render(<MarketCard {...cardProps(new FakeScope({}), {
      remote: REMOTE,
      gateway: { install, list: vi.fn(async () => ({ skins: [], pets: [], presets: [] })) },
      pluginManager: null,
      renderSlot: renderSlot as unknown as ComponentProps<typeof MarketCard>['renderSlot'],
    })} />)
    fireEvent.click(screen.getByRole('tab', { name: /预设/ }))
    expect(renderSlot).toHaveBeenCalledTimes(1)
    const [key, owner, opts] = renderSlot.mock.calls[0] as unknown as [
      string,
      { items: { id: string }[]; gateway: boolean; install?: (id: string, force: boolean) => Promise<unknown>; installs: Record<string, number> },
      { entryKey: string },
    ]
    expect(key).toBe('dsh-workshop.panel')
    expect(opts.entryKey).toBe('preset')
    expect(owner.items.map((item) => item.id)).toEqual(['demo-preset'])
    expect(owner.gateway).toBe(true)
    expect(typeof owner.install).toBe('function')
    void owner.install?.('demo-preset', false)
    expect(install).toHaveBeenCalledWith('preset', 'demo-preset', false)
  })

  /** Card text of the store grid (the settings chrome renders list items too). */
  const gridCards = (): string[] => {
    const market = screen.getByRole('tablist').parentElement
    return market ? Array.from(market.querySelectorAll('li')).map((li) => li.textContent ?? '') : []
  }

  it('renders the fixed editor-picks category in editorial order with mixed kinds', () => {
    const remote = {
      ...REMOTE,
      picks: [
        { kind: 'plugin', id: 'dsh-tui' },
        { kind: 'skin', id: 'whale-song' },
        { kind: 'pet', id: 'whale-girl' },
      ],
    }
    render(<MarketCard {...cardProps(new FakeScope({}), { remote, gateway: null, pluginManager: null })} />)
    const picksTab = screen.getByRole('tab', { name: /编辑推荐/ })
    expect(picksTab.textContent).toContain('3')
    fireEvent.click(picksTab)
    // Manifest order wins over the vote/rank sorting the catalog tabs use.
    const cards = gridCards()
    expect(cards).toHaveLength(3)
    expect(cards[0]).toContain('dsh-TUI')
    expect(cards[1]).toContain('鲸吟')
    expect(cards[2]).toContain('鲸鱼娘（原版）')
    // A pinned showcase has no browsing controls.
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('group', { name: '分类筛选' })).toBeNull()
    // Every entry keeps the affordances of its own kind.
    expect(screen.getByRole('button', { name: /复制安装命令/ })).toBeTruthy()
    const likes = cards.map((text) => /赞 (\d+)/.exec(text)?.[1] ?? '')
    expect(likes).not.toContain('')
  })

  it('drops unresolvable editor picks and shows the empty state when none survive', () => {
    const remote = {
      ...REMOTE,
      picks: [
        { kind: 'preset', id: 'demo-preset' },
        { kind: 'skin', id: 'never-shipped' },
        { kind: 'plugin' },
        { kind: 'skin', id: 'whale-song' },
        { kind: 'skin', id: 'whale-song' },
      ],
    }
    render(<MarketCard {...cardProps(new FakeScope({}), { remote, gateway: null, pluginManager: null })} />)
    const picksTab = screen.getByRole('tab', { name: /编辑推荐/ })
    expect(picksTab.textContent).toContain('1')
    fireEvent.click(picksTab)
    const cards = gridCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toContain('鲸吟')
  })

  it('renders the editor-picks empty state when the manifest is missing or unresolved', () => {
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null })} />)
    fireEvent.click(screen.getByRole('tab', { name: /编辑推荐/ }))
    expect(screen.getByText('暂无编辑推荐条目。')).toBeTruthy()
  })

  it('renders the preset tab fallback when no panel plugin is installed', () => {
    const renderSlot = ((_key: string, _owner: unknown, opts: { fallback?: unknown }) => opts.fallback ?? null) as unknown as ComponentProps<typeof MarketCard>['renderSlot']
    render(<MarketCard {...cardProps(new FakeScope({}), { remote: REMOTE, gateway: null, pluginManager: null, renderSlot })} />)
    fireEvent.click(screen.getByRole('tab', { name: /预设/ }))
    expect(screen.getByText(/未安装预设中心插件/)).toBeTruthy()
  })

  it('saves the staged enable switch through one form mutation', async () => {
    const scope = new FakeScope({ enabled: true })
    const props = cardProps(scope, { remote: REMOTE, gateway: null, pluginManager: null })
    render(<MarketCard {...props} />)

    await act(async () => { props.edit('enabled', 'false') })
    await act(async () => { props.save() })

    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: false }])
    expect(scope.user).toEqual({ enabled: false })
    expect(screen.queryByText(/保存失败/)).toBeNull()
  })

  it('reports a refused settings write as a failed save, not a success', async () => {
    const scope = new FakeScope({ enabled: true })
    // The Host refuses the write but the read model already shows it: only the
    // boolean answer can tell that the save did not land.
    scope.accepts = false
    scope.refusesButFolds = true
    const props = cardProps(scope, { remote: REMOTE, gateway: null, pluginManager: null })
    render(<MarketCard {...props} />)

    await act(async () => { props.edit('enabled', 'false') })
    await act(async () => { props.save() })

    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeTruthy())
    expect(scope.mutate).toHaveBeenCalled()
    // The write is visible read-back-wise, so the failure can only come from the refusal.
    expect(scope.user).toEqual({ enabled: false })
  })

  it('keeps the draft after a refused save so the user can correct it', async () => {
    const scope = new FakeScope({ enabled: true })
    scope.accepts = false
    const props = cardProps(scope, { remote: REMOTE, gateway: null, pluginManager: null })
    render(<MarketCard {...props} />)

    await act(async () => { props.edit('enabled', 'false') })
    await act(async () => { props.save() })

    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeTruthy())
    expect(scope.user).toEqual({})
    // The off draft is still on screen and the save is retryable.
    expect(document.getElementById('settings-market-enabled')?.textContent).toBe('关')
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(false)
  })

  it('user sees market content without notExposed banner when host namespace is unexposed', async () => {
    // Given an unexposed scope whose status is unavailable
    const scope = new FakeScope({ enabled: true }, 'unavailable')
    const props = cardProps(scope, { remote: REMOTE, gateway: null, pluginManager: null })

    // When the market card renders with unexposed namespace
    render(<MarketCard {...props} />)

    // Then it renders the market catalog without displaying the notExposed banner
    expect(screen.queryByText('该设置段未暴露（宿主命名空间缺失）')).toBeNull()
    expect(screen.getByRole('tab', { name: /皮肤/ }).textContent).toContain('皮肤')
    expect(screen.getByText('鲸吟').textContent).toBe('鲸吟')
  })
})

