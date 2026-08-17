// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScmPanel } from '../src/client/components/ScmPanel.tsx'
import { t } from '../src/client/locales.ts'
import type { PanelStores, ScmState } from '../src/client/store.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const state: ScmState = {
  root: '/workspace',
  repositories: [
    { root: '/workspace', branch: 'main', staged: [], unstaged: [], untracked: [] },
    {
      root: '/workspace/nested',
      branch: 'feature',
      staged: [],
      unstaged: [{ path: 'inner.txt', state: 'modified', staged: false }],
      untracked: [],
    },
  ],
  gitMissing: false,
  loading: false,
  busy: [],
  failed: [],
  viewMode: 'list',
  sectionCollapsed: {},
  treeExpanded: [],
  selected: null,
}

function makeStores(): PanelStores {
  const scm = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    update: vi.fn(),
    setRoot: vi.fn(),
    refresh: vi.fn(async () => {}),
    stage: vi.fn(async () => {}),
    unstage: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    discardAll: vi.fn(async () => {}),
    setViewMode: vi.fn(),
    setSectionCollapsed: vi.fn(),
    setTreeExpanded: vi.fn(),
    setFailed: vi.fn(),
    select: vi.fn(),
  }
  return {
    layout: {} as never,
    explorer: {} as never,
    scm,
    preview: { openDiff: vi.fn() } as never,
  } as unknown as PanelStores
}

describe('ScmPanel multi-repository view', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    host.remove()
  })

  it('groups nested repository changes and routes row actions to that repository', () => {
    const stores = makeStores()
    const root = createRoot(host)
    act(() => { root.render(<ScmPanel stores={stores} />) })

    expect(host.textContent).toContain('nested')
    expect(host.textContent).toContain('feature')
    const row = host.querySelector<HTMLElement>('[title="inner.txt"]')
    const stage = row?.querySelector<HTMLButtonElement>(`button[title="${t('scm.stage')}"]`)
    expect(stage).not.toBeNull()
    act(() => { stage?.click() })
    expect(stores.scm.stage).toHaveBeenCalledWith('/workspace/nested', ['inner.txt'])

    act(() => { root.unmount() })
  })
})
