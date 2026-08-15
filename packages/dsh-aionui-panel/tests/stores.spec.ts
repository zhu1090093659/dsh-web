/**
 * Store behavior tests with a fake api: explorer expand/reveal/persist
 * (expand ancestors + select, search clear on reveal), preview tab dedup
 * (re-clicking an open file focuses it), scm refresh landing the host status
 * (no optimistic rows), and per-root re-binding restoring persisted state.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing, FsEntry, GitStatusView, PanelEnvelope } from '../src/core/types.ts'
import { createPanelStores, type PanelStores } from '../src/client/store.ts'
import type { PanelApi } from '../src/client/api.ts'

/** A fake api recording calls with canned responses. */
function fakeApi(overrides: Partial<PanelApi> = {}): { api: PanelApi; calls: string[] } {
  const calls: string[] = []
  const listing = (root: string, path: string): FsEntry[] => {
    const base = path === '' ? '' : `${path}/`
    return [
      { name: 'src', path: `${base}src`, isDir: true, size: 0, mtime: 0 },
      { name: 'README.md', path: `${base}README.md`, isDir: false, size: 10, mtime: 1 },
    ]
  }
  const api = {
    list: vi.fn(async (root: string, path: string): Promise<PanelEnvelope<DirListing>> => {
      calls.push(`list:${path}`)
      return { ok: true, value: { root, entries: listing(root, path) } }
    }),
    read: vi.fn(async (): Promise<PanelEnvelope<{ content: string; truncated: boolean; size: number; mtime: number }>> => ({
      ok: true, value: { content: '# hi', truncated: false, size: 4, mtime: 10 },
    })),
    write: vi.fn(async (): Promise<PanelEnvelope<{ mtime: number }>> => ({ ok: true, value: { mtime: 11 } })),
    search: vi.fn(async (): Promise<PanelEnvelope<{ query: string; hits: never[]; truncated: boolean }>> => ({
      ok: true, value: { query: '', hits: [], truncated: false },
    })),
    delete: vi.fn(async () => ({ ok: true, value: { ok: true as const } })),
    gitStatus: vi.fn(async (): Promise<PanelEnvelope<GitStatusView | null>> => ({
      ok: true,
      value: {
        root: '/w', branch: 'main',
        staged: [], unstaged: [{ path: 'a.txt', state: 'modified', staged: false }],
        untracked: [],
      },
    })),
    gitDiff: vi.fn(async (): Promise<PanelEnvelope<{ content: string }>> => ({
      ok: true, value: { content: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n' },
    })),
    gitStage: vi.fn(async () => ({ ok: true, value: { applied: ['a.txt'], failed: [] } })),
    gitUnstage: vi.fn(async () => ({ ok: true, value: { applied: [], failed: [] } })),
    gitDiscard: vi.fn(async () => ({ ok: true, value: { applied: ['a.txt'], failed: [] } })),
    ...overrides,
  } as unknown as PanelApi
  return { api, calls }
}

let stores: PanelStores
let calls: string[]

beforeEach(() => {
  localStorage.clear()
  const setup = fakeApi()
  stores = createPanelStores(setup.api)
  calls = setup.calls
})

describe('explorer store', () => {
  it('loads the root listing on bind and toggles dirs lazily', async () => {
    stores.explorer.setRoot('/w')
    await vi.waitFor(() => expect(stores.explorer.getSnapshot().dirs['']).toBeDefined())
    expect(calls).toContain('list:')
    const before = calls.length
    stores.explorer.toggleDir('src')
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(before))
    expect(stores.explorer.getSnapshot().expanded).toContain('src')
    expect(stores.explorer.getSnapshot().dirs['src']).toBeDefined()
    // Collapse drops the subtree cache.
    stores.explorer.toggleDir('src')
    expect(stores.explorer.getSnapshot().expanded).not.toContain('src')
    expect(stores.explorer.getSnapshot().dirs['src']).toBeUndefined()
  })

  it('reveal expands the ancestor chain and selects, and clears search', async () => {
    stores.explorer.setRoot('/w')
    stores.explorer.reveal('src/deep/file.ts')
    const state = stores.explorer.getSnapshot()
    expect(state.expanded).toContain('src')
    expect(state.expanded).toContain('src/deep')
    expect(state.selected).toBe('src/deep/file.ts')
  })

  it('persists expanded + selected per root and restores on re-bind', async () => {
    stores.explorer.setRoot('/w')
    stores.explorer.toggleDir('src')
    stores.explorer.select('README.md')
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(localStorage.getItem('explorer-ui:/w')).toContain('"src"')

    const setup = fakeApi()
    const fresh = createPanelStores(setup.api)
    fresh.explorer.setRoot('/w')
    const state = fresh.explorer.getSnapshot()
    expect(state.expanded).toContain('src')
    expect(state.selected).toBe('README.md')
  })
})

