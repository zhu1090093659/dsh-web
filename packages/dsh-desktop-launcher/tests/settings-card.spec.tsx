/** @vitest-environment jsdom */

/**
 * The desktop-launcher settings card disclosure contract: the card mounts
 * collapsed (the Web UI plugin group renders many cards, so a rare-use
 * plugin like the launcher starts folded) and the header toggles the body.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the import chain needs.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (init: unknown) => ({
    get: () => init,
    set: () => {},
    subscribe: () => () => {},
  }),
}))
import {
  DesktopLauncherSettingsCard,
  type DesktopLauncherSettingsCardProps,
  type DesktopLauncherSettingsCardState,
} from '../src/client/DesktopLauncherSettingsCard.tsx'
import { en } from '../src/client/locales.ts'
import type { FieldState } from '../src/client/settings-form.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** One untouched field the card renders. */
const field: FieldState = { text: '', overridden: false, invalid: false }

/** One complete card snapshot; callers override what one case exercises. */
function baseState(overrides: Partial<DesktopLauncherSettingsCardState> = {}): DesktopLauncherSettingsCardState {
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    enabled: field,
    announceToAgent: field,
    dshCommand: field,
    url: field,
    profile: field,
    iconPath: field,
    confirmShutdown: field,
    ...overrides,
  }
}

/** English translate stub (same shape the family tests use). */
const t = ((key: string, params?: Record<string, unknown>) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as DesktopLauncherSettingsCardProps['t']

/** Render the card against a fixed snapshot; spies stand in for the actions. */
function renderCard(state: DesktopLauncherSettingsCardState = baseState()) {
  const props = {
    t,
    useDesktopLauncherSettingsCard: (select: (snapshot: DesktopLauncherSettingsCardState) => DesktopLauncherSettingsCardState) => select(state),
    save: vi.fn(),
    discard: vi.fn(),
    edit: vi.fn(),
    resetField: vi.fn(),
  } as unknown as DesktopLauncherSettingsCardProps
  render(<DesktopLauncherSettingsCard {...props} />)
  return props
}

describe('DesktopLauncherSettingsCard disclosure', () => {
  it('mounts collapsed: header only, no settings body', () => {
    renderCard()
    const header = screen.getByRole('button', { name: 'Show settings: Desktop launcher' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    // The body stays unmounted while collapsed.
    expect(screen.queryByRole('button', { name: 'Create desktop icon' })).toBeNull()
    expect(document.getElementById('settings-desktop-launcher-enabled')).toBeNull()
  })

  it('expands on header click and collapses again', () => {
    renderCard()
    const header = screen.getByRole('button', { name: 'Show settings: Desktop launcher' })
    fireEvent.click(header)
    expect(screen.getByRole('button', { name: 'Hide settings: Desktop launcher' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Create desktop icon' })).toBeTruthy()
    expect(document.getElementById('settings-desktop-launcher-enabled')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide settings: Desktop launcher' }))
    expect(screen.queryByRole('button', { name: 'Create desktop icon' })).toBeNull()
  })
})

describe('DesktopLauncherSettingsCard create action gating', () => {
  it('keeps the create button inert with a hint while the plugin is off', () => {
    renderCard(baseState({
      enabled: { text: 'false', overridden: false, invalid: false },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: Desktop launcher' }))
    const create = screen.getByRole('button', { name: 'Create desktop icon' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(screen.getByText('Enable the plugin and save to use this button.')).toBeTruthy()
  })

  it('enables the create button once the saved plugin state is on', () => {
    renderCard(baseState({
      enabled: { text: 'true', overridden: true, invalid: false },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: Desktop launcher' }))
    const create = screen.getByRole('button', { name: 'Create desktop icon' }) as HTMLButtonElement
    expect(create.disabled).toBe(false)
  })

  it('keeps the create button inert until an enabled draft is saved', () => {
    renderCard(baseState({
      dirty: true,
      enabled: { text: 'true', overridden: true, invalid: false },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: Desktop launcher' }))
    const create = screen.getByRole('button', { name: 'Create desktop icon' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
  })
})
