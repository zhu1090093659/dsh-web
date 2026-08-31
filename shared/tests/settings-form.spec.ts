import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, booleanField, choiceField, numberField, secretField, textField } from '../client/settings/settings-form.ts'
// The shared vitest env has no runtime: stub the snapshot-store factory so
// bind() works in tests.
vi.mock('@deepseek-ai/dsh-client-store', () => {
  const createSnapshotStore = (initial: unknown) => {
    let value = initial
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next },
      subscribe: () => () => {},
    }
  }
  return { createSnapshotStore }
})

/**
 * Minimal in-memory scope backing a CardForm test. It models the REAL 0.1.2
 * scope contract, not the form's assumptions: mutate takes ordered path ops;
 * a refused mutation applies nothing, recovers with a fresh Host view, and
 * RESOLVES (it never rejects); an accepted mutation folds the new view into
 * the snapshot before the promise resolves; role('secret') fields are
 * redacted from every view layer and tracked in a sidecar the snapshot never
 * exposes.
 */
class FakeScope<T extends Record<string, unknown>> implements SettingsScope<T> {
  value: T
  base: T
  user: Partial<T> = {}
  writable = true
  status: 'ready' | 'loading' = 'ready'
  revision = 1
  /** Fields the Host declares secret (role('secret')) and strips from every view. */
  redacted = new Set<string>()
  /** The sidecar the redacted fields are tracked in; never exposed on the snapshot. */
  heldSecrets = new Set<string>()
  /** Whether the Host validator refuses the next mutation. */
  refuseMutate = false
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => { await this.write([{ op: 'set', path: [field], value }]) })
  unset = vi.fn(async (field: string) => { await this.write([{ op: 'unset', path: [field] }]) })
  mutate = vi.fn(async (ops: ReadonlyArray<{ op: string; path: Array<string | number>; value?: unknown }>) => {
    await this.write(ops)
  })
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Notify subscribers after a snapshot change, the way a real scope does. */
  notify(): void {
    for (const listener of this.listeners) listener()
  }
  getSnapshot(): SettingsScopeSnapshot<T> {
    return {
      status: this.status,
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: this.revision,
      mode: 'host',
    }
  }
  constructor(value: T) {
    this.value = value
    this.base = value
  }
  /** Re-project the section after a direct user-layer edit, the way a real scope re-derives. */
  settle(): void {
    this.reflect()
  }
  /**
   * Run one mutation under the real contract. A refusal applies nothing and
   * recovers with a fresh (unchanged) view. An accepted mutation updates the
   * raw user layer — redacted fields land in the sidecar, never a view —
   * bumps the revision only when the raw section changed, and publishes the
   * folded view before resolving.
   */
  private async write(ops: ReadonlyArray<{ op: string; path: Array<string | number>; value?: unknown }>): Promise<void> {
    if (this.refuseMutate) {
      // Recovery reload: the Host view is re-read and republished unchanged.
      this.reflect()
      this.notify()
      return
    }
    const before = JSON.stringify([this.user, [...this.heldSecrets].sort()])
    for (const item of ops) {
      const field = String(item.path[item.path.length - 1])
      if (this.redacted.has(field)) {
        if (item.op === 'unset') this.heldSecrets.delete(field)
        else this.heldSecrets.add(field)
        continue
      }
      if (item.op === 'unset') delete (this.user as Record<string, unknown>)[field]
      else (this.user as Record<string, unknown>)[field] = item.value
    }
    if (JSON.stringify([this.user, [...this.heldSecrets].sort()]) !== before) this.revision += 1
    this.reflect()
    this.notify()
  }
  /** Apply the stored value over the base, the way a real scope projects its section. */
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
  }
}

describe('shared settings-form field specs', () => {
  it('numberField formats stored numbers and clears on empty draft', () => {
    const spec = numberField('size')
    expect(spec.format(32)).toBe('32')
    expect(spec.format(undefined)).toBe('')
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse(' 64 ')).toEqual({ kind: 'set', value: 64 })
    expect(spec.parse('abc')).toBeUndefined()
  })

  it('numberField honors integer and min constraints', () => {
    const spec = numberField('size', { integer: true, min: 32 })
    expect(spec.parse('32')).toEqual({ kind: 'set', value: 32 })
    expect(spec.parse('32.5')).toBeUndefined()
    expect(spec.parse('31')).toBeUndefined()
  })

  it('booleanField trims drafts and treats the empty string as a clear', () => {
    const spec = booleanField('enabled')
    expect(spec.parse(' true ')).toEqual({ kind: 'set', value: true })
    expect(spec.parse('false')).toEqual({ kind: 'set', value: false })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
    expect(spec.parse('yes')).toBeUndefined()
  })

  it('textField trims drafts and clears on empty input', () => {
    const spec = textField('name')
    expect(spec.parse('  hugo  ')).toEqual({ kind: 'set', value: 'hugo' })
    expect(spec.parse('')).toEqual({ kind: 'clear' })
  })

  it('choiceField accepts only listed choices', () => {
    const spec = choiceField('model', ['a', 'b'])
    expect(spec.format('a')).toBe('a')
    expect(spec.format('zzz')).toBe('')
    expect(spec.parse('b')).toEqual({ kind: 'set', value: 'b' })
    expect(spec.parse('zzz')).toBeUndefined()
    expect(spec.parse('')).toEqual({ kind: 'clear' })
  })
})

