// @vitest-environment jsdom
/**
 * L2 semantic attributes of the SSH panel (issue #506): the mounted panel
 * container and the tab bar opt into the semantic-attrs/v1 enum
 * (data-dsh-plugin / data-dsh-part) so skins can target them without
 * hash-class selectors.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SshPanel } from '../src/client/panel/SshPanel.tsx'
import type { SshApi } from '../src/client/api.ts'
import { PanelController } from '../src/client/panel/controller.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-dsh-ssh-active')
  vi.useRealTimers()
})

function fakeApi(): SshApi {
  return {
    listHosts: vi.fn(async () => []),
    listKeys: vi.fn(async () => []),
  } as unknown as SshApi
}

/** The real controller: the panel reads its tab and session state from it. */
function fakeController(): PanelController {
  return new PanelController()
}

describe('SshPanel L2 semantic attributes (#506)', () => {
  it('tags the tab bar as the tab-bar part', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<SshPanel controller={fakeController()} api={fakeApi()} />) })

    const tabBar = container.querySelector('[role="tablist"]')
    expect(tabBar).not.toBeNull()
    expect(tabBar!.getAttribute('data-dsh-part')).toBe('tab-bar')
  })

  it('tags the panel root with the ssh plugin marker', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<SshPanel controller={fakeController()} api={fakeApi()} />) })

    const panel = container.querySelector('[data-dsh-plugin="ssh"]')
    expect(panel).not.toBeNull()
  })

  it('tags every tab button as the tab part', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<SshPanel controller={fakeController()} api={fakeApi()} />) })

    const tabs = container.querySelectorAll('[role="tab"]')
    expect(tabs.length).toBe(6)
    for (const tab of tabs) {
      expect(tab.getAttribute('data-dsh-part')).toBe('tab')
    }
  })

  it('tags the back-to-conversation button with a stable center-view hook', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<SshPanel controller={fakeController()} api={fakeApi()} />) })

    const back = container.querySelector('[data-dsh-center-view-back=""]')
    expect(back).not.toBeNull()
    expect(back?.tagName).toBe('BUTTON')
  })
})
