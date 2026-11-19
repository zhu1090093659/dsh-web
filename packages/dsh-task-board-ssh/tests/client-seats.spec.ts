/** @vitest-environment jsdom */

/**
 * The extension's switch against the board's own switch, the settings section it
 * contributes, and the copy both read.
 *
 * The board gates a provider on its own master switch AND the provider's
 * volatile one. This half owns the second gate: with the extension off the
 * detail section and the card chip are gone, while the settings section — the
 * place the switch lives — stays registered so it can be turned back on, and the
 * board's next mirror frame rebuilds the seats.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { apply, NS, SETTINGS_NAMESPACE } from '../src/client/index.ts'
import { SshSettingsSection, type SshSettingsCardState, type SshSettingsSectionProps } from '../src/client/ssh/settings-section.tsx'
import { en, setRuntimeTranslate, t, zh, type TaskBoardSshKey } from '../src/client/locales.ts'
import type { CardShell, FieldState } from '../src/client/settings-form.ts'

/** The board's three provider seats, restated (this package may not import the board). */
const DETAIL_SECTION = 'task-board.detail.section'
const SETTINGS_SECTION = 'task-board.settings.section'
const CARD_DECORATION = 'task-board.card.decoration'

interface Registration {
  name: string
  id?: string
  locale?: string
  dispose: () => void
}

/**
 * Browser context double over the services this half reads: the slot registry,
 * the locale catalog, the family settings binder, and the board's client face.
 * `inject` runs the dependency callback the way cordis does once the board
 * serves its service, so the seats register into the recorded list, and the
 * settings form notifies subscribers so a switch flip reaches the installer.
 */
function context(options: { enabled?: boolean } = {}) {
  const registrations: Registration[] = []
  const dictionaries: string[] = []
  const catalogs: Array<Record<string, unknown>> = []
  const followedSeats: string[] = []
  const value: Record<string, unknown> = { enabled: options.enabled !== false }
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  const scope = {
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { ...value },
      base: undefined,
      user: { ...value },
      revision: 1,
      writable: true as const,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => true,
    unset: async () => true,
    mutate: async (batch: Array<{ op: 'set' | 'unset', path: string[], value?: unknown }>) => {
      for (const op of batch) {
        if (op.op === 'set') value[op.path[0] as string] = op.value
        else delete value[op.path[0] as string]
      }
      notify()
      return true
    },
  }
  const mirrorListeners = new Set<(mirror: { enabled: boolean, tasks: unknown[], extensions: Record<string, unknown> }) => void>()
  let boardEnabled = true
  const face = {
    dispatch: async () => true,
    registerVisibility: () => () => {},
    subscribe: (listener: (mirror: { enabled: boolean, tasks: unknown[], extensions: Record<string, unknown> }) => void) => {
      mirrorListeners.add(listener)
      return () => { mirrorListeners.delete(listener) }
    },
    snapshot: () => ({ enabled: boardEnabled, tasks: [], extensions: {} }),
  }
  const slots = {
    register: (entry: Record<string, unknown>, _component: unknown) => {
      const record: Registration = {
        name: String(entry.name),
        ...(entry.id === undefined ? {} : { id: String(entry.id) }),
        ...(entry.locale === undefined ? {} : { locale: String(entry.locale) }),
        dispose: () => {
          const index = registrations.indexOf(record)
          if (index !== -1) registrations.splice(index, 1)
        },
      }
      registrations.push(record)
      return record.dispose
    },
    inject: (key: string, callback: () => () => void) => {
      followedSeats.push(key)
      const dispose = callback()
      return () => { dispose() }
    },
  }
  const ctx = {
    get: (name: string) => name === 'taskBoard' ? face : undefined,
    on: () => () => {},
    effect: (callback: () => unknown) => { callback(); return () => {} },
    inject: (_services: readonly string[], callback: (scoped: unknown) => void) => {
      let disposer: (() => void) | undefined
      callback({
        get: ctx.get,
        slots,
        effect: (registered: () => unknown) => {
          disposer = registered() as (() => void)
          return disposer
        },
      })
      return { dispose: () => { const run = disposer; disposer = undefined; run?.() } }
    },
    slots,
    locale: {
      register: (namespace: string, catalog: Record<string, unknown>) => {
        dictionaries.push(namespace)
        catalogs.push(catalog)
        return () => {}
      },
      // A bound translate of its own, reading the dictionary directly: routing
      // it back through the module's t would recurse once apply() wires it as
      // the runtime seat.
      bind: (namespace: string) => (key: string, params?: Record<string, string>) => {
        expect(namespace).toBe(NS)
        let text = (zh as Record<string, string>)[key] ?? key
        if (params !== undefined) {
          for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
        }
        return text
      },
    },
    configForms: {
      get: () => scope,
      describe: () => ({ getSnapshot: () => ({ view: undefined }), subscribe: () => () => {} }),
    },
  }
  const binder = { bind: () => scope }
  return {
    ctx,
    binder,
    registrations,
    dictionaries,
    catalogs,
    followedSeats,
    scope,
    /** Drive the extension's own switch the way the settings card does. */
    setEnabled: async (enabled: boolean) => {
      await scope.mutate([{ op: 'set', path: ['enabled'], value: enabled }])
    },
    /** Publish one board mirror frame. */
    boardMirror: (enabled: boolean) => {
      boardEnabled = enabled
      for (const listener of [...mirrorListeners]) listener({ enabled, tasks: [], extensions: {} })
    },
  }
}

