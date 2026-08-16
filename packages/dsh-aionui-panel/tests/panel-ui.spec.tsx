// @vitest-environment jsdom
/**
 * Lightweight UI smoke tests for the two 2026 panel upgrades: the shiki
 * CodeBlock code viewer (highlighted source tabs) and the file-tree
 * copy-path button (harness capsule + icon, hover-revealed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { DirListing, GitStatusView, PanelEnvelope } from '../src/core/types.ts'
import { createPanelStores, type PanelStores, type PreviewTabState } from '../src/client/store.ts'
import type { PanelApi } from '../src/client/api.ts'
import { ExplorerPanel } from '../src/client/components/ExplorerPanel.tsx'
import { TabContent } from '../src/client/preview/content.tsx'

/** A fake api with a two-entry root listing (src dir + README.md). */
function fakeApi(): PanelApi {
  const api = {
    list: vi.fn(async (root: string, path: string): Promise<PanelEnvelope<DirListing>> => {
      const base = path === '' ? '' : `${path}/`
      return {
        ok: true,
        value: {
          root,
          entries: [
            { name: 'src', path: `${base}src`, isDir: true, size: 0, mtime: 0 },
            { name: 'README.md', path: `${base}README.md`, isDir: false, size: 10, mtime: 1 },
          ],
        },
      }
    }),
    read: vi.fn(async (): Promise<PanelEnvelope<{ content: string; truncated: boolean; size: number; mtime: number }>> => ({
      ok: true, value: { content: '{}', truncated: false, size: 2, mtime: 10 },
    })),
    write: vi.fn(async (): Promise<PanelEnvelope<{ mtime: number }>> => ({ ok: true, value: { mtime: 11 } })),
    search: vi.fn(async (): Promise<PanelEnvelope<{ query: string; hits: never[]; truncated: boolean }>> => ({
      ok: true, value: { query: '', hits: [], truncated: false },
    })),
    searchContent: vi.fn(async (): Promise<PanelEnvelope<{ query: string; hits: never[]; truncated: boolean }>> => ({
      ok: true, value: { query: '', hits: [], truncated: false },
    })),
    delete: vi.fn(async () => ({ ok: true, value: { ok: true as const } })),
    gitStatus: vi.fn(async (): Promise<PanelEnvelope<GitStatusView | null>> => ({
      ok: true, value: null,
    })),
    gitDiff: vi.fn(async (): Promise<PanelEnvelope<{ content: string }>> => ({
      ok: true, value: { content: '' },
    })),
    gitStage: vi.fn(async () => ({ ok: true, value: { applied: [], failed: [] } })),
    gitUnstage: vi.fn(async () => ({ ok: true, value: { applied: [], failed: [] } })),
    gitDiscard: vi.fn(async () => ({ ok: true, value: { applied: [], failed: [] } })),
  } as unknown as PanelApi
  return api
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

async function mountExplorer(): Promise<{ host: HTMLElement; stores: PanelStores }> {
  const stores = createPanelStores(fakeApi())
  stores.explorer.setRoot('/w')
  await vi.waitFor(() => expect(stores.explorer.getSnapshot().dirs['']).toBeDefined())
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<ExplorerPanel stores={stores} onToggleCollapse={() => {}} />)
  })
  return { host, stores }
}

const noop = (): void => {}

const codeTab: PreviewTabState = {
  id: 't',
  title: 'app.json',
  path: 'app.json',
  root: '/w',
  contentType: 'code',
  content: '{"a": 1}',
  dirty: false,
  updated: false,
  loading: false,
  truncated: false,
  error: null,
  savedAt: 0,
}

function mountCodeTab(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <TabContent tab={codeTab} viewMode="preview" split={false} onContentChange={noop} onSave={noop} />,
    )
  })
  return host
}

describe('code viewer syntax highlighting', () => {
  it('renders source tabs through the harness shiki CodeBlock', () => {
    const host = mountCodeTab()
    expect(host.querySelector('.md-code-block')).not.toBeNull()
    expect(host.textContent).toContain('"a": 1')
  })
})

describe('file-tree copy-path buttons', () => {
  it('shows harness-style current/global copy buttons on file and folder rows', async () => {
    const { host } = await mountExplorer()
    const current = host.querySelectorAll<HTMLButtonElement>('[aria-label="复制当前路径"]')
    const global = host.querySelectorAll<HTMLButtonElement>('[aria-label="复制全局路径"]')
    expect(current.length).toBe(2)
    expect(global.length).toBe(2)
    for (const button of [...current, ...global]) {
      expect(button.querySelector('svg')).not.toBeNull()
    }
  })

  it('copies the relative or global path without opening the preview', async () => {
    const { host, stores } = await mountExplorer()
    const readmeRow = host.querySelector<HTMLElement>('[title="README.md"]')?.parentElement
    expect(readmeRow).not.toBeNull()
    const relative = readmeRow?.querySelector<HTMLButtonElement>('[aria-label="复制当前路径"]')
    const global = readmeRow?.querySelector<HTMLButtonElement>('[aria-label="复制全局路径"]')
    expect(relative).not.toBeNull()
    expect(global).not.toBeNull()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    await act(async () => {
      relative?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('README.md')
    expect(relative?.title).toBe('已复制')
    writeText.mockClear()
    await act(async () => {
      global?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('/w/README.md')
    expect(global?.title).toBe('已复制')
    expect(stores.preview.getSnapshot().open).toBe(false)
    expect(stores.preview.getSnapshot().tabs).toHaveLength(0)
  })
})

describe('explorer content-search toggle', () => {
  it('switches the search box into content mode', async () => {
    const { host } = await mountExplorer()
    const contentToggle = [...host.querySelectorAll('button')].find((button) => button.textContent === '内容')
    expect(contentToggle).not.toBeNull()
    act(() => {
      contentToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const input = host.querySelector<HTMLInputElement>('input')
    expect(input?.getAttribute('placeholder')).toBe('搜索文件内容')
  })
})