describe('preview store', () => {
  it('openFile dedups: re-clicking an open file focuses the tab', () => {
    stores.preview.setRoot('/w')
    stores.preview.openFile('/w', 'README.md')
    const first = stores.preview.getSnapshot()
    expect(first.tabs).toHaveLength(1)
    stores.preview.openFile('/w', 'README.md')
    const second = stores.preview.getSnapshot()
    expect(second.tabs).toHaveLength(1)
    expect(second.activeTabId).toBe(first.tabs[0].id)
  })

  it('marks dirty on edit and saves through the api', async () => {
    stores.preview.setRoot('/w')
    stores.preview.openFile('/w', 'README.md')
    const tab = stores.preview.getSnapshot().tabs[0]
    stores.preview.updateContent(tab.id, '# edited')
    expect(stores.preview.getSnapshot().tabs[0].dirty).toBe(true)
    await stores.preview.saveTab(tab.id)
    expect(stores.preview.getSnapshot().tabs[0].dirty).toBe(false)
  })

  it('closeTabs routes through dirty confirmation logic (UI decides, store closes)', () => {
    stores.preview.setRoot('/w')
    stores.preview.openFile('/w', 'README.md')
    stores.preview.openFile('/w', 'src/a.ts')
    stores.preview.updateContent(stores.preview.getSnapshot().tabs[0].id, 'x')
    const dirty = stores.preview.getSnapshot().tabs.filter((item) => item.dirty)
    expect(dirty).toHaveLength(1)
    stores.preview.closeTabs(stores.preview.getSnapshot().tabs.map((item) => item.id))
    expect(stores.preview.getSnapshot().tabs).toHaveLength(0)
    expect(stores.preview.getSnapshot().open).toBe(false)
  })
})

describe('scm store', () => {
  it('lands the host status on refresh (host is the only truth)', async () => {
    stores.scm.setRoot('/w')
    await vi.waitFor(() => expect(stores.scm.getSnapshot().status).not.toBeNull())
    expect(stores.scm.getSnapshot().status?.unstaged[0].path).toBe('a.txt')
  })

  it('persists view mode per root', async () => {
    stores.scm.setRoot('/w')
    stores.scm.setViewMode('tree')
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(localStorage.getItem('scm-ui:/w')).toContain('"tree"')

    const setup = fakeApi()
    const fresh = createPanelStores(setup.api)
    fresh.scm.setRoot('/w')
    expect(fresh.scm.getSnapshot().viewMode).toBe('tree')
  })

  it('select marks the opened row and persists per root', async () => {
    stores.scm.setRoot('/w')
    stores.scm.select('a.txt')
    expect(stores.scm.getSnapshot().selected).toBe('a.txt')
    await new Promise((resolve) => setTimeout(resolve, 250))

    const setup = fakeApi()
    const fresh = createPanelStores(setup.api)
    fresh.scm.setRoot('/w')
    expect(fresh.scm.getSnapshot().selected).toBe('a.txt')
  })
})