/** Apply the browser half against a context double. */
function mount(options: { enabled?: boolean } = {}) {
  const harness = context(options)
  const withBinder = { ...harness.ctx, get: (name: string) => name === 'webUiSettings' ? harness.binder : harness.ctx.get(name) }
  apply(withBinder as never)
  return harness
}

beforeEach(() => { cleanup() })
// The runtime translate seat is module state; a case that wires it must not
// leave the next case reading through it.
afterEach(() => {
  cleanup()
  setRuntimeTranslate(undefined)
})

describe('the extension switch', () => {
  it('operator turning the extension off sees both rendering seats withdrawn and the settings section kept', async () => {
    // Given a running extension whose board is on
    const harness = mount()
    const names = () => harness.registrations.map(entry => entry.name)
    expect(names()).toEqual(expect.arrayContaining([DETAIL_SECTION, CARD_DECORATION, SETTINGS_SECTION]))

    // When the operator turns the extension off
    await act(async () => { await harness.setEnabled(false) })

    // Then the two rendering seats are gone and the section that turns it back
    // on is still registered
    expect(names()).toEqual([SETTINGS_SECTION])
  })

  it('operator turning it back on sees both rendering seats rebuilt', async () => {
    // Given an extension that was switched off
    const harness = mount({ enabled: false })
    const names = () => harness.registrations.map(entry => entry.name)
    expect(names()).toEqual([SETTINGS_SECTION])

    // When the switch is turned on again
    await act(async () => { await harness.setEnabled(true) })

    // Then both rendering seats come back next to the section
    expect(names()).toEqual(expect.arrayContaining([DETAIL_SECTION, CARD_DECORATION, SETTINGS_SECTION]))
  })

  it('operator whose board master switch is off loses the seats and gets them back on the next mirror frame', () => {
    // Given a running extension
    const harness = mount()
    const names = () => harness.registrations.map(entry => entry.name)

    // When the board's own master switch goes off
    act(() => { harness.boardMirror(false) })

    // Then the board's seats are released
    expect(names()).not.toContain(DETAIL_SECTION)

    // When the board comes back
    act(() => { harness.boardMirror(true) })

    // Then the seats are rebuilt without re-registering the provider
    expect(names()).toEqual(expect.arrayContaining([DETAIL_SECTION, CARD_DECORATION]))
  })

  it('user reading the seat registrations sees the ssh identity and the catalog namespace', () => {
    // Given a running extension
    const harness = mount()

    // When the registrations are read
    // Then every seat is owned by "ssh", every name is a board seat, and the
    // detail seat binds this extension's catalog
    expect(harness.registrations.map(entry => entry.id)).toEqual(['ssh', 'ssh', 'ssh'])
    expect(harness.registrations.every(entry => entry.name.startsWith('task-board.'))).toBe(true)
    expect(harness.registrations.find(entry => entry.name === DETAIL_SECTION)?.locale).toBe(NS)
    expect(harness.followedSeats).toEqual([SETTINGS_SECTION])
  })

  it('user reading the registered dictionaries sees one namespace carrying both languages', () => {
    // Given a running extension
    const harness = mount()

    // When the locale registration is read
    // Then one namespace went out, with both languages and the same keys in each
    expect(harness.dictionaries).toEqual([SETTINGS_NAMESPACE])
    const catalog = harness.catalogs[0] as { zh: Record<string, string>, en: Record<string, string> }
    expect(Object.keys(catalog.zh).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.keys(catalog.en).sort()).toEqual(Object.keys(zh).sort())
  })
})

