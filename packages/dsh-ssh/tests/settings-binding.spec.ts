/**
 * Browser-half settings binding: the terminal-font preference lives in the
 * plugin's own profile entry, so the reader resolves that entry either through
 * the family binder (dsh-web-settings loaded) or through the shared
 * configuration forms, where the entry is recognised by the field this
 * plugin's own Config schema declares.
 */
import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { bindSettingsReader } from '../src/client/settings-binding.ts'

/** The section shape the dsh-ssh browser half reads. */
interface SshSettings {
  terminalFontFamily?: string
}

/** One Host namespace view as the shared describe mirror reports it. */
interface HostView {
  ns: string
  value: unknown
}

/** A fake form of one profile entry, plus the handle that replaces its section. */
interface FakeForm<T> {
  form: ConfigForm<T>
  update: (value: T) => void
}

/** A ready snapshot of one entry. */
function readySnapshot<T>(value: T): ConfigFormSnapshot<T> {
  return { status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
}

/** Build a fake entry form that publishes each replacement it is given. */
function fakeForm<T>(value: T): FakeForm<T> {
  const listeners = new Set<() => void>()
  let snapshot = readySnapshot(value)
  return {
    form: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      set: async () => true,
      unset: async () => true,
      mutate: async () => true,
    },
    update: (next) => {
      snapshot = readySnapshot(next)
      for (const listener of listeners) listener()
    },
  }
}

/** A fake shared describe mirror, shared by the forms service and its readers. */
interface FakeMirror {
  face: object
  publish: (namespaces: HostView[]) => void
}

