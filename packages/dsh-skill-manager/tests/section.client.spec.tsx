/**
 * Section smoke test: the skill manager section renders the catalog, its
 * switches, and the install form, and wires clicks to the injected actions.
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { describe, expect, it, vi } from 'vitest'
import { SkillManagerSection, type SkillManagerSectionProps } from '../src/client/SkillManagerSection.tsx'
import { zh } from '../src/client/locales.ts'
import type { SkillManagerState } from '../src/client/controller.ts'
import type { SkillRow } from '../src/core/protocol.ts'

const row = (name: string, extra: Partial<SkillRow> = {}): SkillRow => ({
  name,
  description: 'Description.',
  source: 'user-dsh',
  provider: 'filesystem',
  toggleable: true,
  installed: false,
  modelInvocable: true,
  userInvocable: true,
  ...extra,
})

function render(state: SkillManagerState, overrides: Partial<SkillManagerSectionProps> = {}) {
  const actions = {
    load: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    selectWorkspace: vi.fn(),
    toggle: vi.fn(async () => {}),
    setSourceKind: vi.fn(),
    setSourceValue: vi.fn(),
    setDestination: vi.fn(),
    install: vi.fn(async () => {}),
    confirmUninstall: vi.fn(),
    uninstall: vi.fn(async () => {}),
  }
  const props = {
    t: (key: string, params?: Record<string, string | number>) => {
      let text = (zh as Record<string, string>)[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
      return text
    },
    useSkillManagerSection: ((selector: (snapshot: SkillManagerState) => SkillManagerState) => selector(state)) as SkillManagerSectionProps['useSkillManagerSection'],
    ...actions,
    ...overrides,
  } as unknown as SkillManagerSectionProps
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<SkillManagerSection {...props} />) })
  return { container, root, actions }
}

function teardown(root: Root, container: HTMLDivElement): void {
  act(() => { root.unmount() })
  container.remove()
}

describe('SkillManagerSection', () => {
  it('renders the skill list with switches', () => {
    const state: SkillManagerState = {
      phase: 'ready',
      workspaces: [{ workspaceId: 'w1', title: 'Alpha', path: '/w1', sessionIds: ['s1' as import('@deepseek-ai/dsh-client-connection/client').SessionId] }],
      selectedWorkspaceId: 'w1',
      selectedSessionId: 's1' as import('@deepseek-ai/dsh-client-connection/client').SessionId,
      cwd: '/w1',
      live: true,
      skills: [row('alpha', { installed: true })],
      toggling: {},
      installing: false,
      sourceKind: 'dir',
      sourceValue: '',
      destination: 'workspace',
      uninstalling: false,
    }
    const { container, root, actions } = render(state)
    expect(container.textContent).toContain('alpha')
    expect(container.textContent).toContain('已启用')
    expect(container.textContent).toContain('卸载')
    const switchButton = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(switchButton).not.toBeNull()
    expect(switchButton.getAttribute('aria-checked')).toBe('true')
    act(() => { switchButton.click() })
    expect(actions.toggle).toHaveBeenCalledWith('alpha', false)
    teardown(root, container)
  })

  it('renders the no-session notice', () => {
    const state: SkillManagerState = {
      phase: 'ready',
      workspaces: [],
      live: false,
      skills: [],
      toggling: {},
      installing: false,
      sourceKind: 'dir',
      sourceValue: '',
      destination: 'workspace',
      uninstalling: false,
    }
    const { container, root } = render(state)
    expect(container.textContent).toContain('没有可用的会话')
    teardown(root, container)
  })

  it('renders the install form', () => {
    const state: SkillManagerState = {
      phase: 'ready',
      workspaces: [{ workspaceId: 'w1', title: 'Alpha', path: '/w1', sessionIds: ['s1' as import('@deepseek-ai/dsh-client-connection/client').SessionId] }],
      selectedWorkspaceId: 'w1',
      selectedSessionId: 's1' as import('@deepseek-ai/dsh-client-connection/client').SessionId,
      live: true,
      skills: [],
      toggling: {},
      installing: false,
      sourceKind: 'dir',
      sourceValue: '',
      destination: 'workspace',
      uninstalling: false,
    }
    const { container, root } = render(state)
    expect(container.textContent).toContain('安装技能')
    expect(container.querySelector('input[type="text"]')).not.toBeNull()
    teardown(root, container)
  })
})
