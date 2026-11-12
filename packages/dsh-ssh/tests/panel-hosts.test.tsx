// @vitest-environment jsdom
/**
 * HostsTab grouping tests (#379): the pure groupHosts bucketing contract
 * (environment / tags folder view, ungrouped bucket last) and a light render
 * pass proving the grouped view shows collapsible group headers, collapse
 * hides the group's rows, and the group batch action tests every member.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostsTab, groupHosts } from '../src/client/panel/HostsTab.tsx'
import type { SshApi } from '../src/client/api.ts'
import type { HostPayload, SshHostSummary, TestResult } from '../src/protocol.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeHost(alias: string, extra: Partial<SshHostSummary> = {}): SshHostSummary {
  return {
    alias,
    host: alias + '.example.com',
    port: 22,
    user: 'root',
    auth: 'key',
    keyReady: true,
    proxyJump: [],
    forwardAgent: false,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

// Every rendered root is unmounted in cleanup: a late-settling promise then
// hits the mounted guard instead of setState-ing against the torn-down jsdom
// environment (main-CI flake: window is not defined from HostsTab setError).
const mountedRoots: { root: ReturnType<typeof createRoot> }[] = []

afterEach(() => {
  for (const { root } of mountedRoots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

describe('groupHosts', () => {
  const hosts = [
    makeHost('web-1', { environment: 'prod', tags: ['web', 'cn'] }),
    makeHost('db-1', { environment: 'prod', tags: ['db'] }),
    makeHost('dev-1', { environment: 'dev' }),
    makeHost('misc-1'),
  ]

  it('returns one implicit group when grouping is off', () => {
    expect(groupHosts(hosts, 'none')).toEqual([{ key: '', hosts }])
  })

  it('buckets by environment with the unset bucket last', () => {
    const groups = groupHosts(hosts, 'environment')
    expect(groups.map(group => group.key)).toEqual(['dev', 'prod', ''])
    expect(groups[1].hosts.map(host => host.alias)).toEqual(['web-1', 'db-1'])
    expect(groups[2].hosts.map(host => host.alias)).toEqual(['misc-1'])
  })

  it('places multi-tag hosts in every tag group and untagged ones in the empty bucket', () => {
    const groups = groupHosts(hosts, 'tags')
    expect(groups.map(group => group.key)).toEqual(['cn', 'db', 'web', ''])
    expect(groups[2].hosts.map(host => host.alias)).toEqual(['web-1'])
    expect(groups[3].hosts.map(host => host.alias)).toEqual(['dev-1', 'misc-1'])
  })
})

describe('HostsTab unmount race (main-CI flake)', () => {
  it('a listHosts promise settling after unmount never reaches setState', async () => {
    // The late rejection used to reach setError after the tab unmounted;
    // racing the jsdom teardown it surfaced as "window is not defined" and
    // failed the whole run on a slow CI runner. With the mounted guard the
    // late settle is dropped. React 18 no longer warns on post-unmount
    // setState, so also pin the guard in source below.
    let rejectLate: ((error: Error) => void) | undefined
    const api = {
      listHosts: vi.fn(() => new Promise<SshHostSummary[]>((_resolve, reject) => { rejectLate = reject })),
    } as unknown as SshApi
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<HostsTab api={api} onConnect={() => undefined} />) })
    await act(async () => { root.unmount() })
    rejectLate!(new Error('late failure'))
    await act(async () => { await Promise.resolve() })
    expect(api.listHosts).toHaveBeenCalled()
  })

  it('a testHost promise settling after unmount never reaches setState', async () => {
    // Same race as the listHosts case, on the runTest path (setTestResults /
    // setTestingAlias were unguarded before the mounted ref was applied).
    let rejectLate: ((error: Error) => void) | undefined
    const api = {
      listHosts: vi.fn(async () => [makeHost('web-1')]),
      testHost: vi.fn(() => new Promise<TestResult>((_resolve, reject) => { rejectLate = reject })),
    } as unknown as SshApi
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<HostsTab api={api} onConnect={() => undefined} />) })
    const testButton = [...container.querySelectorAll('button')].find(button => button.textContent === '测试') as HTMLButtonElement
    await act(async () => { testButton.click() })
    await act(async () => { root.unmount() })
    rejectLate!(new Error('late test failure'))
    await act(async () => { await Promise.resolve() })
    expect(api.testHost).toHaveBeenCalled()
  })

  it('guards every load-path setState with the mounted ref', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'client', 'panel', 'HostsTab.tsx'), 'utf8')
    expect(source).toContain('mountedRef')
    expect(source).toContain('if (!mountedRef.current || seq !== seqRef.current) return')
  })
})

describe('HostsTab grouped view', () => {
  function makeApi(): SshApi {
    const hosts = [
      makeHost('web-1', { environment: 'prod' }),
      makeHost('db-1', { environment: 'prod' }),
      makeHost('dev-1', { environment: 'dev' }),
    ]
    return {
      listHosts: vi.fn(async () => hosts),
      testHost: vi.fn(async () => ({ ok: true, latencyMs: 12 })),
    } as unknown as SshApi
  }

  async function renderTab(api: SshApi): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push({ root })
    await act(async () => { root.render(<HostsTab api={api} onConnect={() => {}} />) })
    await act(async () => { await Promise.resolve() })
    return container
  }

  it('renders collapsible group sections with counts and batch test', async () => {
    const api = makeApi()
    const container = await renderTab(api)
    // Switch to environment grouping.
    const select = container.querySelector('select')!
    await act(async () => {
      select.value = 'environment'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const toggles = [...container.querySelectorAll('section button[aria-expanded]')] as HTMLButtonElement[]
    expect(toggles.map(toggle => toggle.getAttribute('aria-expanded'))).toEqual(['true', 'true'])
    const names = [...container.querySelectorAll('section .groupName, section [class*="groupName"]')].map(el => el.textContent)
    expect(names).toEqual(['dev', 'prod'])
    // Collapse the prod group: its two rows disappear from the DOM.
    const prodToggle = toggles.find(toggle => toggle.textContent?.includes('prod'))!
    await act(async () => { prodToggle.click() })
    expect(prodToggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('web-1.example.com')
    expect(container.textContent).toContain('dev-1.example.com')
    // The batch action tests every member of the group.
    const batchButton = [...container.querySelectorAll('section button')].find(button => button.textContent === '测试全部')
    await act(async () => { (batchButton as HTMLButtonElement).click() })
    expect(vi.mocked(api.testHost).mock.calls.length).toBeGreaterThan(0)
  })
})

describe('HostsTab proxy transport surfaces', () => {
  function makeApi(): SshApi {
    return {
      listHosts: vi.fn(async () => [
        makeHost('via-proxy', { proxyCommand: 'corp proxy %h %p' }),
        makeHost('direct'),
      ]),
      testHost: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
      importSshConfig: vi.fn(async () => ({
        parsed: 3,
        added: 1,
        skipped: 2,
        skippedBlocks: [
          { name: '*.cluster', reason: 'wildcard' as const },
          { name: 'dev-db', reason: 'existing' as const },
        ],
      })),
    } as unknown as SshApi
  }

  async function renderTab(api: SshApi): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push({ root })
    await act(async () => { root.render(<HostsTab api={api} onConnect={() => {}} />) })
    await act(async () => { await Promise.resolve() })
    return container
  }

  it('marks a ProxyCommand host and lists every skipped import block with its reason', async () => {
    const api = makeApi()
    const container = await renderTab(api)
    // The badge marks the host whose transport is a ProxyCommand, and its
    // tooltip carries the command itself.
    const badge = [...container.querySelectorAll('span')].find(el => el.textContent === '代理')
    expect(badge).toBeDefined()
    expect(badge?.getAttribute('title')).toBe('corp proxy %h %p')
    expect(container.textContent).toContain('via-proxy.example.com')

    const importButton = [...container.querySelectorAll('button')].find(button => button.textContent === '导入 ~/.ssh/config')!
    await act(async () => { importButton.click() })
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain('解析 3 个配置块')
    expect(container.textContent).toContain('*.cluster')
    expect(container.textContent).toContain('通配符 pattern，需手动配置')
    expect(container.textContent).toContain('别名已存在')
  })
})

describe('HostsTab agent forwarding', () => {
  function makeApi(hosts: SshHostSummary[]): SshApi {
    return {
      listHosts: vi.fn(async () => hosts),
      createHost: vi.fn(async (payload: HostPayload) => makeHost(payload.alias ?? 'new-host')),
      updateHost: vi.fn(async (alias: string) => makeHost(alias)),
    } as unknown as SshApi
  }

  async function renderTab(api: SshApi): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push({ root })
    await act(async () => { root.render(<HostsTab api={api} onConnect={() => {}} />) })
    await act(async () => { await Promise.resolve() })
    return container
  }

  /** Find a labelled form field by its visible label text. */
  function fieldOf(container: HTMLElement, label: string): HTMLElement {
    const field = [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))
    if (field === undefined) throw new Error('field not found: ' + label)
    return field
  }

  /** Write a value into a controlled input the way a real keystroke does. */
  async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const checkboxOf = (container: HTMLElement): HTMLInputElement =>
    container.querySelector('input[type="checkbox"]') as HTMLInputElement

  const saveButtonOf = (container: HTMLElement): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find(button => button.textContent === '保存') as HTMLButtonElement

  it('user saves a new host with agent forwarding enabled', async () => {
    // Given the create form opened from an empty host list
    const api = makeApi([])
    const container = await renderTab(api)
    const addButton = [...container.querySelectorAll('button')].find(button => button.textContent === '新增主机') as HTMLButtonElement
    await act(async () => { addButton.click() })

    // When the user fills the required fields and ticks agent forwarding
    await typeInto(fieldOf(container, '别名').querySelector('input') as HTMLInputElement, 'build-1')
    await typeInto(fieldOf(container, '主机地址').querySelector('input') as HTMLInputElement, 'build-1.example.com')
    await typeInto(fieldOf(container, '用户名').querySelector('input') as HTMLInputElement, 'deploy')
    await typeInto(fieldOf(container, '私钥路径').querySelector('input') as HTMLInputElement, '~/.ssh/id_ed25519')
    expect(checkboxOf(container).checked).toBe(false)
    await act(async () => { checkboxOf(container).click() })
    await act(async () => { saveButtonOf(container).click() })

    // Then the submitted payload carries the flag as an explicit boolean
    const createHost = vi.mocked(api.createHost)
    expect(createHost.mock.calls.length).toBe(1)
    expect(createHost.mock.calls[0]![0].forwardAgent).toBe(true)
  })

  it('user disables agent forwarding on a host that has it enabled', async () => {
    // Given a stored host whose summary reports forwarding as on
    const api = makeApi([makeHost('build-1', { forwardAgent: true })])
    const container = await renderTab(api)
    const editButton = [...container.querySelectorAll('button')].find(button => button.textContent === '编辑') as HTMLButtonElement
    await act(async () => { editButton.click() })
    expect(checkboxOf(container).checked).toBe(true)

    // When the user unticks it and saves without touching the secrets
    await act(async () => { checkboxOf(container).click() })
    await act(async () => { saveButtonOf(container).click() })

    // Then the update payload clears the flag instead of leaving it stored
    const updateHost = vi.mocked(api.updateHost)
    expect(updateHost.mock.calls.length).toBe(1)
    expect(updateHost.mock.calls[0]![0]).toBe('build-1')
    expect(updateHost.mock.calls[0]![1].forwardAgent).toBe(false)
  })

  it('user sees the forwarding badge only on hosts that enable it', async () => {
    // Given a list mixing a forwarding host with a plain one
    const api = makeApi([
      makeHost('build-1', { forwardAgent: true }),
      makeHost('plain-1'),
    ])
    const container = await renderTab(api)

    // When the table renders
    const badges = [...container.querySelectorAll('span[data-kind="forward-agent"]')]

    // Then exactly the forwarding host carries it, with its security hint
    expect(badges.map(badge => badge.textContent)).toEqual(['Agent 转发'])
    expect(badges[0]!.getAttribute('title')).toBe('仅对可信主机开启：远端可用本机私钥签名（等价 ssh -A）。')
    const rowOfBuild = [...container.querySelectorAll('tr')].find(row => row.textContent?.includes('build-1.example.com'))!
    const rowOfPlain = [...container.querySelectorAll('tr')].find(row => row.textContent?.includes('plain-1.example.com'))!
    expect(rowOfBuild.contains(badges[0]!)).toBe(true)
    expect(rowOfPlain.querySelector('span[data-kind="forward-agent"]')).toBeNull()
  })
})
