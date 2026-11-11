// @vitest-environment jsdom
/**
 * Live refresh of the new-card defaults on the client apply path.
 *
 * The defaults are volatile configuration: writing them republishes the Host
 * snapshot, but the SSE frame that republish emits carries the value as of
 * BEFORE the write, so a board that only followed frames would keep the
 * previous defaults for the rest of the page session and the create dialog
 * would prefill from them. The plugin's own settings form is what the settings
 * card writes through, so the apply wiring follows it and re-reads the
 * authoritative snapshot.
 *
 * These cases drive the real apply() over a context double, count the Host
 * state reads its real HTTP transport makes, and then mount the create dialog
 * on the board's controller — so what they assert is what a user would see
 * after saving, without a page reload.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { openFormSection } from './form-sections.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/** The Host event channel the transport opens; no frame is pushed here. */
class StubEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  close(): void {}
}

/** The global faces this file replaces for the client's own reads. */
const globalWithFaces = globalThis as { EventSource?: unknown; fetch?: unknown; __dshTaskboardApplied?: boolean }

beforeEach(() => {
  delete globalWithFaces.__dshTaskboardApplied
  globalWithFaces.EventSource = StubEventSource
  window.localStorage.clear()
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  delete globalWithFaces.EventSource
  delete globalWithFaces.fetch
  delete globalWithFaces.__dshTaskboardApplied
  window.localStorage.clear()
})

/** The deployment roster the preset feed reads, one built-in row. */
const PRESET_ROSTER = [{ id: 'standard', name: '', description: '', isDefault: true }]

/** The model catalog the fallback model feed reads, one route with one level. */
const MODEL_CATALOG = {
  groups: [{ id: 'alpha', models: [{ id: 'fast', name: 'Fast', reasoning: { efforts: [{ id: 'high' }] } }] }],
}

/** The settings key of each new-card default, and the name the Host publishes it under. */
const DEFAULT_KEYS = {
  mode: 'cardDefaultMode',
  permission: 'cardDefaultPermission',
  model: 'cardDefaultModel',
  reasoningEffort: 'cardDefaultReasoningEffort',
} as const

/** The defaults a settings document names, as the Host publishes them (absent when unconfigured). */
function hostDefaultsOf(settings: Record<string, unknown>): Record<string, string> | undefined {
  const published: Record<string, string> = {}
  for (const [name, key] of Object.entries(DEFAULT_KEYS)) {
    const value = settings[key]
    if (typeof value === 'string' && value !== '') published[name] = value
  }
  return Object.keys(published).length === 0 ? undefined : published
}

/** One full Host snapshot, as `/state` and an action reply both answer it. */
function hostedSnapshot(cardDefaults?: Record<string, string>): Record<string, unknown> {
  return {
    schemaVersion: 6,
    revision: 7,
    tasks: [],
    scheduler: { ledgerId: 'ledger-live', timeZone: 'UTC' },
    power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    sessionDefaultPermission: 'read-only',
    maxSubtaskDepth: 1,
    ...(cardDefaults === undefined ? {} : { cardDefaults }),
  }
}

/**
 * A Host whose `/state` and `/action` answers are the current snapshot, recording
 * every route this page read.
 * @param snapshot - the snapshot the Host serves right now.
 */
function hostServer(snapshot: () => Record<string, unknown>) {
  const reads: string[] = []
  const fetchImpl = async (url: string): Promise<unknown> => {
    reads.push(url)
    return { ok: true, status: 200, text: async () => JSON.stringify(snapshot()) }
  }
  return {
    fetchImpl,
    /** How many authoritative state reads the board made so far. */
    stateReads: () => reads.filter(url => url.endsWith('/state')).length,
  }
}

/** A live settings-form double: the plugin binds it, the settings card writes it. */
function liveSettingsForm(initial: Record<string, unknown>) {
  let user = { ...initial }
  let revision = 1
  const listeners = new Set<() => void>()
  const announce = (): void => { for (const listener of [...listeners]) listener() }
  const form = {
    entryId: 'task-board',
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { ...user },
      base: undefined,
      user: { ...user },
      revision,
      writable: true as const,
    }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    mutate: async (ops: Array<{ op: string; path: string[]; value?: unknown }>) => {
      for (const op of ops) {
        if (op.op === 'set') user[op.path[0]!] = op.value
        else delete user[op.path[0]!]
      }
      return true
    },
    set: async () => true,
    unset: async () => true,
  }
  return {
    form,
    /** Settle one written settings document, as the card's save does. */
    settle: (value: Record<string, unknown>) => { user = { ...value }; revision += 1; announce() },
    /** Announce the settled document again: one save notifies more than once. */
    announce,
  }
}

/** A deployment that serves no settings surface at all. */
function unavailableSettingsForm() {
  return {
    entryId: 'task-board',
    getSnapshot: () => ({ status: 'unavailable' as const, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false as const }),
    subscribe: () => () => {},
    mutate: async () => false,
    set: async () => false,
    unset: async () => false,
  }
}

