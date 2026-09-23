/** @vitest-environment jsdom */

/**
 * Mount-level smoke tests for the plugin-manager tab: the local-only
 * degradation, the read-only inventory (installing, uninstalling and switching
 * a plugin or a row belong to the official plugin manager page since
 * 0.1.6-alpha.2), the host-recorded conflict ledger with its undo and repair
 * handoff, the boot-failure repair seed, and the update compatibility gating.
 * The official UI primitives are stubbed; the injected face is a vi.fn()
 * harness.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { ComponentProps } from 'react'

// The official primitives are a closure-factory client bundle (not importable
// under vitest); stub the member the tab consumes.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  return {
    Button: (props: Record<string, unknown>) =>
      create('button', { disabled: props['disabled'], onClick: props['onClick'], className: props['className'] }, props['children']),
  }
})

import { PluginManagerTab, type PluginManagerTabInjected } from '../src/client/PluginManagerTab.tsx'
import { en, type PluginManagerKey } from '../src/client/locales.ts'
import type { ControlChange } from '../src/core/conflict.ts'
import type { InstallProgressItem, InstalledPluginItem, PluginControlItem, PluginFailureItem } from '../src/core/protocol.ts'

afterEach(cleanup)

/** English translate stub with {param} interpolation. */
const t: ComponentProps<typeof PluginManagerTab>['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key as PluginManagerKey] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

const plugin: InstalledPluginItem = {
  id: 'p1', name: 'p1', version: '1.0.0', source: { kind: 'npm', spec: '@scope/p1' }, installedAt: '2026-08-18T00:00:00.000Z', enabled: true,
}

const failure: PluginFailureItem = {
  pluginId: 'p1', kind: 'load-failure', message: 'boom', stack: 'at x', installPath: '/plugins/p1', at: '2026-08-18T00:00:00.000Z',
}

const product = (state: PluginControlItem['state']): PluginControlItem => ({
  id: 'web-ui', name: 'dsh-web', repository: 'https://github.com/zhu1090093659/dsh-web', state,
})

/** Minimal injected-face harness; every member is a spy the test overrides. */
function face(overrides: Partial<PluginManagerTabInjected> = {}): PluginManagerTabInjected {
  return {
    isLoopback: true,
    list: vi.fn(async () => [plugin]),
    update: vi.fn(async () => plugin),
    checkUpdates: vi.fn(async () => []),
    status: vi.fn(async (): Promise<InstallProgressItem> => ({ kind: 'idle', stage: 'fetch' })),
    failures: vi.fn(async () => ({ items: [], pluginRoot: '/plugins', safeMode: false })),
    setSafeMode: vi.fn(async () => {}),
    repairPlugin: vi.fn(async () => {}),
    controlsList: vi.fn(async () => []),
    controlsSetEnabled: vi.fn(async () => []),
    ...overrides,
  }
}

function renderTab(injected: PluginManagerTabInjected): void {
  render(<PluginManagerTab {...injected as unknown as ComponentProps<typeof PluginManagerTab>} t={t} />)
}

describe('PluginManagerTab aggregate children', () => {
  const aggregatePlugin: InstalledPluginItem = {
    id: '@linxin666/dsh-web-all', name: 'web-all', version: '0.3.18',
    source: { kind: 'npm', spec: '@linxin666/dsh-web-all' }, installedAt: '', enabled: false,
    children: [
      { id: 'web-ui-pet', name: '@linxin666/dsh-pet', enabled: true },
      { id: 'web-ui-plugin-manager', name: '@linxin666/dsh-client-ui-plugin-manager', enabled: true, locked: true },
    ],
  }

  /** The disclosure toggle of one aggregate row (the child list is collapsed by default). */
  const toggle = (name: string): HTMLElement => screen.getByRole('button', { name: `Show child plugins of ${name}` })

  it('collapses the child rows behind an enablement summary by default', async () => {
    renderTab(face({ list: vi.fn(async () => [aggregatePlugin]) }))
    expect(await screen.findByText('web-all')).toBeTruthy()
    expect(screen.getByText('2/2 child plugins on')).toBeTruthy()
    expect(screen.queryByText('@linxin666/dsh-pet')).toBeNull()
    expect(screen.queryByText('Core row')).toBeNull()
    expect(toggle('web-all').getAttribute('aria-expanded')).toBe('false')
  })

  it('expands child rows as read-only state labels with a locked hint', async () => {
    renderTab(face({ list: vi.fn(async () => [aggregatePlugin]) }))
    expect(await screen.findByText('web-all')).toBeTruthy()
    expect(screen.getByText('Partially on')).toBeTruthy()
    fireEvent.click(toggle('web-all'))
    expect(await screen.findByText('@linxin666/dsh-pet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide child plugins of web-all' }).getAttribute('aria-expanded')).toBe('true')
    // Switching moved to the official page: the child list is state only.
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getAllByText('On').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Core row')).toBeTruthy()
    expect(screen.getByText(/switched on the official plugin manager page/)).toBeTruthy()
  })

  it('collapses the child list again on a second click', async () => {
    renderTab(face({ list: vi.fn(async () => [aggregatePlugin]) }))
    expect(await screen.findByText('web-all')).toBeTruthy()
    fireEvent.click(toggle('web-all'))
    expect(await screen.findByText('@linxin666/dsh-pet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide child plugins of web-all' }))
    await waitFor(() => expect(screen.queryByText('@linxin666/dsh-pet')).toBeNull())
  })

  it('expands each aggregate row independently', async () => {
    const second: InstalledPluginItem = {
      id: '@linxin666/dsh-other-all', name: 'other-all', version: '0.1.0',
      source: { kind: 'npm', spec: '@linxin666/dsh-other-all' }, installedAt: '', enabled: true,
      children: [{ id: 'web-ui-other', name: '@linxin666/dsh-other', enabled: true }],
    }
    renderTab(face({ list: vi.fn(async () => [aggregatePlugin, second]) }))
    expect(await screen.findByText('other-all')).toBeTruthy()
    fireEvent.click(toggle('other-all'))
    expect(await screen.findByText('@linxin666/dsh-other')).toBeTruthy()
    expect(screen.queryByText('@linxin666/dsh-pet')).toBeNull()
    expect(screen.getByText('1/1 child plugins on')).toBeTruthy()
  })
})

