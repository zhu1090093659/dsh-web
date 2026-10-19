/** @vitest-environment jsdom */

/**
 * The list-level update toolbar on the official Plugins page: what it offers
 * before and after a check, which rows the bulk action may touch (third-party,
 * compatibility-gated), what a failed update leaves on screen, and the restart
 * handshake. The injected face is a plain object of fakes passed as props, so
 * nothing is patched into the module graph.
 *
 * Assertions read the toolbar's own state attributes, its rendered copy and the
 * calls the fake face received, so a wrong row set, a swallowed failure, or a
 * bulk run that touches an official package fails the test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { ComponentProps } from 'react'
import { PluginListToolbar } from '../src/client/PluginListToolbar.tsx'
import { en, type PluginManagerKey } from '../src/client/locales.ts'
import type { PluginUpdateItem } from '../src/core/protocol.ts'

afterEach(cleanup)

/** English translate stub with {param} interpolation. */
const t: ComponentProps<typeof PluginListToolbar>['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key as PluginManagerKey] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** A face fake; every member is overridable per case. */
function face(overrides: Partial<ComponentProps<typeof PluginListToolbar>> = {}) {
  return {
    isLoopback: true,
    checkUpdates: vi.fn(async (): Promise<PluginUpdateItem[]> => []),
    update: vi.fn(async () => undefined),
    restartPlan: vi.fn(async () => 'relaunch' as const),
    restart: vi.fn(async () => 'relaunch' as const),
    ...overrides,
  }
}

/** Render the toolbar and hand back its root. */
function renderToolbar(injected: ReturnType<typeof face>): HTMLElement {
  const { container } = render(
    <PluginListToolbar {...injected as unknown as ComponentProps<typeof PluginListToolbar>} t={t} />,
  )
  return container.querySelector('[data-update-toolbar]') as HTMLElement
}

/** The summary control's rendered copy. */
function summaryText(): string {
  return document.querySelector('[data-update-summary]')?.textContent ?? ''
}

/** The update rows the flyout currently lists, by package id. */
function listedRows(): string[] {
  return [...document.querySelectorAll('[data-update-row]')].map(row => row.getAttribute('data-update-row') ?? '')
}

/** A third-party row with an update available. */
const thirdParty: PluginUpdateItem = { id: 'dsh-usage', current: '0.9.1', latest: '0.9.2' }
/** A DSH-shipped package: listed by the host, never updated in bulk. */
const official: PluginUpdateItem = { id: '@deepseek-ai/dsh-client-ui-chat', current: '0.2.0', latest: '0.3.0' }

describe('update toolbar gating', () => {
  it('user on a remote browser gets no usable action', () => {
    // Given a browser without loopback authority
    const toolbar = renderToolbar(face({ isLoopback: false }))

    // When the toolbar renders
    const check = screen.getByRole('button', { name: t('checkUpdates') }) as HTMLButtonElement

    // Then the only control is the disabled check button, explained in place
    expect(toolbar.getAttribute('data-state')).toBe('local-only')
    expect(check.disabled).toBe(true)
    expect(check.getAttribute('title')).toBe(t('localOnlyBody'))
    expect(screen.queryByRole('button', { name: t('restartNow') })).toBeNull()
  })
})

describe('checking every installed plugin', () => {
  it('user sees the third-party count and only the third-party rows', async () => {
    // Given an installed set with one third-party and one shipped package
    const injected = face({ checkUpdates: vi.fn(async () => [thirdParty, official]) })
    renderToolbar(injected)

    // When the user checks for updates
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // Then the summary counts the third-party update and the flyout lists only it
    await waitFor(() => { expect(summaryText()).toBe(t('updatesAvailable', { count: '1' })) })
    expect(listedRows()).toEqual(['dsh-usage'])
    expect(document.querySelector('[data-update-row="dsh-usage"]')?.getAttribute('data-compatible')).toBe('yes')
  })

  it('user is told when nothing needs updating', async () => {
    // Given every installed plugin is current
    renderToolbar(face({ checkUpdates: vi.fn(async () => [official]) }))

    // When the user checks for updates
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // Then the summary reports the latest version and no bulk action is offered
    await waitFor(() => { expect(summaryText()).toBe(t('noUpdates')) })
    expect(document.querySelector('[data-update-all]')).toBeNull()
  })

  it('user sees the host reason when a check fails', async () => {
    // Given the host refuses the check
    renderToolbar(face({ checkUpdates: vi.fn(async () => { throw new Error('registry unreachable') }) }))

    // When the user checks for updates
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // Then the failure text carries the reason
    await waitFor(() => {
      expect(document.querySelector('[data-update-error]')?.textContent).toContain('registry unreachable')
    })
  })
})

describe('updating every third-party plugin', () => {
  it('user applies every applicable row in one run', async () => {
    // Given two third-party updates and one shipped package
    const update = vi.fn(async (_id: string) => undefined)
    const second: PluginUpdateItem = { id: 'dsh-weather', current: '1.0.0', latest: '1.1.0' }
    renderToolbar(face({ checkUpdates: vi.fn(async () => [thirdParty, second, official]), update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-all]')?.textContent).toBe(t('updateAll', { count: '2' })) })

    // When the user updates everything
    fireEvent.click(document.querySelector('[data-update-all]') as HTMLElement)

    // Then exactly the third-party rows were updated and the restart is offered
    await waitFor(() => {
      expect(document.querySelector('[data-update-restart]')?.getAttribute('data-restart-pending')).toBe('2')
    })
    expect(update.mock.calls.map(call => call[0])).toEqual(['dsh-usage', 'dsh-weather'])
    expect(listedRows()).toEqual([])
    expect(document.querySelector('[data-update-applied]')?.textContent).toBe(t('updateAllDone'))
  })

  it('user sees a row below the declared DSH minimum listed but never applied', async () => {
    // Given an update whose manifest needs a newer DSH
    const blocked: PluginUpdateItem = { id: 'dsh-future', current: '1.0.0', latest: '2.0.0', requiresDsh: '>=9.0.0', compatible: false }
    const update = vi.fn(async (_id: string) => undefined)
    renderToolbar(face({ checkUpdates: vi.fn(async () => [blocked]), update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // When the check settles
    await waitFor(() => { expect(listedRows()).toEqual(['dsh-future']) })

    // Then it is listed with its gate and the bulk action is not offered
    expect(document.querySelector('[data-update-row="dsh-future"]')?.getAttribute('data-compatible')).toBe('no')
    expect(document.querySelector('[data-update-row="dsh-future"]')?.textContent).toContain('9.0.0')
    expect(document.querySelector('[data-update-all]')).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('user reads the same verdict on a row the host could not verify as on a row below the minimum', async () => {
    // Given one row the host proved too old and one it could not verify, so
    // only the second comes back without the running DSH version
    const below: PluginUpdateItem = {
      id: 'dsh-too-old', current: '1.0.0', latest: '2.0.0', requiresDsh: '>=9.0.0', compatible: false, hostVersion: '0.2.1-rc.2',
    }
    const unverified: PluginUpdateItem = {
      id: 'dsh-unverified', current: '1.0.0', latest: '2.0.0', requiresDsh: '>=9.0.0', compatible: false,
    }
    renderToolbar(face({ checkUpdates: vi.fn(async () => [below, unverified]) }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // When the check settles
    await waitFor(() => { expect(listedRows()).toEqual(['dsh-too-old', 'dsh-unverified']) })

    // Then each row is named by its own verdict: only the compared one tells
    // the user to upgrade DSH, and neither is offered to the bulk action
    const belowRow = document.querySelector('[data-update-row="dsh-too-old"]')
    const unverifiedRow = document.querySelector('[data-update-row="dsh-unverified"]')
    expect(belowRow?.querySelector('[data-update-row-compat-reason]')?.getAttribute('data-update-row-compat-reason')).toBe('below-minimum')
    expect(belowRow?.textContent).toContain(t('updateBlockedDsh', { min: '9.0.0' }))
    expect(unverifiedRow?.querySelector('[data-update-row-compat-reason]')?.getAttribute('data-update-row-compat-reason')).toBe('unverified')
    expect(unverifiedRow?.textContent).toContain(t('updateUnverifiedDsh', { min: '9.0.0' }))
    expect(unverifiedRow?.textContent).not.toContain(t('updateBlockedDsh', { min: '9.0.0' }))
    expect(document.querySelector('[data-update-all]')).toBeNull()
  })

  it('user sees a failed update stop the run and keep the rest listed', async () => {
    // Given the first row cannot be installed
    const second: PluginUpdateItem = { id: 'dsh-weather', current: '1.0.0', latest: '1.1.0' }
    const update = vi.fn(async (id: string) => {
      if (id === 'dsh-usage') throw new Error('pnpm refused the install')
    })
    renderToolbar(face({ checkUpdates: vi.fn(async () => [thirdParty, second]), update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-all]')?.textContent).toBe(t('updateAll', { count: '2' })) })

    // When the user updates everything
    fireEvent.click(document.querySelector('[data-update-all]') as HTMLElement)

    // Then the reason is shown and the untouched row remains listed
    await waitFor(() => {
      expect(document.querySelector('[data-update-error]')?.textContent).toContain('pnpm refused the install')
    })
    expect(listedRows()).toEqual(['dsh-usage', 'dsh-weather'])
    expect(update.mock.calls.map(call => call[0])).toEqual(['dsh-usage'])
    // Nothing was applied, so the summary still counts both rows.
    expect(summaryText()).toBe(t('updatesAvailable', { count: '2' }))
  })

  it('user sees the summary count drop as rows are applied', async () => {
    // Given the second of two updates cannot be installed
    const second: PluginUpdateItem = { id: 'dsh-weather', current: '1.0.0', latest: '1.1.0' }
    const update = vi.fn(async (id: string) => {
      if (id === 'dsh-weather') throw new Error('pnpm refused the install')
    })
    renderToolbar(face({ checkUpdates: vi.fn(async () => [thirdParty, second]), update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-all]')?.textContent).toBe(t('updateAll', { count: '2' })) })

    // When the user updates everything
    fireEvent.click(document.querySelector('[data-update-all]') as HTMLElement)

    // Then the applied row left the list and the summary counts only the rest
    await waitFor(() => {
      expect(document.querySelector('[data-update-error]')?.textContent).toContain('pnpm refused the install')
    })
    expect(listedRows()).toEqual(['dsh-weather'])
    expect(summaryText()).toBe(t('updatesAvailable', { count: '1' }))
    expect(document.querySelector('[data-update-applied]')?.textContent).toBe(t('updateAllDone'))
  })
})

describe('restarting to apply the updates', () => {
  it('user is told what the restart will do before anything happens', async () => {
    // Given a host that relaunches itself in place
    const restart = vi.fn(async () => 'relaunch' as const)
    renderToolbar(face({ restart }))

    // When the user asks to restart
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))

    // Then the confirmation names the consequence and nothing has run yet
    await waitFor(() => {
      expect(document.querySelector('[data-restart-plan-hint]')?.textContent).toBe(t('restartPlanRelaunch'))
    })
    expect(restart.mock.calls).toHaveLength(0)

    // When the user confirms
    fireEvent.click(document.querySelector('[data-restart-confirm]') as HTMLElement)

    // Then the host was asked once and the relaunch hint is on screen
    await waitFor(() => {
      expect(document.querySelector('[data-update-restart-hint]')?.getAttribute('data-update-restart-hint')).toBe('relaunch')
    })
    expect(restart.mock.calls).toHaveLength(1)
    // The action is spent: the button now reads as the restart in progress.
    expect(document.querySelector('[data-update-restart]')?.textContent).toBe(t('restarting'))
  })

  it('user on a packaged Desktop host is told the system dialog does the restart', async () => {
    // Given the host reports that the Desktop shell owns the process tree
    const restart = vi.fn(async () => 'shell' as const)
    renderToolbar(face({ restartPlan: vi.fn(async () => 'shell' as const), restart }))

    // When the user asks to restart
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))

    // Then the confirmation names the system dialog, its crash report and the manual way out
    await waitFor(() => {
      expect(document.querySelector('[data-restart-plan-hint]')?.textContent).toBe(t('restartPlanShell'))
    })
    expect(document.querySelector('[data-restart-plan]')?.getAttribute('data-restart-plan')).toBe('shell')
    expect(document.querySelector('[data-update-restart-panel]')?.textContent).toContain(t('restartShellWarning'))
    expect(document.querySelector('[data-restart-confirm]')?.textContent).toBe(t('restartConfirm'))
    expect(restart.mock.calls).toHaveLength(0)

    // When the user confirms
    fireEvent.click(document.querySelector('[data-restart-confirm]') as HTMLElement)

    // Then the host is asked once and the hint points at its own dialog
    await waitFor(() => {
      expect(document.querySelector('[data-update-restart-hint]')?.textContent).toBe(t('restartDesktopHint'))
    })
    expect(restart.mock.calls).toHaveLength(1)
  })

  it('user on a host that cannot restart itself gets instructions and no action', async () => {
    // Given the host reports that it cannot be replaced
    const restart = vi.fn(async () => 'manual' as const)
    renderToolbar(face({ restartPlan: vi.fn(async () => 'manual' as const), restart }))

    // When the user asks to restart
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))

    // Then only the instruction is shown, with no confirm action to press
    await waitFor(() => {
      expect(document.querySelector('[data-restart-plan-hint]')?.textContent).toBe(t('restartPlanManual'))
    })
    expect(document.querySelector('[data-restart-confirm]')).toBeNull()
    expect(restart.mock.calls).toHaveLength(0)
  })

  it('user can back out of the restart confirmation', async () => {
    // Given the confirmation is open
    const restart = vi.fn(async () => 'relaunch' as const)
    renderToolbar(face({ restart }))
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))
    await waitFor(() => {
      expect(document.querySelector('[data-restart-confirm]')?.textContent).toBe(t('restartConfirm'))
    })

    // When the user cancels
    fireEvent.click(document.querySelector('[data-restart-cancel]') as HTMLElement)

    // Then no restart was requested and the confirmation is gone
    expect(restart.mock.calls).toHaveLength(0)
    expect(document.querySelector('[data-update-restart-panel]')).toBeNull()
  })

  it('user sees a refused restart reported, not hidden', async () => {
    // Given the host rejects the restart request
    renderToolbar(face({ restart: vi.fn(async () => { throw new Error('forbidden: loopback-only') }) }))
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))
    await waitFor(() => {
      expect(document.querySelector('[data-restart-confirm]')?.textContent).toBe(t('restartConfirm'))
    })

    // When the user confirms a restart
    fireEvent.click(document.querySelector('[data-restart-confirm]') as HTMLElement)

    // Then the failure is visible
    await waitFor(() => {
      expect(document.querySelector('[data-update-error]')?.textContent).toContain('forbidden: loopback-only')
    })
  })

  it('user sees a failed restart-plan read reported', async () => {
    // Given the host cannot answer how it would restart
    renderToolbar(face({ restartPlan: vi.fn(async () => { throw new Error('plugin-manager: restart unavailable') }) }))

    // When the user asks to restart
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))

    // Then the failure is reported and no confirmation is offered
    await waitFor(() => {
      expect(document.querySelector('[data-update-error]')?.textContent).toContain('restart unavailable')
    })
    expect(document.querySelector('[data-update-restart-panel]')).toBeNull()
  })
})