/** A client context double carrying just the services this plugin reaches. */
function applyContext(form: Record<string, unknown>, binder = true) {
  const disposers: Array<() => void> = []
  const registrations: Array<{ name: string; options: Record<string, unknown> }> = []
  /** Scoped-inject callbacks parked until their namespace is mounted. */
  const parked: Array<() => void> = []
  let presetNamespace: { list: () => Promise<unknown> } | undefined
  const services: Record<string, unknown> = {
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    workspaces: { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} }, create: async () => ({ workspaceId: 'w1' }) },
    // The plugin binds the family settings form through the group binder, when
    // the deployment serves that group at all.
    ...(binder ? { webUiSettings: { bind: () => form } } : {}),
    // The traced `remote` proxy throws for a namespace the caller never injected.
    remote: new Proxy({}, {
      get: (_target, prop) => { throw new Error(`cannot get property "${String(prop)}" without inject`) },
    }),
    // The fallback model feed on a page whose api-remotes face serves no catalog.
    connection: {
      isLoopback: true,
      rpc: {},
      api: { session: { modelCatalog: async () => ({ result: { value: MODEL_CATALOG } }) } },
      start: () => ({ stop: () => {} }),
      generation: { getSnapshot: () => undefined },
    },
    layout: { selectPanel: () => {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
    configForms: { get: () => form, describe: () => { throw new Error('no describe mirror') } },
  }
  const slots = {
    register: (options: Record<string, unknown>) => {
      registrations.push({ name: String(options.name), options })
      const release = (): void => {}
      disposers.push(release)
      return release
    },
    inject: (_key: string, callback: () => () => void) => {
      const release = callback()
      disposers.push(release)
      return release
    },
  }
  const ctx = {
    effect(callback: () => void | (() => void)) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    get: (name: string) => services[name],
    on: () => () => {},
    inject(names: readonly string[], callback: (scope: unknown) => unknown) {
      const run = (): void => {
        const scope = {
          get: (name: string) => (names.includes(name) ? presetNamespace : undefined),
          on: () => () => {},
          effect: (cb: () => void | (() => void)) => { const disposer = cb(); if (typeof disposer === 'function') disposers.push(disposer) },
        }
        const cleanup = callback(scope)
        if (typeof cleanup === 'function') disposers.push(cleanup as () => void)
      }
      parked.push(run)
      return { dispose: async () => {} }
    },
    locale: { register: () => () => {}, bind: () => (key: string) => key, subscribe: () => () => {} },
    configForms: services.configForms,
    slots,
  }
  return {
    ctx: ctx as never,
    disposers,
    registrations,
    /** Mount the roster namespace the way the api-remotes assembly does. */
    mountPresetNamespace: () => {
      presetNamespace = { list: async () => ({ ok: true, value: { presets: PRESET_ROSTER } }) }
      for (const run of parked.splice(0)) run()
    },
  }
}

/** The board controller the panel page receives through its slot injection. */
function boardController(registrations: Array<{ name: string; options: Record<string, unknown> }>): BoardController | undefined {
  const page = registrations.find(entry => entry.name === 'main')
  const inject = page?.options.inject as (() => { controller: BoardController }) | undefined
  return inject?.().controller
}

/** Let one Host round trip settle. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await Promise.resolve()
}

/** The dialog's execution-target select, found by the label copy its field renders. */
function executionSelect(container: HTMLElement, label: string): HTMLSelectElement {
  const field = [...container.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)
  const select = field?.querySelector('select')
  if (select === undefined || select === null) throw new Error(`no select labelled ${label}`)
  return select
}

/** Mount the create dialog on the board's own controller, as the board does. */
function renderDialog(controller: BoardController): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
  openFormSection(container, t('new.section.execution'))
  return container
}

/**
 * Mount the board over one settings document: the form holds it and the Host
 * publishes the defaults it names, which is the state a page loads into.
 * @param settings - the settings document this deployment holds.
 */
async function mountedBoard(settings: Record<string, unknown> = { enabled: true }) {
  const form = liveSettingsForm(settings)
  let hosted = { ...settings }
  const server = hostServer(() => hostedSnapshot(hostDefaultsOf(hosted)))
  globalWithFaces.fetch = server.fetchImpl
  const context = applyContext(form.form)
  apply(context.ctx)
  await settle()
  context.mountPresetNamespace()
  await settle()
  const controller = boardController(context.registrations)
  if (controller === undefined) throw new Error('the board panel never registered')
  return {
    ...context,
    form,
    server,
    controller,
    /**
     * Save one settled settings document: the Host republishes what the new
     * document configures, exactly as a volatile settings write does.
     */
    saveSettings: async (next: Record<string, unknown>): Promise<void> => {
      hosted = { ...next }
      form.settle({ enabled: true, ...next })
      await settle()
    },
  }
}

