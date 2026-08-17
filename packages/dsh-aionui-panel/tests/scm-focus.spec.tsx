// @vitest-environment jsdom
/**
 * Regression test for the ScmPanel window-focus throttle: an editor saving a
 * file outside git events (or a burst of window activations) must not spawn a
 * git status per focus event. The component otherwise only trusts host
 * status, so a burst would otherwise hammer git for no observable change.
 * Verified with fake timers so the 5s window is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'

// React 18 requires the act environment flag so act() really flushes passive
// effects (the focus listener is attached inside a useEffect).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import { ScmPanel } from '../src/client/components/ScmPanel.tsx'
import type { PanelStores } from '../src/client/store.ts'

/** Minimal scm snapshot that renders the notRepo branch (no git actions). */
const baseScmState = {
  root: '',
  repositories: [],
  gitMissing: false,
  loading: false,
  busy: [] as string[],
  failed: [] as string[],
  viewMode: 'list' as const,
  sectionCollapsed: {},
  treeExpanded: [] as string[],
  selected: null,
}

/** A fake PanelStores whose scm store is only a focus-refresh target. */
function makeFakeStores(): PanelStores {
  const refresh = vi.fn(async () => {})
  // Cache the snapshot so useSyncExternalStore sees a stable reference
  // (a fresh object per getSnapshot call triggers React's infinite-loop
  // guard for selectors that should be identity-stable).
  const snapshot = { ...baseScmState }
  const scm = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    update: vi.fn(),
    setRoot: vi.fn(),
    refresh,
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
  // The notRepo render path never reads layout / explorer / preview, so
  // empty stubs suffice; cast through unknown to satisfy the bundle type.
  const stores = {
    layout: {} as never,
    explorer: {} as never,
    scm,
    preview: {} as never,
  }
  return stores as unknown as PanelStores
}

describe('ScmPanel window-focus refresh throttle', () => {
  let host: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 })
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    vi.useRealTimers()
    host.remove()
  })

  it('fires on first focus, drops a focus burst inside the window, and releases after 5s', () => {
    const stores = makeFakeStores()
    const root = createRoot(host)
    act(() => {
      root.render(<ScmPanel stores={stores} />)
    })

    // First focus after mount always refreshes.
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(stores.scm.refresh).toHaveBeenCalledTimes(1)

    // A focus burst inside the 5s window is throttled.
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(stores.scm.refresh).toHaveBeenCalledTimes(1)

    // After the window elapses, the next focus refreshes again.
    act(() => { vi.advanceTimersByTime(5000) })
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(stores.scm.refresh).toHaveBeenCalledTimes(2)

    act(() => { root.unmount() })
  })
})