describe('PluginManagerTab', () => {
  it('renders the local-only notice and nothing else when not loopback', async () => {
    renderTab(face({ isLoopback: false }))
    expect(screen.getByText(t('localOnlyTitle'))).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('renders the read-only inventory and points at the official page', async () => {
    renderTab(face())
    expect(await screen.findByText('p1')).toBeTruthy()
    expect(screen.getByText('Installed 1.0.0')).toBeTruthy()
    expect(screen.getByText('On')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(t('manageElsewhere'))).toBeTruthy()
  })

  it('hands one boot failure to a repair conversation over the plugin root', async () => {
    const injected = face({
      failures: vi.fn(async () => ({ items: [failure], pluginRoot: '/plugins', safeMode: false })),
    })
    renderTab(injected)

    expect(await screen.findByText('boom')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('repair') }))
    await waitFor(() => {
      expect(injected.repairPlugin).toHaveBeenCalledTimes(1)
    })
    const [root, message] = vi.mocked(injected.repairPlugin).mock.calls[0] as [string, string]
    expect(root).toBe('/plugins')
    expect(message).toContain('boom')
    expect(message).toContain(t('repairFailureTitle'))
  })

  it('shows the host-recorded conflict ledger and undoes a disabled product', async () => {
    const change: ControlChange = { id: 'web-ui', name: 'dsh-web', from: 'enabled', to: 'disabled' }
    const injected = face({
      lastInstallConflicts: () => [change],
      controlsList: vi.fn(async () => [product('disabled')]),
      controlsSetEnabled: vi.fn(async () => [product('enabled')]),
    })
    renderTab(injected)

    expect(await screen.findByText(t('conflictDisabled', { name: 'dsh-web' }))).toBeTruthy()

    // Every conflict row offers the repair handoff with a seeded conflict message.
    fireEvent.click(screen.getByRole('button', { name: t('repair') }))
    await waitFor(() => {
      expect(injected.repairPlugin).toHaveBeenCalledTimes(1)
    })
    const [, conflictMessage] = vi.mocked(injected.repairPlugin).mock.calls[0] as [string, string]
    expect(conflictMessage).toContain('dsh-web (web-ui)')
    expect(conflictMessage).toContain(t('repairConflictTitle'))

    fireEvent.click(screen.getByRole('button', { name: t('undoConflict') }))
    await waitFor(() => {
      expect(injected.controlsSetEnabled).toHaveBeenCalledWith('web-ui', true)
    })
    await waitFor(() => {
      expect(screen.queryByText(t('conflictDisabled', { name: 'dsh-web' }))).toBeNull()
    })
  })

  it('shows the safe-mode banner with its restore affordance', async () => {
    const injected = face({
      failures: vi.fn(async () => ({ items: [], pluginRoot: '/plugins', safeMode: true })),
    })
    renderTab(injected)
    expect(await screen.findByText(t('safeModeBanner'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('exitSafeMode') }))
    await waitFor(() => {
      expect(injected.setSafeMode).toHaveBeenCalledWith(false)
    })
  })

  describe('DSH compatibility gating', () => {
    it('disables update and shows the requirement hint when the update is incompatible', async () => {
      const injected = face({
        checkUpdates: vi.fn(async () => [{
          id: 'p1', current: '1.0.0', latest: '1.1.0', requiresDsh: '>=0.1.0-rc.8', compatible: false,
        }]),
      })
      renderTab(injected)

      await screen.findByText('p1')
      fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
      expect(await screen.findByText(t('updateBlockedDsh', { min: '0.1.0-rc.8' }))).toBeTruthy()
      const updateButton = screen.getByRole('button', { name: t('update') })
      expect((updateButton as HTMLButtonElement).disabled).toBe(true)
    })

    it('keeps update enabled and shows the requirement note when compatible', async () => {
      const injected = face({
        checkUpdates: vi.fn(async () => [{
          id: 'p1', current: '1.0.0', latest: '1.1.0', requiresDsh: '>=0.1.0-rc.8', compatible: true,
        }]),
      })
      renderTab(injected)

      await screen.findByText('p1')
      fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
      expect(await screen.findByText(t('updateRequiresDsh', { min: '0.1.0-rc.8' }))).toBeTruthy()
      const updateButton = screen.getByRole('button', { name: t('update') })
      expect((updateButton as HTMLButtonElement).disabled).toBe(false)
    })

    it('keeps the update flow unchanged (fail open) when compatibility is unknown', async () => {
      const injected = face({
        checkUpdates: vi.fn(async () => [{ id: 'p1', current: '1.0.0', latest: '1.1.0' }]),
        update: vi.fn(async () => plugin),
      })
      renderTab(injected)

      await screen.findByText('p1')
      fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
      expect(await screen.findByText(t('latest', { version: '1.1.0' }))).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: t('update') }))
      await waitFor(() => {
        expect(injected.update).toHaveBeenCalledWith('p1')
      })
    })
  })
})
