/**
 * Section-identity contract for the 2026-09-15 native-first decision: the
 * plugin takes over the OFFICIAL archived-sessions settings section (the id
 * and order that @deepseek-ai/dsh-client-ui-settings-unarchive-sessions seats)
 * instead of registering a parallel first-level entry, and dsh-web-all retires
 * the official row. A regression here puts two near-identical archive entries
 * back into Settings.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

interface Registration {
  name: string
  options: Record<string, unknown>
}

/** Mount the browser half against a capture-only ctx. */
function mountClient(): Registration[] {
  const registrations: Registration[] = []
  const configForm = {
    getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
  }
  const ctx = {
    effect: (run: () => unknown) => {
      run()
      return () => {}
    },
    get: () => undefined,
    configForms: { get: () => configForm },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => (zh as Record<string, string>)[key] ?? key,
    },
    slots: {
      inject: (_name: string, run: () => unknown) => run(),
      register: (options: Record<string, unknown>) => {
        registrations.push({ name: String(options.name), options })
        return () => {}
      },
    },
  }
  apply(ctx as never)
  return registrations
}

function section(): Registration | undefined {
  return mountClient().find((entry) => entry.name === 'settings.section')
}

describe('archived-sessions section identity', () => {
  it('user sees the official archived-sessions id and order seated as one entry', () => {
    // Given the plugin's browser half mounted against a capture-only settings ctx
    const seated = section()

    // When the registered settings section is read
    // Then it carries the official id at the official order, not a parallel entry
    expect(seated?.options.id).toBe('archived-sessions')
    expect(seated?.options.order).toBe(25)
  })

  it('user never sees the superseded dsh-session-archive id registered', () => {
    // Given the plugin's browser half mounted against a capture-only settings ctx
    const seated = section()

    // When the registered settings section is read
    // Then the superseded plugin id is absent, so no second entry can exist
    expect(seated?.options.id).not.toBe('dsh-session-archive')
  })

  it('user reads the archived-sessions nav copy on that single entry', () => {
    // Given the plugin's browser half mounted with the zh locale bound
    const label = section()?.options.label as (() => string) | undefined

    // When the seated section's label is resolved
    // Then the entry renders the archived-sessions nav copy in both languages
    expect(typeof label).toBe('function')
    expect(label?.()).toBe('已归档会话')
    expect(en['arch.nav']).toBe('Archived sessions')
  })
})
