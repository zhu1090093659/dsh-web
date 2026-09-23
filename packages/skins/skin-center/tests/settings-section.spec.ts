/**
 * Section view over one profile entry's configuration form. 0.1.7 serves ONE
 * form per profile entry, so the skin center's three preference families are
 * sections of that form; this spec pins what the wrapper must preserve —
 * the projection of the parent's value/user/base layers onto its section, the
 * path-addressed writes it queues on the shared form, and the refusal it
 * answers back instead of reporting a success.
 */
import { describe, expect, it } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { settingsSection } from '../src/client/settings-section.ts'

interface Parent {
  'skin-wallpaper': { selection?: string; dim?: number }
  'skin-custom-theme': { applied?: boolean }
}

/** A fake entry form publishing one snapshot and recording every queued mutation. */
function fakeForm(overrides: Partial<ConfigFormSnapshot<unknown>> = {}): {
  form: ConfigForm<unknown>
  mutations: Array<{ ops: readonly SettingsPathOpView[]; expectedRevision: number | undefined }>
  answer(value: boolean): void
  publish(snapshot: ConfigFormSnapshot<unknown>): void
} {
  let snapshot: ConfigFormSnapshot<unknown> = {
    status: 'ready',
    value: { 'skin-wallpaper': { selection: '111', dim: 25 }, 'skin-custom-theme': { applied: false } },
    base: { 'skin-wallpaper': { dim: 25 } },
    user: { 'skin-wallpaper': { selection: '111' } },
    revision: 7,
    writable: true,
    mode: 'host',
    ...overrides,
  }
  let accepted = true
  const mutations: Array<{ ops: readonly SettingsPathOpView[]; expectedRevision: number | undefined }> = []
  const listeners = new Set<() => void>()
  const form: ConfigForm<unknown> = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => accepted,
    unset: async () => accepted,
    mutate: async (ops, expectedRevision) => {
      mutations.push({ ops, expectedRevision })
      return accepted
    },
  }
  return {
    form,
    mutations,
    answer: value => { accepted = value },
    publish: (next) => {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

describe('settingsSection', () => {
  it('user sees the wrapped section as the form value, user layer and revision', () => {
    // Given an entry form holding the wallpaper section
    const { form } = fakeForm()

    // When the card binds that section of the entry
    const section = settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper')

    // Then it reads the section's own layers, not the whole entry
    expect(section.getSnapshot()).toEqual({
      status: 'ready',
      value: { selection: '111', dim: 25 },
      base: { dim: 25 },
      user: { selection: '111' },
      revision: 7,
      writable: true,
      mode: 'host',
    })
  })

  it('user keeps a stable section snapshot until the entry publishes a new one', () => {
    // Given a card reading its section snapshot
    const { form, publish } = fakeForm()
    const section = settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper')
    const first = section.getSnapshot()

    // When the card reads it again before anything changed
    // Then it gets the same reference back (the form contract's stability)
    expect(section.getSnapshot()).toBe(first)

    // When the entry publishes a new snapshot
    publish({
      ...first,
      value: { 'skin-wallpaper': { selection: '222', dim: 25 }, 'skin-custom-theme': {} },
      revision: 8,
    })

    // Then the section projects the new revision and value once
    const second = section.getSnapshot()
    expect(second).not.toBe(first)
    expect(second.revision).toBe(8)
    expect(second.value).toEqual({ selection: '222', dim: 25 })
    expect(section.getSnapshot()).toBe(second)
  })

  it('user gets the section notifications the entry form publishes', () => {
    // Given a card watching the section
    const { form, publish } = fakeForm()
    const section = settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper')
    let notifications = 0
    const unsubscribe = section.subscribe(() => { notifications += 1 })

    // When the entry form publishes and then the card unsubscribes
    publish({ ...form.getSnapshot(), revision: 9 })
    const afterFirstPublish = notifications
    unsubscribe()
    publish({ ...form.getSnapshot(), revision: 10 })

    // Then every publish reached the card until it stopped watching
    expect(afterFirstPublish).toBe(1)
    expect(notifications).toBe(1)
  })

  it('user writes one field through the section path on the entry form', async () => {
    // Given a card editing the wallpaper section
    const { form, mutations } = fakeForm()
    const section = settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper')

    // When it sets and clears two fields
    await section.set('dim', 40)
    await section.unset('selection')

    // Then each write is addressed at the section path inside the entry
    expect(mutations).toEqual([
      { ops: [{ op: 'set', path: ['skin-wallpaper', 'dim'], value: 40 }], expectedRevision: undefined },
      { ops: [{ op: 'unset', path: ['skin-wallpaper', 'selection'] }], expectedRevision: undefined },
    ])
  })

  it('user writes a staged batch atomically under the section path', async () => {
    // Given a card saving a staged batch with the revision it read
    const { form, mutations } = fakeForm()
    const section = settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper')

    // When it mutates two fields in one call
    await section.mutate([
      { op: 'set', path: ['dim'], value: 60 },
      { op: 'unset', path: ['selection'] },
    ], 7)

    // Then both ops stay in one mutation, prefixed with the section key
    expect(mutations).toEqual([{
      ops: [
        { op: 'set', path: ['skin-wallpaper', 'dim'], value: 60 },
        { op: 'unset', path: ['skin-wallpaper', 'selection'] },
      ],
      expectedRevision: 7,
    }])
  })

  it('user sees a refused write as a failure, not as a saved setting', async () => {
    // Given an entry form the Host refuses to write through
    const { form, answer } = fakeForm()
    const section = settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper')
    answer(false)

    // When the card writes a field, clears one and mutates a batch
    const written = await section.set('dim', 40)
    const cleared = await section.unset('dim')
    const mutated = await section.mutate([{ op: 'set', path: ['dim'], value: 40 }])

    // Then every answer reports the refusal rather than a success
    expect([written, cleared, mutated]).toEqual([false, false, false])
  })

  it('user sees an entry the Host does not serve as an unavailable section', () => {
    // Given an entry form whose status is unavailable
    const { form } = fakeForm({
      status: 'unavailable',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
    })

    // When the card binds a section of it
    // Then the section reports unavailable and not writable, so no control
    // pretends to be savable
    expect(settingsSection<Parent['skin-wallpaper']>(form, 'skin-wallpaper').getSnapshot())
      .toEqual({
        status: 'unavailable',
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'host',
      })
  })
})
