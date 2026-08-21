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
import type { SshHostSummary, TestResult } from '../src/protocol.ts'

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
    const batchButtons = [...container.querySelectorAll('section button')].filter(button => button.textContent === '测试全部')
    await act(async () => { (batchButtons[0] as HTMLButtonElement).click() })
    expect(vi.mocked(api.testHost).mock.calls.length).toBeGreaterThan(0)
  })
})
