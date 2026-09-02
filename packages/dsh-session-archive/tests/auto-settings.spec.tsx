// @vitest-environment jsdom
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { AutoSettingsPanel } from '../src/client/AutoSettings.tsx'
import { ArchiveController } from '../src/client/archive-controller.ts'
import type { SessionArchiveConfig } from '../src/core/config.ts'

/**
 * The official SettingsScope exposes subscribe/getSnapshot as prototype
 * methods (they read `this.store`), so React's bare-function invocation of
 * useSyncExternalStore callbacks crashes on them unless the panel binds
 * first. This fake reproduces that shape on purpose.
 */
class PrototypeMethodScope {
  private readonly snapshot: { value: Partial<SessionArchiveConfig> }

  constructor(snapshot: { value: Partial<SessionArchiveConfig> }) {
    this.snapshot = snapshot
  }

  getSnapshot(): { value: Partial<SessionArchiveConfig> } {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    listener()
    return () => {}
  }

  async set(): Promise<void> {}
}

function scopeWith(value: Partial<SessionArchiveConfig>): SettingsScope<SessionArchiveConfig> {
  return new PrototypeMethodScope({ value }) as unknown as SettingsScope<SessionArchiveConfig>
}

describe('AutoSettingsPanel', () => {
  it('renders against a prototype-method settings scope (useSyncExternalStore binding)', () => {
    const controller = new ArchiveController({ sessions: undefined })
    const { container } = render(
      createElement(AutoSettingsPanel, {
        settings: scopeWith({ autoArchiveEnabled: true, autoArchiveDays: 7 }),
        controller,
      }),
    )
    const toggle = container.querySelector('input[type="checkbox"]')
    expect(toggle).not.toBeNull()
    expect((toggle as HTMLInputElement).checked).toBe(true)
  })

  it('premise guard: a detached scope method call crashes like the official scope', () => {
    const scope = scopeWith({})
    const detached = scope.getSnapshot
    expect(() => detached()).toThrow()
  })
})