/** Build a fake mirror that starts unanswered and publishes whatever it is handed. */
function fakeMirror(): FakeMirror {
  const listeners = new Set<() => void>()
  let view: { namespaces: HostView[]; writable: boolean; hasDocument: boolean } | undefined
  return {
    face: {
      getSnapshot: () => ({ status: view === undefined ? 'idle' : 'ready', view, error: null }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      ensure: async () => {},
      acceptView: () => {},
    },
    publish: (namespaces) => {
      view = { namespaces, writable: true, hasDocument: true }
      for (const listener of listeners) listener()
    },
  }
}

/** A client context whose only seats are the family binder and the shared forms service. */
function fakeContext(options: { familyBinder?: object; mirror: FakeMirror; forms: Map<string, ConfigForm<unknown>>; asked: string[] }): ClientContext {
  return {
    get: (name: string) => (name === 'webUiSettings' ? options.familyBinder : undefined),
    configForms: {
      describe: () => options.mirror.face,
      get: (entryId: string) => {
        options.asked.push(entryId)
        return options.forms.get(entryId)
      },
    },
  } as unknown as ClientContext
}

describe('dsh-ssh browser settings binding', () => {
  it('operator reads the shared entry through the family binder when that group is loaded', () => {
    // Given dsh-web-settings loaded, answering a section for the dsh-ssh namespace
    const requested: string[] = []
    const family = fakeForm<SshSettings>({ terminalFontFamily: 'Fira Code' })
    const ctx = fakeContext({
      familyBinder: {
        bind: (spec: { namespace: string }) => {
          requested.push(spec.namespace)
          return family.form as unknown as ConfigForm<unknown>
        },
      },
      mirror: fakeMirror(),
      forms: new Map(),
      asked: [],
    })
    const changes: number[] = []

    // When the plugin binds its reader and subscribes to it
    const binding = bindSettingsReader<SshSettings>(ctx, 'dsh-ssh', 'terminalFontFamily')
    binding.subscribe(() => changes.push(changes.length + 1))
    family.update({ terminalFontFamily: 'JetBrains Mono' })

    // Then the reader asked for the family namespace, followed the family form, and notified its listener
    expect(requested).toEqual(['dsh-ssh'])
    expect(binding.getSnapshot().value?.terminalFontFamily).toBe('JetBrains Mono')
    expect(changes).toHaveLength(1)
    binding.dispose()
  })

  it('operator reads the entry the shared surface serves when the family group is absent', () => {
    // Given no family binder, a Host answering two entries, and one of them carrying the field this plugin declares
    const mirror = fakeMirror()
    const asked: string[] = []
    const own = fakeForm<SshSettings>({ terminalFontFamily: 'Fira Code' })
    const ctx = fakeContext({
      mirror,
      forms: new Map<string, ConfigForm<unknown>>([
        ['web-ui-langshen', fakeForm({ enabled: true }).form as unknown as ConfigForm<unknown>],
        ['web-ui-ssh', own.form as unknown as ConfigForm<unknown>],
      ]),
      asked,
    })
    const binding = bindSettingsReader<SshSettings>(ctx, 'dsh-ssh', 'terminalFontFamily')

    // When the Host publishes its entry list
    mirror.publish([
      { ns: 'web-ui-langshen', value: { enabled: true } },
      { ns: 'web-ui-ssh', value: { enabled: true, terminalFontFamily: 'Fira Code' } },
    ])

    // Then the reader bound the entry that owns its field and reports that section
    expect(asked).toEqual(['web-ui-ssh'])
    expect(binding.getSnapshot().value?.terminalFontFamily).toBe('Fira Code')
    binding.dispose()
  })

  it('operator keeps the previous loading state until the Host names the plugin entry', () => {
    // Given no family binder and a Host that has not answered yet
    const mirror = fakeMirror()
    const own = fakeForm<SshSettings>({ terminalFontFamily: 'Fira Code' })
    const ctx = fakeContext({
      mirror,
      forms: new Map<string, ConfigForm<unknown>>([['ssh', own.form as unknown as ConfigForm<unknown>]]),
      asked: [],
    })
    const changes: string[] = []

    // When the plugin binds its reader and the answer arrives afterwards
    const binding = bindSettingsReader<SshSettings>(ctx, 'dsh-ssh', 'terminalFontFamily')
    binding.subscribe(() => changes.push(binding.getSnapshot().status))
    const before = binding.getSnapshot().status
    mirror.publish([{ ns: 'ssh', value: { terminalFontFamily: 'Fira Code' } }])

    // Then the reader reported loading first and turned ready with the section the Host served
    expect(before).toBe('loading')
    expect(binding.getSnapshot().status).toBe('ready')
    expect(binding.getSnapshot().value?.terminalFontFamily).toBe('Fira Code')
    expect(changes).toEqual(['ready'])
    binding.dispose()
  })

  it('operator keeps the reader unbound when the forms service answers no form for its entry', () => {
    // Given a forms service that serves the entry in its mirror but hands out no form
    const mirror = fakeMirror()
    const ctx = fakeContext({ mirror, forms: new Map(), asked: [] })

    // When the Host publishes this plugin's entry
    const binding = bindSettingsReader<SshSettings>(ctx, 'dsh-ssh', 'terminalFontFamily')
    mirror.publish([{ ns: 'ssh', value: { terminalFontFamily: 'Fira Code' } }])

    // Then the reader stays in its loading state instead of failing the boot
    expect(binding.getSnapshot().status).toBe('loading')
    expect(binding.getSnapshot().value).toBeUndefined()
    binding.dispose()
  })

  it('operator stays unbound while no served entry declares the plugin field', () => {
    // Given a Host that serves entries without this plugin's field
    const mirror = fakeMirror()
    const asked: string[] = []
    const ctx = fakeContext({
      mirror,
      forms: new Map<string, ConfigForm<unknown>>([['market', fakeForm({ enabled: true }).form as unknown as ConfigForm<unknown>]]),
      asked,
    })

    // When the plugin binds its reader and the Host publishes those entries
    const binding = bindSettingsReader<SshSettings>(ctx, 'dsh-ssh', 'terminalFontFamily')
    mirror.publish([{ ns: 'market', value: { enabled: true, marketplaceUrl: 'https://dsh-market.com' } }])

    // Then no form was asked for and the reader still reports loading
    expect(asked).toEqual([])
    expect(binding.getSnapshot().status).toBe('loading')
    binding.dispose()
  })
})