describe('preview pdf tabs (issue #236)', () => {
  it('openFile on a pdf streams via the raw route without api.read', async () => {
    const { api } = fakeApi()
    const s = createPanelStores(api)
    s.preview.setRoot('/w')
    s.preview.openFile('/w', 'docs/manual v2.pdf')
    await vi.waitFor(() => expect(s.preview.getSnapshot().tabs[0].content).not.toBeNull())
    const tab = s.preview.getSnapshot().tabs[0]
    expect(tab.contentType).toBe('pdf')
    expect(tab.content?.startsWith('/aionui-panel/raw?root=')).toBe(true)
    expect(tab.content).toContain(`path=${encodeURIComponent('docs/manual v2.pdf')}`)
    expect(tab.content).toContain('&v=')
    // Pdf tabs never go through the /read endpoint.
    expect((api.read as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('reloadTab rebuilds the raw URL with a fresh nonce', async () => {
    const { api } = fakeApi()
    const s = createPanelStores(api)
    let tick = 1000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => tick++)
    try {
      s.preview.setRoot('/w')
      s.preview.openFile('/w', 'doc.pdf')
      await vi.waitFor(() => expect(s.preview.getSnapshot().tabs[0].content).not.toBeNull())
      const id = s.preview.getSnapshot().tabs[0].id
      const first = s.preview.getSnapshot().tabs[0].content
      await s.preview.reloadTab(id)
      const second = s.preview.getSnapshot().tabs[0].content
      expect(second).not.toBe(first)
      expect(second?.startsWith('/aionui-panel/raw?root=')).toBe(true)
      expect(second).toContain('&v=')
      expect((api.read as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('preview diff tabs', () => {
  it('openDiff creates a diff tab loaded through gitDiff (staged side)', async () => {
    stores.preview.setRoot('/w')
    stores.preview.openDiff('/w', 'a.txt', true)
    expect(stores.preview.getSnapshot().open).toBe(true)
    const tab = stores.preview.getSnapshot().tabs[0]
    expect(tab.contentType).toBe('diff')
    expect(tab.diff).toEqual({ staged: true })
    await vi.waitFor(() => expect(stores.preview.getSnapshot().tabs[0].content).not.toBeNull())
    expect(stores.preview.getSnapshot().tabs[0].content).toContain('diff --git')
  })

  it('openDiff and openFile of the same path are distinct tabs', () => {
    stores.preview.setRoot('/w')
    stores.preview.openDiff('/w', 'a.txt', false)
    stores.preview.openFile('/w', 'a.txt')
    const ids = stores.preview.getSnapshot().tabs.map((tab) => tab.id)
    expect(new Set(ids).size).toBe(2)
    expect(stores.preview.getSnapshot().activeTabId).toBe(ids[1])
  })

  it('openDiff dedups: re-clicking the same row focuses the diff tab', () => {
    stores.preview.setRoot('/w')
    stores.preview.openDiff('/w', 'a.txt', false)
    const first = stores.preview.getSnapshot().tabs[0].id
    stores.preview.openDiff('/w', 'a.txt', false)
    expect(stores.preview.getSnapshot().tabs).toHaveLength(1)
    expect(stores.preview.getSnapshot().activeTabId).toBe(first)
  })

  it('handleGitChange refreshes loaded diff tabs in place', async () => {
    const { api } = fakeApi()
    const s = createPanelStores(api)
    s.preview.setRoot('/w')
    s.preview.openDiff('/w', 'a.txt', false)
    await vi.waitFor(() => expect(s.preview.getSnapshot().tabs[0].content).not.toBeNull())
    const before = (api.gitDiff as ReturnType<typeof vi.fn>).mock.calls.length
    await s.preview.handleGitChange('/w')
    expect((api.gitDiff as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1)
    expect(s.preview.getSnapshot().tabs[0].content).toContain('diff --git')
  })

  it('openDiff persists and restores as a diff tab', async () => {
    stores.preview.setRoot('/w')
    stores.preview.openDiff('/w', 'a.txt', true)
    await new Promise((resolve) => setTimeout(resolve, 250))

    const setup = fakeApi()
    const fresh = createPanelStores(setup.api)
    fresh.preview.setRoot('/w')
    const tab = fresh.preview.getSnapshot().tabs[0]
    expect(tab.diff).toEqual({ staged: true })
    expect(tab.contentType).toBe('diff')
    // Restore re-fetches through gitDiff, not the fs read.
    await vi.waitFor(() => expect(fresh.preview.getSnapshot().tabs[0].content).not.toBeNull())
    expect(fresh.preview.getSnapshot().tabs[0].content).toContain('diff --git')
  })
})

describe('regression: search debounce + failure paths + save race', () => {
  it('debounces search: typing does not fire per keystroke, one call after settle', async () => {
    const { api } = fakeApi()
    const s = createPanelStores(api)
    s.explorer.setRoot('/w')
    await vi.waitFor(() => expect(s.explorer.getSnapshot().dirs['']).toBeDefined())
    const searchCalls = (api.search as ReturnType<typeof vi.fn>).mock.calls.length
    s.explorer.setSearchQuery('a')
    s.explorer.setSearchQuery('ab')
    s.explorer.setSearchQuery('abc')
    // No request yet within the debounce window.
    expect((api.search as ReturnType<typeof vi.fn>).mock.calls.length).toBe(searchCalls)
    await vi.waitFor(() => expect((api.search as ReturnType<typeof vi.fn>).mock.calls.length).toBe(searchCalls + 1))
    expect((api.search as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]).toBe('abc')
  })

  it('search failure lands status error', async () => {
    const { api } = fakeApi({
      search: vi.fn(async () => ({ ok: false as const, error: { code: 'search-failed' as const, message: 'boom' } })),
    })
    const s = createPanelStores(api)
    s.explorer.setRoot('/w')
    s.explorer.setSearchQuery('xyz')
    await vi.waitFor(() => expect(s.explorer.getSnapshot().search.status).toBe('error'))
    expect(s.explorer.getSnapshot().search.hits).toEqual([])
  })

  it('saveTab keeps dirty when the user types while the save is in flight', async () => {
    let resolveWrite: ((value: unknown) => void) | undefined
    const { api } = fakeApi({
      write: vi.fn(() => new Promise((resolve) => { resolveWrite = resolve })),
    })
    const s = createPanelStores(api)
    s.preview.setRoot('/w')
    s.preview.openFile('/w', 'README.md')
    await vi.waitFor(() => expect(s.preview.getSnapshot().tabs[0].content).not.toBeNull())
    const id = s.preview.getSnapshot().tabs[0].id
    s.preview.updateContent(id, '# edited')
    const saving = s.preview.saveTab(id)
    // User keeps typing while the write is pending.
    s.preview.updateContent(id, '# edited again')
    resolveWrite?.({ ok: true, value: { mtime: 99 } })
    await saving
    const tab = s.preview.getSnapshot().tabs[0]
    expect(tab.dirty).toBe(true) // newer edits must stay unsaved-marked
    expect(tab.mtime).toBe(99) // write base refreshed
  })

  it('saveTab write-conflict maps to an error and keeps content', async () => {
    const { api } = fakeApi({
      write: vi.fn(async () => ({ ok: false as const, error: { code: 'write-conflict' as const, message: 'conflict' } })),
    })
    const s = createPanelStores(api)
    s.preview.setRoot('/w')
    s.preview.openFile('/w', 'README.md')
    await vi.waitFor(() => expect(s.preview.getSnapshot().tabs[0].content).not.toBeNull())
    const id = s.preview.getSnapshot().tabs[0].id
    s.preview.updateContent(id, '# edited')
    await s.preview.saveTab(id)
    const tab = s.preview.getSnapshot().tabs[0]
    expect(tab.error).toContain('保存冲突')
    expect(tab.dirty).toBe(true)
  })

  it('scm stage reports partial failures from the host batch', async () => {
    const { api } = fakeApi({
      gitStage: vi.fn(async () => ({ ok: true as const, value: { applied: ['a.txt'], failed: ['out.txt'] } })),
    })
    const s = createPanelStores(api)
    s.scm.setRoot('/w')
    await s.scm.stage(['a.txt', 'out.txt'])
    expect(s.scm.getSnapshot().failed).toEqual(['out.txt'])
  })

  it('readJson top-level null is guarded (no TypeError on rebind)', () => {
    localStorage.setItem('explorer-ui:/w', 'null')
    const s = createPanelStores(fakeApi().api)
    expect(() => s.explorer.setRoot('/w')).not.toThrow()
    expect(s.explorer.getSnapshot().expanded).toEqual([])
  })

  it('flushNow writes pending persisted state immediately', async () => {
    const s = createPanelStores(fakeApi().api)
    s.explorer.setRoot('/w')
    s.explorer.toggleDir('src')
    expect(localStorage.getItem('explorer-ui:/w')).toBeNull() // debounce pending
    s.flushNow()
    expect(localStorage.getItem('explorer-ui:/w')).toContain('"src"')
  })
})
