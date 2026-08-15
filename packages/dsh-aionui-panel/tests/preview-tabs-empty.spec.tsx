// @vitest-environment jsdom
/**
 * PreviewTabs empty-state regression: the new-URL-tab `+` must stay visible
 * when there are no tabs, so a user who collapses the panel (or closes every
 * tab) has a standing entry point to create a preview without first clicking
 * a file in the tree (issue #196). Before the fix the plus was gated behind
 * `tabs.length > 0`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PreviewTabState } from '../src/client/store.ts'
import { PreviewTabs } from '../src/client/preview/PreviewTabs.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// PreviewTabs measures the scroll container with a ResizeObserver; jsdom
// ships none, so install a no-op stub that never fires callbacks.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

const noop = (): void => {}

const tab = (id: string): PreviewTabState => ({
  id,
  title: `tab-${id}`,
  root: '/work',
  path: `/work/${id}.md`,
  contentType: 'markdown',
  content: '',
  dirty: false,
  updated: false,
  loading: false,
  truncated: false,
  error: null,
  savedAt: 0,
})

function renderTabs(tabs: PreviewTabState[]): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <PreviewTabs
        tabs={tabs}
        activeTabId={tabs.length > 0 ? tabs[0].id : null}
        onSwitch={noop}
        onClose={noop}
        onContextMenu={noop}
        onNewUrlTab={noop}
        onClosePanel={noop}
      />,
    )
  })
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PreviewTabs empty state', () => {
  it('keeps the new-tab plus button visible with zero tabs', () => {
    const host = renderTabs([])
    // The plus is the role=button carrying the URL-tab title label.
    const plus = host.querySelector<HTMLElement>('[role="button"][title="新建 URL 预览"]')
    expect(plus).not.toBeNull()
    expect(host.textContent).toContain('没有打开的预览')
  })

  it('still shows the plus and the tabs when tabs exist', () => {
    const host = renderTabs([tab('a'), tab('b')])
    const plus = host.querySelector<HTMLElement>('[role="button"][title="新建 URL 预览"]')
    expect(plus).not.toBeNull()
    expect(host.textContent).toContain('tab-a')
    expect(host.textContent).toContain('tab-b')
  })
})
