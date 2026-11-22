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
import type { InstallProgressItem, PluginUpdateItem, PluginUpdateResult } from '../src/core/protocol.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

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

/**
 * The result one applied update resolves with: the row at the version that
 * landed, plus the bundles only a restart loads (empty for an in-place update).
 */
function landed(version: string, restartRequired: string[] = []): PluginUpdateResult {
  return {
    plugin: {
      id: '@linxin666/dsh-web-all',
      name: '@linxin666/dsh-web-all',
      version,
      source: { kind: 'npm', spec: `@linxin666/dsh-web-all@${version}` },
      installedAt: '2026-10-01T00:00:00.000Z',
      enabled: true,
    },
    restartRequired,
  }
}

/** A face fake; every member is overridable per case. */
function face(overrides: Partial<PluginUpdatePatchInjected> = {}): PluginUpdatePatchInjected {
  return {
    isLoopback: true,
    checkUpdates: async () => [],
    update: async () => landed('0.5.0'),
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

  it('user ignores and restores one version, and a newer release is offered again', async () => {
    // Given a newer release for this page's bundle
    let latest = '0.5.0'
    const update = vi.fn(async (_id: string) => landed(latest))
    renderPatch(face({ checkUpdates: async () => [{ ...updateItem, latest }], update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // When that exact version is ignored
    fireEvent.click(screen.getByRole('button', { name: t('ignoreUpdate') }))

    // Then the update action is replaced by an explanation and a restore action
    await waitFor(() => { expect(document.querySelector('[data-update-ignored]')?.textContent).toBe(t('ignoredUpdate')) })
    expect(screen.queryByRole('button', { name: t('update') })).toBeNull()
    expect(update).not.toHaveBeenCalled()

    // A restore brings the same offer back
    fireEvent.click(screen.getByRole('button', { name: t('restoreUpdate') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // Ignoring 0.5.0 does not suppress the later 0.6.0 offer
    fireEvent.click(screen.getByRole('button', { name: t('ignoreUpdate') }))
    await waitFor(() => { expect(document.querySelector('[data-update-ignored]')?.textContent).toBe(t('ignoredUpdate')) })
    latest = '0.6.0'
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-latest]')?.getAttribute('data-update-latest')).toBe('0.6.0') })
    expect(updateAction().disabled).toBe(false)
  })

  it('user sees no compatibility line for a release that declares no DSH requirement', async () => {
    // Given a release whose manifest declares no DSH minimum at all
    renderPatch(face({ checkUpdates: async () => [updateItem] }))

    // When the user asks for a check
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // Then nothing claims a compatibility verdict that was never asked for
    expect(document.querySelector('[data-update-compat]')).toBeNull()
    expect(document.querySelector('[data-update-patch]')?.textContent).not.toContain(t('updateUnverifiedDshUnknownRange'))
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
    const update = vi.fn(async (_id: string) => landed('0.5.0'))
    const section = renderPatch(face({ checkUpdates: async () => [updateItem], update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // When the user applies the update
    fireEvent.click(updateAction())

    // Then the page's own bundle was updated and the section asks for a restart
    await waitFor(() => { expect(section.textContent).toContain(t('restartHint')) })
    expect(update.mock.calls[0]?.[0]).toBe('@linxin666/dsh-web-all')
    // An update that took effect in place states no restart-only fact
    expect(document.querySelector('[data-update-restart-required]')).toBeNull()
  })

  it('user is told the update landed but needs a restart instead of reading it as a clean in-place success', async () => {
    // Given the host applied the release while this process no longer carries
    // the bundle's rows, so it reports the update as needing a restart
    const update = vi.fn(async (_id: string) => landed('0.5.0', ['@linxin666/dsh-web-all']))
    const section = renderPatch(face({ checkUpdates: async () => [updateItem], update }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })

    // When the user applies the update
    fireEvent.click(updateAction())

    // Then the section names the version that landed and the restart only it
    // needs, and the applied update is not reported as a failure
    await waitFor(() => {
      expect(section.querySelector('[data-update-restart-required]')?.textContent)
        .toBe(t('updateRestartRequired', { version: '0.5.0' }))
    })
    expect(section.querySelector('[data-update-error]')).toBeNull()
    expect(section.textContent).not.toContain(t('restartHint'))
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

  it('user is told the requirement could not be verified instead of being sent to upgrade DSH', async () => {
    // Given a release whose requirement the host could not verify, so no host
    // version came back with the verdict
    renderPatch(face({
      checkUpdates: async () => [{ ...updateItem, requiresDsh: '>=0.2.0', compatible: false }],
    }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat')).toBe('blocked') })

    // When the user reads the section
    const action = updateAction()

    // Then the update is still held back, but the copy says the compatibility
    // could not be verified rather than asserting the running DSH is too old
    expect(action.disabled).toBe(true)
    const section = action.closest('[data-update-patch]')
    expect(section?.textContent).toContain(t('updateUnverifiedDsh', { min: '0.2.0' }))
    expect(section?.textContent).not.toContain(t('updateBlockedDsh', { min: '0.2.0' }))
    expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat-reason')).toBe('unverified')
  })

  it('user sees why the action is disabled when a blocked row declares no readable range', async () => {
    // Given a release the host could not evaluate at all: the row is blocked
    // but carries neither a requirement to name nor a host version it compared
    renderPatch(face({
      checkUpdates: async () => [{ ...updateItem, compatible: false, hostVersion: '0.2.1-rc.3' }],
    }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat')).toBe('blocked') })

    // When the user reads the section
    const action = updateAction()

    // Then the disabled action is explained in place instead of leaving the
    // user with a dead button, and the copy claims no minimum to upgrade to
    expect(action.disabled).toBe(true)
    const section = action.closest('[data-update-patch]')
    expect(section?.textContent).toContain(t('updateUnverifiedDshUnknownRange'))
    expect(document.querySelector('[data-update-compat]')?.getAttribute('data-update-compat-reason')).toBe('below-minimum')
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

describe('update progress bar', () => {
  /**
   * Put one update in flight and hand back the bar it renders. The update never
   * settles, so the row keeps rendering while the bar is under test.
   */
  async function startUpdate(status: PluginUpdatePatchInjected['status']): Promise<HTMLElement> {
    renderPatch(face({
      checkUpdates: async () => [updateItem],
      update: () => new Promise<PluginUpdateResult>(() => {}),
      status,
    }))
    fireEvent.click(screen.getByRole('button', { name: t('checkUpdates') }))
    await waitFor(() => { expect(updateAction().disabled).toBe(false) })
    fireEvent.click(updateAction())
    const bar = document.querySelector<HTMLElement>('[data-update-progress]')
    if (bar === null) throw new Error('the progress row rendered no bar')
    return bar
  }

  it('user sees a determinate bar as one scaled fraction, with no width written inline', async () => {
    // Given an update in flight whose host reports 42 percent
    const bar = await startUpdate(async () => ({ kind: 'install', stage: 'download', percent: 42 }))

    // When the progress row renders that answer
    await waitFor(() => { expect(bar.style.getPropertyValue('--plugin-manager-progress')).toBe('0.42') })

    // Then the fraction is the stylesheet's own variable, and nothing writes a pixel width into the row it lives in
    expect(bar.style.width).toBe('')
    expect(bar.getAttribute('data-update-progress')).toBe('determinate')
    expect(bar.hasAttribute('data-indeterminate')).toBe(false)
  })

  it('user sees an indeterminate bar travel the track, carrying no fraction to scale', async () => {
    // Given an update in flight whose host reports no percentage yet
    let polls = 0
    const bar = await startUpdate(async () => {
      polls += 1
      return { kind: 'install', stage: 'download' }
    })

    // When the first progress poll answers with no percentage
    await waitFor(() => { expect(polls).toBeGreaterThanOrEqual(1) })

    // Then the travel attribute is what drives it, with no fraction and no width set on it
    expect(bar.getAttribute('data-indeterminate')).toBe('true')
    expect(bar.getAttribute('data-update-progress')).toBe('indeterminate')
    expect(bar.style.getPropertyValue('--plugin-manager-progress')).toBe('')
    expect(bar.style.width).toBe('')
  })
})
