/**
 * Tab smoke test: the plugin manager tab renders the inventory, its
 * switches, and the protected state, and wires clicks to the injected
 * actions.
 */

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PluginManagerTab, type PluginManagerTabProps } from '../src/client/PluginManagerTab.tsx'
import { zh, type PluginManagerKey } from '../src/client/locales.ts'
import type { PluginManagerState } from '../src/client/controller.ts'
import type { PluginRow } from '../src/protocol.ts'

const row = (entryId: string, extra: Partial<PluginRow> = {}): PluginRow => ({
  entryId,
  moduleName: '@linxin666/dsh-client-ui-' + entryId,
  enabled: true,
  fiberPhase: 'active',
  protected: false,
  official: true,
  ...extra,
})

function render(state: PluginManagerState, overrides: Partial<PluginManagerTabProps> = {}) {
  const actions = {
    load: vi.fn(async () => {}),
    toggle: vi.fn(async () => {}),
  }
  const props: PluginManagerTabProps = {
    t: (key, params) => {
      let text = zh[key as PluginManagerKey] ?? key
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
      return text
    },
    useSessions: (() => undefined) as unknown as PluginManagerTabProps['useSessions'],
    useWorkspaces: (() => undefined) as unknown as PluginManagerTabProps['useWorkspaces'],
    usePluginManager: ((selector: (snapshot: PluginManagerState) => unknown) => selector(state)) as unknown as PluginManagerTabProps['usePluginManager'],
    ...actions,
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<PluginManagerTab {...props} />) })
  return { container, root, actions }
}

function teardown(root: Root, container: HTMLDivElement): void {
  act(() => { root.unmount() })
  container.remove()
}

describe('PluginManagerTab', () => {
  it('renders the inventory with switches', () => {
    const state: PluginManagerState = {
      phase: 'ready',
      entries: [row('task-board')],
      toggling: {},
      rowNotices: {},
    }
    const { container, root, actions } = render(state)
    expect(container.textContent).toContain('task-board')
    expect(container.textContent).toContain('已启用')
    const switchButton = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(switchButton).not.toBeNull()
    expect(switchButton.getAttribute('aria-checked')).toBe('true')
    act(() => { switchButton.click() })
    expect(actions.toggle).toHaveBeenCalledWith('task-board', false)
    teardown(root, container)
  })

  it('disables the switch for protected rows', () => {
    const state: PluginManagerState = {
      phase: 'ready',
      entries: [row('include', { entryId: 'include', moduleName: 'cordis:include', protected: true, official: false })],
      toggling: {},
      rowNotices: {},
    }
    const { container, root, actions } = render(state)
    const switchButton = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(switchButton.disabled).toBe(true)
    expect(container.textContent).toContain('受保护')
    act(() => { switchButton.click() })
    expect(actions.toggle).not.toHaveBeenCalled()
    teardown(root, container)
  })

  it('filters rows by the search query', () => {
    const state: PluginManagerState = {
      phase: 'ready',
      entries: [row('task-board'), row('pet', { moduleName: '@linxin666/dsh-pet' })],
      toggling: {},
      rowNotices: {},
    }
    const { container, root } = render(state)
    const input = container.querySelector('input[type="search"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'pet')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('pet')
    expect(container.textContent).not.toContain('task-board')
    teardown(root, container)
  })

  it('renders loading and error phases', () => {
    const loading = render({ phase: 'loading', entries: [], toggling: {}, rowNotices: {} })
    expect(loading.container.textContent).toContain('正在读取插件清单')
    teardown(loading.root, loading.container)
    const failed = render({ phase: 'error', error: 'boom', entries: [], toggling: {}, rowNotices: {} })
    expect(failed.container.textContent).toContain('读取插件清单失败')
    expect(failed.container.textContent).toContain('boom')
    teardown(failed.root, failed.container)
  })
})