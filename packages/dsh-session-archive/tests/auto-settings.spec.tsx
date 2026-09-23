// @vitest-environment jsdom
import { createElement } from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { AutoSettingsPanel } from '../src/client/AutoSettings.tsx'
import { ArchiveController } from '../src/client/archive-controller.ts'
import type { SessionArchiveConfig } from '../src/core/config.ts'

/** Failure copy the panel shows when the Host does not take a settings write. */
const SAVE_FAILED = 'Save failed: the Host did not accept the setting; please retry'

/**
 * The official ConfigForm controller exposes subscribe/getSnapshot as
 * prototype methods (they read `this.store`), so React's bare-function
 * invocation of useSyncExternalStore callbacks crashes on them unless the panel
 * binds first. This fake reproduces that shape on purpose and answers writes
 * with the boolean the 0.1.7 contract returns.
 */
class PrototypeMethodForm implements ConfigForm<SessionArchiveConfig> {
  private snapshot: ConfigFormSnapshot<SessionArchiveConfig>
  /** Writes the panel asked for, in order. */
  readonly writes: Array<{ field: string; value: unknown }> = []
  /** Answer the Host gives the next write; false models a refusal or a skipped write. */
  accepted = true

  constructor(value: Partial<SessionArchiveConfig>) {
    this.snapshot = { status: 'ready', value, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }
  }

  getSnapshot(): ConfigFormSnapshot<SessionArchiveConfig> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    listener()
    return () => {}
  }

  async set(field: string, value: unknown): Promise<boolean> {
    this.writes.push({ field, value })
    if (!this.accepted) return false
    this.snapshot = {
      ...this.snapshot,
      value: { ...this.snapshot.value, [field]: value },
      revision: (this.snapshot.revision ?? 0) + 1,
    }
    return true
  }

  async unset(): Promise<boolean> {
    return this.accepted
  }

  async mutate(): Promise<boolean> {
    return this.accepted
  }
}

/** Render the panel against one form, with the document language the copy reads pinned. */
function panelFor(form: PrototypeMethodForm): ReturnType<typeof render> {
  document.documentElement.lang = 'en'
  const controller = new ArchiveController({ sessions: undefined })
  return render(createElement(AutoSettingsPanel, { settings: form, controller }))
}

describe('AutoSettingsPanel', () => {
  it('user toggles auto-archive and the bound form carries the accepted write', async () => {
    // Given an auto-maintenance panel bound to a form whose methods are prototype methods
    const form = new PrototypeMethodForm({ autoArchiveEnabled: true, autoArchiveDays: 7 })
    const { container } = panelFor(form)

    // When the user clears the auto-archive switch
    const toggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)

    // Then the form carries that write and an accepted save shows no failure note
    await waitFor(() => { expect(form.writes).toEqual([{ field: 'autoArchiveEnabled', value: false }]) })
    expect(container.querySelector('[data-dsh-part="settings-save-failed"]')).toBeNull()
  })

  it('user sees a failure note when the Host refuses the auto-archive write', async () => {
    // Given a panel whose Host answers the next write with a refusal
    const form = new PrototypeMethodForm({ autoArchiveEnabled: false })
    form.accepted = false
    const { container } = panelFor(form)

    // When the user enables the auto-archive switch
    fireEvent.click(container.querySelector('input[type="checkbox"]') as HTMLInputElement)

    // Then the refused write surfaces as a failed save instead of a silent success
    await waitFor(() => {
      expect(container.querySelector('[data-dsh-part="settings-save-failed"]')?.textContent).toBe(SAVE_FAILED)
    })
    expect(form.writes).toEqual([{ field: 'autoArchiveEnabled', value: true }])
  })

  it('user relies on a bound form, so an unbound method call crashes (premise guard)', () => {
    // Given the faked form the panel is mounted against
    const form = new PrototypeMethodForm({})

    // When one of its prototype methods is detached and called
    const detached = form.getSnapshot

    // Then it throws, exactly like the official controller the panel binds
    expect(() => detached()).toThrow()
  })
})
