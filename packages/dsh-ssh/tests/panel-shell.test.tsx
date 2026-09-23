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
import { mountPanel } from '../src/client/mount.tsx'
import { SshPanel } from '../src/client/panel/SshPanel.tsx'
import type { SshApi } from '../src/client/api.ts'
import { PanelController } from '../src/client/panel/controller.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
let disposeMount: (() => void) | undefined

afterEach(() => {
  act(() => { disposeMount?.() })
  disposeMount = undefined
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
  } as unknown as SshApi
}

function fakeController(): PanelController {
  return {
    getSnapshot: () => ({ panelOpen: false }),
    subscribe: () => () => {},
    close: () => {},
  } as unknown as PanelController
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
    expect(tabs.length).toBe(5)
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

describe('mountPanel L2 semantic attributes (#506)', () => {
  it('tags the injected panel container with data-dsh-plugin', async () => {
    const column = document.createElement('div')
    column.setAttribute('data-pane', 'conversation')
    document.body.appendChild(column)

    await act(async () => { disposeMount = mountPanel(fakeController(), fakeApi()) })

    const view = column.querySelector('[data-dsh-ssh-view]')
    expect(view).not.toBeNull()
    expect(view!.getAttribute('data-dsh-plugin')).toBe('ssh')
  })

  it('defers initial host reads and pauses tunnel polling without losing the selected tab', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<main data-pane="conversation"></main>'
    const controller = new PanelController()
    const listHosts = vi.fn(async () => [])
    const listTunnels = vi.fn(async () => [])
    const api = { listHosts, listTunnels } as unknown as SshApi
    await act(async () => { disposeMount = mountPanel(controller, api) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(listHosts).not.toHaveBeenCalled()
    expect(document.querySelector('[role="tablist"]')).toBeNull()

    await act(async () => { controller.open() })
    expect(listHosts).toHaveBeenCalled()
    const tunnels = document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[3]
    await act(async () => { tunnels.click() })
    expect(listTunnels).toHaveBeenCalledOnce()
    await act(async () => { controller.close() })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(listTunnels).toHaveBeenCalledOnce()
    await act(async () => { controller.open() })
    expect(document.querySelectorAll('[role="tab"]')[3]).toBe(tunnels)
    expect(tunnels.getAttribute('aria-selected')).toBe('true')
    expect(listTunnels).toHaveBeenCalledTimes(2)
  })
})