/** One field as the staged card renders it. */
function field(text = ''): FieldState {
  return { text, overridden: false, invalid: false }
}

/** The shell every card state carries. */
const SHELL: CardShell = { available: true, exposed: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

/** Build the props the renderer binds for the settings seat. */
function settingsProps(state: SshSettingsCardState): { props: SshSettingsSectionProps, edited: ReturnType<typeof vi.fn> } {
  const edited = vi.fn()
  const props = {
    t: (key: string, params?: Record<string, string | number>) => t(key as TaskBoardSshKey, params as Record<string, string> | undefined),
    useSshSettingsCard: (selector: (snapshot: SshSettingsCardState) => unknown) => selector(state),
    edit: edited,
    save: vi.fn(),
    discard: vi.fn(),
    resetField: vi.fn(),
  } as unknown as SshSettingsSectionProps
  return { props, edited }
}

/** A card state with every field empty unless the case sets it. */
function settingsState(overrides: Partial<SshSettingsCardState> = {}): SshSettingsCardState {
  return {
    ...SHELL,
    enabled: field(),
    defaultHost: field(),
    defaultMode: field(),
    defaultAgent: field(),
    perHostCap: field(),
    agentCommands: field(),
    ...overrides,
  }
}

/** Render the section open, as the settings page shows it after a click. */
function renderSection(state: SshSettingsCardState) {
  const { props, edited } = settingsProps(state)
  render(createElement('ul', null, createElement(SshSettingsSection, props)))
  fireEvent.click(screen.getByRole('button', { name: /展开设置/ }))
  return { edited }
}

describe('the settings section', () => {
  it('operator opening an enabled section sees the switch, the defaults and the cap as its own values', () => {
    // Given an enabled extension with a stored host, mode and cap
    renderSection(settingsState({
      enabled: field('true'),
      defaultHost: field('devbox'),
      defaultMode: field('proxy'),
      perHostCap: field('3'),
    }))

    // When the section is open
    // Then the switch answers what is stored, and each control carries its value
    expect(screen.getByRole('button', { name: '开' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '关' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '本地代理' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('默认主机') as HTMLInputElement).value).toBe('devbox')
    expect((screen.getByLabelText('每主机并发上限') as HTMLInputElement).value).toBe('3')
  })

  it('operator reading the agent rows sees one per built-in CLI, and a stored override in its own row', () => {
    // Given one stored start template for the Claude Code CLI
    renderSection(settingsState({ agentCommands: field('[{"kind":"claude","command":"claude -p {prompt_file}"}]') }))

    // When the section is open
    // Then each row is that agent's own input, the stored one carries the
    // template, the others stay empty, and exactly one row reads as overridden
    expect((screen.getByLabelText('Claude Code') as HTMLInputElement).value).toBe('claude -p {prompt_file}')
    expect((screen.getByLabelText('dsh') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Codex') as HTMLInputElement).value).toBe('')
    expect(screen.getAllByText('已覆盖')).toHaveLength(1)
  })

  it('operator turning the extension off still sees the switch, and why the rest is inactive', () => {
    // Given the extension is off
    renderSection(settingsState({ enabled: field('false') }))

    // When the section is open
    // Then the switch still answers and the body explains what is inactive
    expect(screen.getByRole('button', { name: '关' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByLabelText('默认主机')).toBeNull()
    expect(screen.getByText(/以下默认值与命令覆写暂不生效/).textContent).toContain('以下默认值与命令覆写暂不生效')
  })
})

describe('the copy', () => {
  it('user reading the catalog gets the same keys and placeholders in zh and en', () => {
    // Given the two dictionaries
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()

    // When they are compared
    // Then the key sets match exactly
    expect(enKeys).toEqual(zhKeys)

    // And every placeholder in one side exists in the other
    for (const key of zhKeys as TaskBoardSshKey[]) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })

  it('user reading a run phase gets its own words, none of them missing', () => {
    // Given the phase vocabulary
    const phases = ['idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'lost'] as const

    // When each label is read out of the key source of truth
    const labels = phases.map(phase => (zh as Record<string, string>)[`run.${phase}`])

    // Then none of them is missing or shared
    expect(new Set(labels).size).toBe(phases.length)
    for (const label of labels) expect(label).not.toContain('run.')
  })
})