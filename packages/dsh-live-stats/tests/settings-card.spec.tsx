/** @vitest-environment jsdom */

/**
 * The settings-card availability contract: a card whose namespace the Host
 * does not expose to this client must explain the gap instead of vanishing —
 * a missing namespace (the official settings allowlist omits third-party
 * namespaces) must never read as a missing plugin.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PluginSettingsCard, type PluginSettingsCardProps } from '../src/client/PluginSettingsCard.tsx'
import { en, type SettingsCardKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** English translate stub (same shape the live-stats tests use). */
const t: PluginSettingsCardProps['t'] = (key, params) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const base = (overrides: Partial<PluginSettingsCardProps['state']>): PluginSettingsCardProps['state'] => ({
  available: true,
  exposed: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
  ...overrides,
})

describe('PluginSettingsCard availability', () => {
  it('renders the form when the namespace is exposed', () => {
    render(
      <PluginSettingsCard
        t={t}
        titleKey="settings.title"
        descriptionKey="settings.description"
        state={base({})}
        onSave={() => {}}
        onDiscard={() => {}}
      >
        <p data-testid="field">field</p>
      </PluginSettingsCard>,
    )
    // The body is collapsed until the header is expanded.
    expect(screen.queryByTestId('field')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /show settings: live token estimation/i }))
    expect(screen.getByTestId('field')).toBeTruthy()
  })

  it('renders an explanation instead of vanishing when the namespace is not exposed', () => {
    render(
      <PluginSettingsCard
        t={t}
        titleKey="settings.title"
        descriptionKey="settings.description"
        state={base({ exposed: false })}
        onSave={() => {}}
        onDiscard={() => {}}
      >
        <p data-testid="field">field</p>
      </PluginSettingsCard>,
    )
    // The form controls are suppressed…
    expect(screen.queryByTestId('field')).toBeNull()
    // …but the card still appears, explaining the gap.
    const header = screen.getByRole('button', { name: /show settings: live token estimation/i })
    expect(header).toBeTruthy()
    fireEvent.click(header)
    expect(screen.getByText(/settings.yaml/i)).toBeTruthy()
  })

  it('renders nothing while the namespace is still loading', () => {
    const view = render(
      <PluginSettingsCard
        t={t}
        titleKey="settings.title"
        descriptionKey="settings.description"
        state={base({ available: false })}
        onSave={() => {}}
        onDiscard={() => {}}
      >
        <p data-testid="field">field</p>
      </PluginSettingsCard>,
    )
    expect(view.container.textContent).toBe('')
  })
})