describe('CardForm', () => {
  const fields = () => [booleanField('enabled'), numberField('size'), textField('name'), choiceField('model', ['a', 'b'])]

  it('exposes a ready, clean, writable shell over a served namespace', () => {
    const scope = new FakeScope({ enabled: true, size: 32 })
    const form = new CardForm(scope, fields())
    expect(form.shell()).toMatchObject({ available: true, exposed: true, writable: true, dirty: false, invalid: false })
  })

  it('stages edits and writes them on save', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true, size: 32 })
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('size', '64')
    actions.edit('name', 'hugo')
    expect(form.shell().dirty).toBe(true)
    expect(form.field('size')).toMatchObject({ text: '64', overridden: true, invalid: false })
    await form.save()
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    expect(scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['size'], value: 64 },
      { op: 'set', path: ['name'], value: 'hugo' },
    ])
    expect(form.shell().dirty).toBe(false)
    expect(form.field('size')).toMatchObject({ text: '64', overridden: true })
  })

  it('blocks the save while a draft is invalid and keeps it staged', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ size: 32 })
    const form = new CardForm(scope, fields())
    form.actions().edit('size', 'not-a-number')
    expect(form.shell().invalid).toBe(true)
    await form.save()
    expect(scope.mutate).not.toHaveBeenCalled()
    expect(form.shell().dirty).toBe(true)
  })

  it('clears only the fields the save actually wrote, preserving in-flight edits', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true, size: 32, name: 'old' })
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('name', 'new')
    // A deferred mutation keeps the save in flight so we can stage a second
    // edit mid-save.
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const originalMutate = scope.mutate.getMockImplementation()
    scope.mutate.mockImplementation(async (ops) => {
      await gate
      await originalMutate!(ops)
    })
    const saving = form.save()
    actions.edit('size', '99')
    release!()
    await saving
    expect(form.field('size')).toMatchObject({ text: '99', invalid: false })
    expect(form.shell().dirty).toBe(true)
    await form.save()
    expect(form.shell().dirty).toBe(false)
  })

  it('keeps an in-flight edit to the SAME field being saved', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ enabled: true, size: 32, name: 'old' })
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('name', 'new')
    // A deferred mutation keeps the save in flight so we can re-edit the same
    // field mid-save.
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const originalMutate = scope.mutate.getMockImplementation()
    scope.mutate.mockImplementation(async (ops) => {
      await gate
      await originalMutate!(ops)
    })
    const saving = form.save()
    actions.edit('name', 'newer')
    release!()
    await saving
    // The newer draft survives: only the entry this save started from is
    // cleared, not a draft the user staged while the write was in flight.
    expect(form.field('name')).toMatchObject({ text: 'newer', invalid: false })
    expect(form.shell().dirty).toBe(true)
    await form.save()
    expect(form.shell().dirty).toBe(false)
  })

  it('reports failure and keeps drafts when the mutation resolves without landing', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'old' })
    // The real 0.1.2 refusal: the scope applies nothing, recovers with a
    // fresh view, and resolves — it never rejects.
    scope.refuseMutate = true
    const form = new CardForm(scope, fields())
    form.actions().edit('name', 'new')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    expect(form.shell()).toMatchObject({ failed: true, dirty: true, saving: false })
    // A read-back failure carries no server reason: the card shows its
    // generic failure copy, not a rejection message.
    expect(form.shell().failedReason).toBeUndefined()
    expect(form.field('name')).toMatchObject({ text: 'new' })
  })

  it('reports failure with the rejection message when the scope rejects (bridge contract)', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'old' })
    // The dsh-web bridge scope still throws on a refused mutation.
    scope.mutate.mockRejectedValue(new Error('settings-rejected'))
    const form = new CardForm(scope, fields())
    form.actions().edit('name', 'new')
    await form.save()
    expect(form.shell()).toMatchObject({ failed: true, dirty: true, saving: false })
    expect(form.shell().failedReason).toBe('settings-rejected')
    expect(form.field('name')).toMatchObject({ text: 'new' })
  })

  it('fails the whole atomic save when the refused batch also carried an unset', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ size: 32, name: 'old' })
    scope.refuseMutate = true
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('name', 'new')
    actions.edit('size', '')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['name'], value: 'new' },
      { op: 'unset', path: ['size'] },
    ])
    expect(form.shell()).toMatchObject({ failed: true, dirty: true })
    expect(form.field('name')).toMatchObject({ text: 'new' })
    expect(form.field('size')).toMatchObject({ text: '', overridden: false })
  })

  it('drops the drafts of a save whose set and unset writes all land', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ size: 32, name: 'old' })
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('name', 'new')
    actions.edit('size', '')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['name'], value: 'new' },
      { op: 'unset', path: ['size'] },
    ])
    expect(form.shell()).toMatchObject({ failed: false, dirty: false })
    // The cleared override re-inherits the composition base.
    expect(form.field('size')).toMatchObject({ text: '32', overridden: false })
  })

  it('clears the failure once a later save lands', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'old' })
    scope.refuseMutate = true
    const form = new CardForm(scope, fields())
    form.actions().edit('name', 'new')
    await form.save()
    expect(form.shell().failed).toBe(true)
    scope.refuseMutate = false
    await form.save()
    expect(form.shell()).toMatchObject({ failed: false, dirty: false })
  })

  it('resets a field back to its base value', () => {
    const scope = new FakeScope({ enabled: true })
    const form = new CardForm(scope, fields())
    const actions = form.actions()
    actions.edit('enabled', 'false')
    expect(form.field('enabled').text).toBe('false')
    actions.resetField('enabled')
    expect(form.field('enabled')).toMatchObject({ text: 'true', overridden: false })
  })

  it('dispose stops later scope mutations from reaching bound stores', () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'before' })
    const form = new CardForm(scope, fields())
    const store = form.bind(() => form.field('name').text)
    expect(store.getSnapshot()).toBe('before')
    // Idempotent: a second dispose keeps the first teardown's guarantees.
    form.dispose()
    form.dispose()
    scope.user.name = 'after'
    scope.settle()
    scope.notify()
    expect(store.getSnapshot()).toBe('before')
  })
})

