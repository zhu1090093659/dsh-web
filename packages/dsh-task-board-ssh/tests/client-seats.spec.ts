/** @vitest-environment jsdom */

/**
 * The extension's switch, against the board's own switch, and the copy the
 * surfaces read.
 *
 * The board gates a provider on its own master switch AND the provider's
 * volatile one. This half owns the second gate: with the extension off the
 * detail section and the card chip are gone, while the settings section — the
 * place the switch lives — stays registered so it can be turned back on, and
 * the board's next remote session rebuilds the seats from the mirror.
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
        dictionaries.push(namespace + ':' + Object.keys(catalog).sort().join(','))
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
  it('turning the extension off withdraws both rendering seats and keeps the settings section', async () => {
    // Given a running extension whose board is on
    const harness = mount()
    const names = () => harness.registrations.map(entry => entry.name)
    expect(names()).toContain(DETAIL_SECTION)
    expect(names()).toContain(CARD_DECORATION)
    expect(names()).toContain(SETTINGS_SECTION)

    // When the operator turns the extension off
    await act(async () => { await harness.setEnabled(false) })

    // Then the two rendering seats are gone and the section that turns it back
    // on is still registered
    expect(names()).not.toContain(DETAIL_SECTION)
    expect(names()).not.toContain(CARD_DECORATION)
    expect(names()).toContain(SETTINGS_SECTION)
  })

  it('turning it back on rebuilds the seats', async () => {
    // Given an extension that was switched off
    const harness = mount({ enabled: false })
    const names = () => harness.registrations.map(entry => entry.name)
    expect(names()).not.toContain(DETAIL_SECTION)
    expect(names()).toEqual([SETTINGS_SECTION])

    // When the switch is turned on again
    await act(async () => { await harness.setEnabled(true) })

    // Then both rendering seats are registered again
    expect(names()).toContain(DETAIL_SECTION)
    expect(names()).toContain(CARD_DECORATION)
  })

  it('the board turning on rebuilds the seats from the mirror, and its switch off releases them', () => {
    // Given a running extension
    const harness = mount()

    // When the board's own master switch goes off
    act(() => { harness.boardMirror(false) })

    // Then the board's seats are released
    const names = () => harness.registrations.map(entry => entry.name)
    expect(names()).not.toContain(DETAIL_SECTION)

    // When the board comes back
    act(() => { harness.boardMirror(true) })

    // Then the seats are rebuilt without re-registering the provider
    expect(names()).toContain(DETAIL_SECTION)
    expect(names()).toContain(CARD_DECORATION)
  })

  it('every seat carries the ssh identity and the detail seat binds the catalog', () => {
    // Given a running extension
    const harness = mount()

    // When the registrations are read
    // Then every seat is owned by "ssh" and the detail seat binds the catalog
    for (const entry of harness.registrations) {
      expect(entry.id).toBe('ssh')
      expect(entry.name.startsWith('task-board.')).toBe(true)
    }
    expect(harness.registrations.find(entry => entry.name === DETAIL_SECTION)?.locale).toBe(NS)
    expect(harness.followedSeats).toContain(SETTINGS_SECTION)
  })

  it('the dictionaries are registered under the namespace the seats bind', () => {
    // Given a running extension
    const harness = mount()

    // When the locale registration is read
    // Then both dictionaries went out under one namespace
    expect(harness.dictionaries).toHaveLength(1)
    expect(harness.dictionaries[0]?.startsWith(SETTINGS_NAMESPACE + ':')).toBe(true)
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
  it('an enabled extension shows the switch, the defaults and the cap', () => {
    // Given the extension is on
    renderSection(settingsState())

    // When the section is open
    // Then the master switch and the provider's defaults are its rows
    expect(screen.getByText('SSH 远程执行')).toBeDefined()
    expect(screen.getByText('启用远程执行')).toBeDefined()
    expect(screen.getByText('默认模式')).toBeDefined()
    expect(screen.getByText('默认 Agent')).toBeDefined()
    expect(screen.getByText('默认主机')).toBeDefined()
    expect(screen.getByText('每主机并发上限')).toBeDefined()
  })

  it('every overridable agent keeps its own command row, and a stored one reads as an override', () => {
    // Given one stored override for the Claude Code CLI
    renderSection(settingsState({ agentCommands: field('[{"kind":"claude","command":"claude -p {prompt_file}"}]') }))

    // When the section is open
    // Then the three rows are there, each named by its agent and carrying its
    // own built-in command line behind the hint
    expect(screen.getByText('留空即用 dsh headless 命令行；模板必须引用 {prompt_file}。')).toBeDefined()
    expect(screen.getByText('留空即用 claude -p 命令行；模板必须引用 {prompt_file}。')).toBeDefined()
    expect(screen.getByText('留空即用 codex exec 命令行；模板必须引用 {prompt_file}。')).toBeDefined()
    expect(screen.getByText('已覆盖')).toBeDefined()
  })

  it('a disabled extension keeps the switch and explains why the rest is inactive', () => {
    // Given the extension is off
    renderSection(settingsState({ enabled: field('false') }))

    // When the section is open
    // Then the switch is still there, the defaults are not, and the notice says why
    expect(screen.getByText('启用远程执行')).toBeDefined()
    expect(screen.queryByText('每主机并发上限')).toBeNull()
    expect(screen.getByText(/以下默认值与命令覆写暂不生效/)).toBeDefined()
  })
})

describe('the copy', () => {
  it('zh and en carry the same keys and the same placeholders', () => {
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

  it('every run phase has its own words', () => {
    // Given the phase vocabulary
    const phases = ['idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'lost'] as const

    // When each label is read out of the key source of truth
    const labels = phases.map(phase => (zh as Record<string, string>)[`run.${phase}`])

    // Then none of them is missing or shared
    expect(new Set(labels).size).toBe(phases.length)
    for (const label of labels) expect(label).not.toContain('run.')
  })
})