/** The mirror the create dialog prefills from. */
function mirroredDefaults(controller: BoardController): Record<string, unknown> | undefined {
  return (controller.getSnapshot() as ControllerSnapshot).host?.cardDefaults
}

describe('new-card defaults refreshed live from the settings form', () => {
  it('operator saving a default permission sees one state read and the new mirror', async () => {
    // Given a mounted board whose Host configures no new-card default
    const board = await mountedBoard()
    const readsBefore = board.server.stateReads()
    expect(mirroredDefaults(board.controller)).toBeUndefined()

    // When the user saves a default permission, which the form announces more
    // than once (a settled save is not a single notification)
    await board.saveSettings({ cardDefaultPermission: 'workspace-write' })
    board.form.announce()
    await settle()

    // Then the board re-read the authoritative snapshot exactly once and its
    // mirror carries the new value
    expect(board.server.stateReads()).toBe(readsBefore + 1)
    expect(mirroredDefaults(board.controller)).toEqual({ permission: 'workspace-write' })
  })

  it('user creating a card right after saving a default gets it prefilled without a reload', async () => {
    // Given a board whose Host already defaults the preset, model and level
    const board = await mountedBoard({
      enabled: true,
      cardDefaultMode: 'standard',
      cardDefaultModel: 'alpha/fast',
      cardDefaultReasoningEffort: 'high',
    })

    // When the user saves the default permission and then opens the create
    // dialog in the same page session
    await board.saveSettings({
      cardDefaultMode: 'standard',
      cardDefaultModel: 'alpha/fast',
      cardDefaultReasoningEffort: 'high',
      cardDefaultPermission: 'workspace-write',
    })
    const container = renderDialog(board.controller)

    // Then every execution target is prefilled from the defaults it just saved
    expect(executionSelect(container, t('new.permission')).value).toBe('workspace-write')
    expect(executionSelect(container, t('new.agentPreset')).value).toBe('standard')
    expect(executionSelect(container, t('new.model')).value).toBe('alpha/fast')
    expect(executionSelect(container, t('exec.reasoning')).value).toBe('high')
  })

  it('user clearing a default sees the mirror drop it and the dialog return to the session default', async () => {
    // Given a board whose Host defaulted the permission
    const board = await mountedBoard({ enabled: true, cardDefaultPermission: 'workspace-write' })
    expect(mirroredDefaults(board.controller)).toEqual({ permission: 'workspace-write' })

    // When the user clears that default, so the Host republishes a snapshot that
    // configures nothing (it omits the key instead of publishing it blank)
    await board.saveSettings({})

    // Then the mirror is unconfigured rather than holding the cleared value, and
    // the dialog opens on the session default again
    expect(mirroredDefaults(board.controller)).toBeUndefined()
    const container = renderDialog(board.controller)
    expect(executionSelect(container, t('new.permission')).value).toBe('')
  })

  it('operator performing a board action sees no extra state read', async () => {
    // Given a mounted board with nothing left to read
    const board = await mountedBoard({ enabled: true, cardDefaultPermission: 'workspace-write' })
    const readsBefore = board.server.stateReads()

    // When the user edits a card, which goes through a Host action of its own
    await board.controller.updateTask('task-1', { title: 'Renamed' })
    await settle()

    // Then that action's own reply was used and the board pulled no extra
    // snapshot: the follow-the-settings-form refresh is not a general poll
    expect(board.server.stateReads()).toBe(readsBefore)
  })

  it('operator changing a setting that is not a new-card default sees no state read', async () => {
    // Given a mounted board with nothing left to read
    const board = await mountedBoard({ enabled: true, cardDefaultPermission: 'workspace-write' })
    const readsBefore = board.server.stateReads()

    // When the user toggles the board's announcement switch and saves
    await board.saveSettings({ cardDefaultPermission: 'workspace-write', announceToAgent: false })

    // Then the defaults did not change, so the ledger is not read again for it
    expect(board.server.stateReads()).toBe(readsBefore)
    expect(mirroredDefaults(board.controller)).toEqual({ permission: 'workspace-write' })
  })

  it('operator on a deployment that serves no settings surface keeps the board mounted', async () => {
    // Given a page with no family settings group and a config service that
    // serves no namespace to this client
    const server = hostServer(() => hostedSnapshot({ permission: 'workspace-write' }))
    globalWithFaces.fetch = server.fetchImpl
    const context = applyContext(unavailableSettingsForm(), false)

    // When the plugin applies
    apply(context.ctx)
    await settle()

    // Then the board's own page seat mounted and its mirror is the Host's: a
    // missing settings surface leaves the board alive instead of failing or
    // hanging the apply, and the defaults still arrive
    expect(context.registrations.map(entry => entry.name)).toContain('main')
    const controller = boardController(context.registrations)
    if (controller === undefined) throw new Error('the board panel never registered')
    expect(mirroredDefaults(controller)).toEqual({ permission: 'workspace-write' })
  })
})
