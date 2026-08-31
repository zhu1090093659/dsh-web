// @vitest-environment jsdom
/**
 * Doctor settings card (Web UI plugin group entry) tests: the staged enable
 * and policy switches, the embedded recovery console, and the unavailable
 * controller fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// The family settings-form slice value-imports the browser runtime bundle,
// which is a window.__ModuleLoader__ closure; provide a node-safe stand-in so
// the card spec only exercises the staged-form and console wiring.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: () => ({
    subscribe: () => () => undefined,
    getSnapshot: () => undefined,
  }),
}))

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DoctorApi } from '../src/client/doctor-api.ts'
import { DoctorController } from '../src/client/doctor-controller.ts'
import { PassiveProbe } from '../src/client/doctor-passive.ts'
import { DoctorSettingsCard, type DoctorSettingsCardProps, type DoctorSettingsCardState } from '../src/client/DoctorSettingsCard.tsx'
import { pluginIdOf } from '../src/client/DoctorRecoveryConsole.tsx'
import type { DoctorSupervisorResponse } from '../src/client/doctor-types.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en } from '../src/client/locales.ts'

const t: TranslateNS<'doctor'> = (key, params) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll('{' + name + '}', String(value))
  }
  return text
}

const cardState: DoctorSettingsCardState = {
  available: true,
  exposed: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
  enabled: { text: 'false', overridden: false, invalid: false },
  fullProtection: { text: 'true', overridden: false, invalid: false },
  autoRepair: { text: 'true', overridden: false, invalid: false },
  autoMigrate: { text: 'true', overridden: false, invalid: false },
}

function makeController(): DoctorController {
  const body: DoctorSupervisorResponse = {
    ok: true,
    snapshot: {
      protocol: 1, phase: 'armed', version: '0.2.7',
      profiles: [], incidents: [], updatedAt: '2026-01-01T00:00:00Z',
    },
  }
  const api = { status: vi.fn(async () => ({ ok: true, value: body })), action: vi.fn(), reportClientFailure: vi.fn() } as unknown as DoctorApi
  const passive = new PassiveProbe({ notify: () => undefined })
  const controller = new DoctorController({ api, passive })
  return controller
}

afterEach(() => cleanup())

describe('DoctorSettingsCard', () => {
  it('renders the staged switches and the embedded recovery console', async () => {
    const controller = makeController()
    await controller.refresh()
    const props = {
      t,
      useDoctorSettingsCard: (select: (state: typeof cardState) => typeof cardState) => select(cardState),
      edit: vi.fn(),
      resetField: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      controller,
      useDoctorSettingsCardState: undefined,
    } as unknown as DoctorSettingsCardProps
    const { container } = render(<DoctorSettingsCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Show settings/ }))
    expect(screen.getByLabelText('Enable rescue mode')).toBeTruthy()
    expect(screen.getByLabelText('Full protection')).toBeTruthy()
    expect(screen.getByLabelText('Auto repair')).toBeTruthy()
    expect(screen.getByLabelText('Auto migrate legacy aggregate')).toBeTruthy()
    // Embedded console: status + incident cards render inside the card.
    expect(screen.getByText('Host status')).toBeTruthy()
    expect(container.querySelector('[data-dsh-plugin="doctor"]')).toBeTruthy()
  })

  it('falls back cleanly when the console controller is absent', () => {
    const props = {
      t,
      useDoctorSettingsCard: (select: (state: typeof cardState) => typeof cardState) => select(cardState),
      edit: vi.fn(),
      resetField: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      controller: null,
    } as unknown as DoctorSettingsCardProps
    render(<DoctorSettingsCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Show settings/ }))
    expect(screen.getByText('The recovery console is currently unavailable.')).toBeTruthy()
  })

  it('offers copy and disable actions on failed-plugin probe rows', async () => {
    const controller = makeController()
    controller.notePluginStartupFailure('qa-broken')
    const props = {
      t,
      useDoctorSettingsCard: (select: (state: typeof cardState) => typeof cardState) => select(cardState),
      edit: vi.fn(),
      resetField: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      controller,
    } as unknown as DoctorSettingsCardProps
    render(<DoctorSettingsCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Show settings/ }))
    expect(screen.getByText('Plugin startup failure')).toBeTruthy()
    const copy = screen.getByTestId('doctor-copy-0')
    expect(copy).toBeTruthy()
    fireEvent.click(copy)
    const disable = screen.getByTestId('doctor-disable-0')
    expect(disable).toBeTruthy()
    fireEvent.click(disable)
    expect(await screen.findByText(/plugin manager unavailable/)).toBeTruthy()
  })

  it('parses the plugin id off a startup-failure probe message', () => {
    expect(pluginIdOf('plugin failed to start: @scope/pkg')).toBe('@scope/pkg')
    expect(pluginIdOf('anything else')).toBe('anything else')
  })

  it('opens the send-to-Harness dialog from the newest recorded failure', async () => {
    const controller = makeController()
    controller.recordBoundary(new Error('boundary boom stack'))
    const props = {
      t,
      useDoctorSettingsCard: (select: (state: typeof cardState) => typeof cardState) => select(cardState),
      edit: vi.fn(),
      resetField: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      controller,
    } as unknown as DoctorSettingsCardProps
    render(<DoctorSettingsCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Show settings/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send to Harness' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    const textarea = screen.getByLabelText('Troubleshooting prompt') as HTMLTextAreaElement
    expect(textarea.value).toContain('boundary boom stack')
    expect(screen.getByText(/No session is currently open/)).toBeTruthy()
  })
})
