/** @vitest-environment jsdom */

/**
 * Mount-level smoke tests for the check-for-updates patch this package now
 * contributes into the official Plugins page's `plugins.detail.section` seat:
 * where it renders, what an explicit registry check reports, the DSH-runtime
 * gate on the update action, and what a successful or failed update leaves on
 * the page. The injected face is a plain object of fakes passed as props, so
 * nothing is patched into the module graph.
 *
 * Assertions read the section's own state attributes rather than re-checking
 * that a string exists, so a wrong version, a missing gate or a swallowed
 * error fails the test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { ComponentProps } from 'react'
import { PluginUpdatePatch, type PluginUpdatePatchInjected, type PluginPageSubject } from '../src/client/PluginUpdatePatch.tsx'
import { en, type PluginManagerKey } from '../src/client/locales.ts'
import type { InstallProgressItem, PluginUpdateItem } from '../src/core/protocol.ts'

afterEach(cleanup)

/** English translate stub with {param} interpolation. */
const t: ComponentProps<typeof PluginUpdatePatch>['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key as PluginManagerKey] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** An installed bundle's page subject, as the official page renders it. */
function bundlePage(installed = true): PluginPageSubject {
  return {
    kind: 'bundle',
    pkg: {
      name: '@linxin666/dsh-web-all',
      version: '0.4.2',
      installed,
      enabled: true,
      rows: [{ rowId: 'web-ui-pet', moduleName: '@linxin666/dsh-pet', enabled: true }],
    },
  }
}

/** The available update the registry reported for this page's bundle. */
const updateItem: PluginUpdateItem = {
  id: '@linxin666/dsh-web-all', current: '0.4.2', latest: '0.5.0',
}

/** A face fake; every member is overridable per case. */
function face(overrides: Partial<PluginUpdatePatchInjected> = {}): PluginUpdatePatchInjected {
  return {
    isLoopback: true,
    checkUpdates: async () => [],
    update: async () => undefined,
    status: async (): Promise<InstallProgressItem> => ({ kind: 'idle', stage: 'fetch' }),
    ...overrides,
  }
}

/** Render the patch and hand back the mounted section. */
function renderPatch(injected: PluginUpdatePatchInjected, subject: PluginPageSubject = bundlePage()): HTMLElement {
  const { container } = render(
    <PluginUpdatePatch
      {...injected as unknown as ComponentProps<typeof PluginUpdatePatch>}
      subject={subject}
      t={t}
    />,
  )
  return container.querySelector('[data-update-patch]') as HTMLElement
}

/** The update action, present only once a newer release was found. */
function updateAction(): HTMLButtonElement {
  return screen.getByRole('button', { name: t('update') }) as HTMLButtonElement
}

describe('update patch placement', () => {
  it('user sees no update section on a page that is not an installed bundle', () => {
    // Given an uninstalled bundle page
    const { container } = render(
      <PluginUpdatePatch {...face() as unknown as ComponentProps<typeof PluginUpdatePatch>} subject={bundlePage(false)} t={t} />,
    )

    // When the page renders
    const section = container.querySelector('[data-update-patch]')

    // Then the patch contributes no section at all
    expect(section).toBeNull()
  })

  it('user sees no update section on an official plugin page, which has no package to compare', () => {
    // Given the official-plugin subject shape
    const { container } = render(
      <PluginUpdatePatch {...face() as unknown as ComponentProps<typeof PluginUpdatePatch>} subject={{ kind: 'item', id: 'shell' }} t={t} />,
    )

    // When the page renders
    const section = container.querySelector('[data-update-patch]')

    // Then no update section appears
    expect(section).toBeNull()
  })

  it('guest on a remote browser is told the check is local-only instead of getting the action', () => {
    // Given a non-loopback browser on an installed bundle page
    const section = renderPatch(face({ isLoopback: false }))

    // When the section renders
    const state = section.getAttribute('data-state')

    // Then it degrades to the local-only notice and offers no check action
    expect(state).toBe('local-only')
    expect(screen.queryByRole('button', { name: t('checkUpdates') })).toBeNull()
  })
})

describe('update check', () => {
  it('user is shown the latest version once the registry reports a newer release', async () => {
    // Given a bundle whose registry source serves a newer version
    renderPatch(face({ checkUpdates: async () => [updateItem] }))

    // When the user asks for a check
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // Then the section records the version the update would install
    await waitFor(() => { expect(document.querySelector('[data-update-latest]')?.getAttribute('data-update-latest')).toBe('0.5.0') })
  })

  it('user is told the installed version is current when the registry has nothing newer', async () => {
    // Given every plugin is already current
    const section = renderPatch(face({ checkUpdates: async () => [] }))

    // When the user asks for a check
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // Then the section says so and offers no update action
    await waitFor(() => { expect(section.textContent).toContain(t('noUpdates')) })
    expect(screen.queryByRole('button', { name: t('update') })).toBeNull()
  })

  it('user keeps the check failure inside the section instead of losing the page', async () => {
    // Given the registry read fails
    const section = renderPatch(face({ checkUpdates: async () => { throw new Error('registry down') } }))

    // When the user asks for a check
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))

    // Then the section records that failure as its own error row
    await waitFor(() => { expect(section.querySelector('[data-update-error]')?.textContent).toBe(t('failed', { reason: 'registry down' })) })
  })

  it('user clicking twice in one frame still reads the registry once', async () => {
    // Given a check that resolves with a newer release
    const checkUpdates = vi.fn(async () => [updateItem])
    renderPatch(face({ checkUpdates }))

    // When the user clicks the check action twice in the same frame
    const button = screen.getByRole('button', { name: t('checkUpdates') })
    fireEvent.click(button)
    fireEvent.click(button)

    // Then the section shows that one answer and the registry answered once
    await waitFor(() => { expect(document.querySelector('[data-update-latest]')?.getAttribute('data-update-latest')).toBe('0.5.0') })
    expect(checkUpdates).toHaveBeenCalledTimes(1)
  })
})

