/**
 * Client settings-form binding on the 0.1.7 cohort.
 *
 * A settings form is addressed by profile entry id there, while this card knows
 * only its family namespace: the family binder (dsh-web-settings) is what
 * resolves one onto the other, and the shared configuration forms service is
 * the fallback for a page that serves no binder.
 *
 * The regression this file pins: the fallback used to bind the bare namespace
 * whenever the describe mirror held nothing yet, which is the normal state at
 * plugin activation. The Host serves no entry under that id, so every save
 * answered "No configurable plugin entry liangshen" and the card kept the draft
 * with its "the deployment did not accept these values" notice. A one-shot guess
 * cannot be right for every deployment either (a standalone install's row id is
 * the namespace), so the fallback rebinds when the mirror answers.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { bindSettingsForm } from '../src/client/index.ts'

/** One fake form the shared forms service hands out, recording the writes it sees. */
function fakeForm<T>(value: T) {
  const listeners = new Set<() => void>()
  const sets: Array<[string, unknown]> = []
  return {
    form: {
      getSnapshot: () => ({
        status: 'ready' as const,
        value,
        base: undefined,
        user: undefined,
        revision: 1,
        writable: true,
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: async (field: string, next: unknown) => { sets.push([field, next]); return true },
      unset: async () => true,
      mutate: async () => true,
    } as unknown as ConfigForm<T>,
    sets,
  }
}

/**
 * A client context double: the family binder is absent (the fallback path), and
 * the shared mirror answers whatever the test published last.
 * @param initialRows - the namespace rows the mirror holds; undefined models an unanswered mirror.
 */
function context(initialRows?: string[]) {
  const requests: string[] = []
  const forms = new Map<string, ReturnType<typeof fakeForm>>()
  const mirrorListeners = new Set<() => void>()
  const rows = { current: initialRows }
  const get = vi.fn((entryId: string) => {
    requests.push(entryId)
    const existing = forms.get(entryId)
    if (existing !== undefined) return existing.form
    const created = fakeForm({ enabled: true })
    forms.set(entryId, created)
    return created.form
  })
  const ctx = {
    get: () => undefined,
    configForms: {
      get,
      describe: () => ({
        getSnapshot: () => (rows.current === undefined
          ? { status: 'idle' as const, view: undefined, error: null }
          : {
              status: 'ready' as const,
              view: { namespaces: rows.current.map(ns => ({ ns })), writable: true, hasDocument: true },
              error: null,
            }),
        subscribe: (listener: () => void) => {
          mirrorListeners.add(listener)
          return () => { mirrorListeners.delete(listener) }
        },
      }),
    },
  }
  return {
    ctx,
    requests,
    /** Publish a new mirror answer, the way the shared mirror does on a document update. */
    answer: (next: string[]) => {
      rows.current = next
      for (const listener of [...mirrorListeners]) listener()
    },
  }
}

describe('liangshen settings binding', () => {
  it('user whose mirror has not answered yet binds the aggregate row rather than the namespace', () => {
    // Given a cold start where the describe mirror holds no answer, as at plugin activation
    const { ctx, requests } = context()
    // When the card binds its settings form
    bindSettingsForm(ctx as never)
    // Then it binds a row the Host can actually serve, so a save is not rejected
    expect(requests).toEqual(['web-ui-liangshen'])
  })

  it('user whose mirror answers the aggregate row keeps that binding', () => {
    // Given a mirror that already names this package's aggregate row
    const { ctx, requests } = context(['web-ui-liangshen'])
    // When the card binds its settings form
    bindSettingsForm(ctx as never)
    // Then the aggregate row is the one bound
    expect(requests).toEqual(['web-ui-liangshen'])
  })

  it('user on a standalone install is rebound to the standalone row once the mirror answers', () => {
    // Given a cold start, where the first binding is the aggregate row by default
    const { ctx, requests, answer } = context()
    bindSettingsForm(ctx as never)
    expect(requests).toEqual(['web-ui-liangshen'])
    // When the mirror then answers with this profile's own standalone row
    answer(['ui-liangshen'])
    // Then the form is rebound onto that row instead of keeping a dead entry id
    expect(requests).toEqual(['web-ui-liangshen', 'ui-liangshen'])
  })

  it('user of a profile serving none of this package rows binds the bare namespace', () => {
    // Given a mirror that explicitly answers with other plugins' rows
    const { ctx, requests } = context(['web-ui-pet', 'web-ui-ssh'])
    // When the card binds its settings form
    bindSettingsForm(ctx as never)
    // Then the namespace itself is addressed, which is the pre-0.1.7 keying shape
    expect(requests).toEqual(['liangshen'])
  })

  it('user whose mirror read is refused keeps the aggregate row', () => {
    // Given a mirror that throws instead of answering
    const ctx = {
      get: () => undefined,
      configForms: {
        get: vi.fn(() => ({
          getSnapshot: () => ({
            status: 'loading' as const,
            value: undefined,
            base: undefined,
            user: undefined,
            revision: undefined,
            writable: false,
              }),
          subscribe: () => () => {},
          set: async () => false,
          unset: async () => false,
          mutate: async () => false,
        })),
        describe: () => ({
          getSnapshot: () => { throw new Error('mirror unavailable') },
          subscribe: () => () => {},
        }),
      },
    }
    // When the card binds its settings form
    const form = bindSettingsForm(ctx as never)
    // Then the refusal is treated as unanswered, not as absence
    expect(form.getSnapshot().status).toBe('loading')
  })

  it('user with the family group loaded binds through the family namespace', () => {
    // Given a page that serves the family binder
    const bound: string[] = []
    const ctx = {
      get: (name: string) => (name === 'webUiSettings'
        ? { bind: (spec: { namespace: string }) => { bound.push(spec.namespace); return fakeForm({ enabled: true }).form } }
        : undefined),
      configForms: {
        get: vi.fn(),
        describe: () => ({ getSnapshot: () => ({ view: undefined }), subscribe: () => () => {} }),
      },
    }
    // When the card binds its settings form
    bindSettingsForm(ctx as never)
    // Then the binder answered, resolving the namespace itself, and no entry id was guessed
    expect(bound).toEqual(['liangshen'])
  })
})
