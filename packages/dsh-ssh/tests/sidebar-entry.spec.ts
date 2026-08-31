/**
 * The ssh sidebar entry row opts into the L2 semantic attributes (issue
 * #506): the shared injection core receives the plugin id, so the row
 * carries data-dsh-plugin="ssh" and data-dsh-part="sidebar-entry".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSidebarEntry } from '../src/client/sidebar-entry.ts'

describe('mountSidebarEntry L2 semantic attributes (#506)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('tags the entry row with data-dsh-plugin and data-dsh-part', () => {
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
      getSnapshot: () => ({ panelOpen: false }),
    } as never

    class FakeMutationObserver {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const dispose = mountSidebarEntry(controller)

    expect(entryEl.setAttribute).toHaveBeenCalledWith('data-dsh-ssh-entry', '')
    expect(entryEl.setAttribute).toHaveBeenCalledWith('data-dsh-plugin', 'ssh')
    expect(entryEl.setAttribute).toHaveBeenCalledWith('data-dsh-part', 'sidebar-entry')
    dispose()
  })
})