describe('update application', () => {
  it('user applies the update for the page bundle and is asked to restart', async () => {
    // Given a newer release was found
    const update = vi.fn(async (_id: string) => undefined)
    const section = renderPatch(face({ checkUpdates: async () => [updateItem], update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // When the user applies the update
    fireEvent.click(updateAction())

    // Then the page's own bundle was updated and the section asks for a restart
    await waitFor(() => { expect(section.textContent).toContain(t('restartHint')) })
    expect(update.mock.calls[0]?.[0]).toBe('@linxin666/dsh-web-all')
  })

  it('user cannot apply a release whose declared DSH minimum this host misses', async () => {
    // Given the release declares a DSH minimum this host read and did not satisfy
    renderPatch(face({
      checkUpdates: async () => [{ ...updateItem, requiresDsh: '>=0.2.0', compatible: false, hostVersion: '0.1.0-rc.7' }],
    }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat')).toBe('blocked') })

    // When the user looks at the update action
    const action = updateAction()

    // Then it is disabled, the section names the requirement, and it says to
    // upgrade DSH — the host proved that is what is missing
    expect(action.disabled).toBe(true)
    expect(action.closest('[data-update-patch]')?.textContent).toContain(t('updateBlockedDsh', { min: '0.2.0' }))
    expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat-reason')).toBe('below-minimum')
  })

  it('user is told the host version could not be confirmed instead of being sent to upgrade DSH', async () => {
    // Given a release whose requirement the host could not check, so no host
    // version came back with the verdict
    renderPatch(face({
      checkUpdates: async () => [{ ...updateItem, requiresDsh: '>=0.2.0', compatible: false }],
    }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat')).toBe('blocked') })

    // When the user reads the section
    const action = updateAction()

    // Then the update is still held back, but the copy says the version could
    // not be confirmed rather than asserting the running DSH is too old
    expect(action.disabled).toBe(true)
    const section = action.closest('[data-update-patch]')
    expect(section?.textContent).toContain(t('updateUnverifiedDsh', { min: '0.2.0' }))
    expect(section?.textContent).not.toContain(t('updateBlockedDsh', { min: '0.2.0' }))
    expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat-reason')).toBe('unverified')
  })

  it('user keeps an update failure inside the section instead of losing the page', async () => {
    // Given the update itself fails
    const section = renderPatch(face({
      checkUpdates: async () => [updateItem],
      update: async () => { throw new Error('pnpm exited 1') },
    }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // When the user applies the update
    fireEvent.click(updateAction())

    // Then the section records the failure as its own error row
    await waitFor(() => { expect(section.querySelector('[data-update-error]')?.textContent).toBe(t('failed', { reason: 'pnpm exited 1' })) })
  })
})
