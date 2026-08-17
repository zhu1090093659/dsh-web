// @vitest-environment jsdom
/**
 * Split-pane text regression: a plain-text file (contentType 'text', e.g.
 * README/LICENSE/.env) is split-eligible, but the right preview pane used to
 * render only markdown/html/csv/code, leaving the preview side blank for
 * 'text'. The text branch must fall through to CodeViewer, matching the
 * non-split TabContent path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { PreviewTabState } from '../src/client/store.ts'
import { TabContent } from '../src/client/preview/content.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

const noop = (): void => {}

const textTab = (): PreviewTabState => ({
  id: 't',
  title: 'README',
  root: '/work',
  path: '/work/README',
  contentType: 'text',
  content: 'plain text body',
  dirty: false,
  updated: false,
  loading: false,
  truncated: false,
  error: null,
  savedAt: 0,
})

function renderSplit(tab: PreviewTabState): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<TabContent tab={tab} viewMode="preview" split={true} onContentChange={noop} onSave={noop} />)
  })
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SplitPane text preview', () => {
  it('renders the text body in the preview pane for a text file', () => {
    const host = renderSplit(textTab())
    // The right pane should fall through to CodeViewer, not stay blank.
    expect(host.querySelector('.md-code-block')).not.toBeNull()
    expect(host.textContent).toContain('plain text body')
  })
})
