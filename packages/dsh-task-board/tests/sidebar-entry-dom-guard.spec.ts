/**
 * DOM-level idempotency of the sidebar entry: when an entry row already
 * exists in the document, mountSidebarEntry must not create a second one.
 * This backs the apply-level guard (apply-guard.spec.ts) against paths that
 * bypass apply — a stale module still alive after a bundle re-injection, or
 * an HMR re-mount. The existing row keeps working; a full page reload is the
 * ultimate reset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSidebarEntry } from '../src/client/sidebar-entry.ts'

describe('mountSidebarEntry DOM idempotency', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips mounting and returns an empty disposer when an entry row already exists', () => {
    const createElement = vi.fn(() => { throw new Error('createElement must not run when an entry row exists') })
    vi.stubGlobal('document', {
      querySelector: () => ({}), // an existing entry row
      createElement,
    })
    const controller = {} as never

    const dispose = mountSidebarEntry(controller)

    expect(dispose()).toBeUndefined()
    expect(createElement).not.toHaveBeenCalled()
  })

  it('proceeds to create an entry when no entry row exists yet', () => {
    const entryEl = {
      dataset: {},
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
      remove: vi.fn(),
      append: vi.fn(),
    }
    const createElement = vi.fn(() => entryEl)
    vi.stubGlobal('document', {
      querySelector: () => null,
      createElement,
      body: {},
      documentElement: { lang: 'zh-CN' },
    })
    const controller = {
      subscribe: () => () => {},
      getSnapshot: () => ({ boardOpen: false }),
    } as never

    class FakeMutationObserver {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const dispose = mountSidebarEntry(controller)

    // createElement now builds the row plus its two spans (icon/label).
    expect(createElement).toHaveBeenCalledTimes(3)
    dispose()
    expect(entryEl.remove).toHaveBeenCalledTimes(1)
  })

  it('opts the entry row into the L2 semantic attributes (#506)', () => {
    const entryEl = {
      dataset: {},
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
      remove: vi.fn(),
      append: vi.fn(),
    }
    vi.stubGlobal('document', {
      querySelector: () => null,
      createElement: () => entryEl,
      body: {},
      documentElement: { lang: 'zh-CN' },
    })
    const controller = {
      subscribe: () => () => {},
      getSnapshot: () => ({ boardOpen: false }),
    } as never

    class FakeMutationObserver {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const dispose = mountSidebarEntry(controller)

    expect(entryEl.setAttribute).toHaveBeenCalledWith('data-dsh-taskboard-entry', '')
    expect(entryEl.setAttribute).toHaveBeenCalledWith('data-dsh-plugin', 'task-board')
    expect(entryEl.setAttribute).toHaveBeenCalledWith('data-dsh-part', 'sidebar-entry')
    dispose()
  })
})
