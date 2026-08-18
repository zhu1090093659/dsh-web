// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { PanelLayoutController } from '../src/client/layout.ts'
import { createLayoutStore, layoutSetRoot } from '../src/client/store.ts'

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

function nextMutationCheckpoint(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('PanelLayoutController', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('restores the shell grid tracks when disposed after mounting panel columns (#499)', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)

    const frame = document.createElement('div')
    frame.dataset.dshFrame = ''
    frame.style.display = 'grid'
    frame.style.gridTemplateColumns = '280px minmax(0, 1fr) 0px'
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 600,
      top: 0,
      right: 1000,
      bottom: 600,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    document.body.appendChild(frame)

    const layout = createLayoutStore()
    layoutSetRoot(layout, '/workspace', true)
    const controller = new PanelLayoutController(layout)

    controller.mount()
    await nextMutationCheckpoint()

    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px 340px 220px')

    controller.dispose()

    expect(frame.style.gridTemplateColumns).toBe('280px minmax(0, 1fr) 0px')
    expect(document.querySelector('[data-aionui-preview-col]')).toBeNull()
    expect(document.querySelector('[data-aionui-explorer-col]')).toBeNull()
  })
})