describe('CardForm atomic save', () => {
  const batchFields = () => [numberField('size'), textField('name'), textField('url')]

  it('sends every planned write in one atomic scope.mutate call', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ size: 32 })
    const form = new CardForm(scope, batchFields())
    const actions = form.actions()
    actions.edit('size', '64')
    actions.edit('name', 'hugo')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    expect(scope.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['size'], value: 64 },
      { op: 'set', path: ['name'], value: 'hugo' },
    ])
    expect(scope.set).not.toHaveBeenCalled()
    expect(scope.unset).not.toHaveBeenCalled()
    expect(form.shell().dirty).toBe(false)
  })

  it('keeps every draft staged when the mutation resolves without landing', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'old', url: 'old-url' })
    // Real 0.1.2 refusal: the scope applies nothing, recovers, and resolves.
    scope.refuseMutate = true
    const form = new CardForm(scope, batchFields())
    const actions = form.actions()
    actions.edit('name', 'new')
    actions.edit('url', 'new-url')
    await form.save()
    // The mutation resolved, but nothing landed: the save must report failure
    // and keep every draft staged.
    expect(scope.mutate).toHaveBeenCalledTimes(1)
    expect(form.shell()).toMatchObject({ failed: true, dirty: true, saving: false })
    expect(form.shell().failedReason).toBeUndefined()
    expect(form.field('url')).toMatchObject({ text: 'new-url' })
    expect(form.field('name')).toMatchObject({ text: 'new' })
  })

  it('keeps every draft staged when the scope rejects the mutation', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ name: 'old', url: 'old-url' })
    scope.mutate.mockRejectedValue(new Error('rejected by the host validator'))
    const form = new CardForm(scope, batchFields())
    const actions = form.actions()
    actions.edit('name', 'new')
    actions.edit('url', 'new-url')
    await form.save()
    // The mutation is atomic: nothing landed, so every draft stays staged.
    expect(form.shell()).toMatchObject({ failed: true, dirty: true })
    expect(form.shell().failedReason).toBe('rejected by the host validator')
    expect(form.field('url')).toMatchObject({ text: 'new-url' })
  })

  it('treats a redacted secret set as landed when the mutation settles', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ model: 'm' })
    // The Host redacts role('secret') fields: the key never appears in any
    // view layer, so the save cannot compare it back and judges the set by
    // the mutation settling.
    scope.redacted.add('apiKey')
    const form = new CardForm(scope, [textField('model'), secretField('apiKey')])
    form.actions().edit('apiKey', 'sk-secret')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['apiKey'], value: 'sk-secret' }])
    expect(form.shell()).toMatchObject({ failed: false, dirty: false })
    expect((scope.getSnapshot().user as Record<string, unknown>).apiKey).toBeUndefined()
    expect(scope.heldSecrets.has('apiKey')).toBe(true)
  })

  it('clears a field with an unset operation when its draft is empty', async () => {
    const scope = new FakeScope<Record<string, unknown>>({ model: 'm' })
    const form = new CardForm(scope, [textField('model'), secretField('apiKey')])
    form.actions().edit('model', '')
    await form.save()
    expect(scope.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['model'] }])
    expect(form.shell()).toMatchObject({ failed: false, dirty: false })
  })
})
