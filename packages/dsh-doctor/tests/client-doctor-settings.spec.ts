/**
 * Doctor settings facade tests: the never-throwing view over the bound
 * configuration form, and the write answer mapping of the 0.1.7 form contract
 * (`false` is a refusal or a skipped write, which must not read as a save).
 */
import { describe, expect, it } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createDoctorSettingsHandle } from '../src/client/doctor-settings.ts'
import type { DoctorSettings } from '../src/client/doctor-types.ts'

/** Hand-rolled form double: one snapshot, one write answer, listener fan-out. */
class FakeForm implements ConfigForm<DoctorSettings> {
  private snapshot: ConfigFormSnapshot<DoctorSettings>
  private readonly listeners = new Set<() => void>()
  /** Answers every write with the configured verdict, or rejects with it. */
  private answer: boolean | Error = true
  /** Fields the last write named, in call order. */
  lastWrite: { field: string; value: unknown } | undefined

  constructor(snapshot: Partial<ConfigFormSnapshot<DoctorSettings>> = {}) {
    this.snapshot = {
      status: 'ready',
      value: { enabled: true },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
      ...snapshot,
    }
  }

  /** Configure the next write answer: a boolean verdict or a rejection. */
  refuse(answer: boolean | Error): void {
    this.answer = answer
  }

  /** Replace the published snapshot and notify every listener. */
  publish(snapshot: Partial<ConfigFormSnapshot<DoctorSettings>>): void {
    this.snapshot = { ...this.snapshot, ...snapshot }
    for (const listener of [...this.listeners]) listener()
  }

  getSnapshot(): ConfigFormSnapshot<DoctorSettings> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async set(field: string, value: unknown): Promise<boolean> {
    this.lastWrite = { field, value }
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }

  unset(): Promise<boolean> {
    return Promise.resolve(true)
  }

  mutate(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

describe('createDoctorSettingsHandle', () => {
  it('operator sees no handle when no form is bound', () => {
    // Given a page where the settings transport never bound a form
    // When the console asks for the enable-switch handle
    const handle = createDoctorSettingsHandle(undefined)

    // Then there is nothing to read or write, which the console renders as unavailable
    expect(handle).toBeNull()
    expect(createDoctorSettingsHandle(null)).toBeNull()
  })

  it('operator reads the enable switch out of the bound form', () => {
    // Given a bound form serving the doctor entry with rescue mode on
    const handle = createDoctorSettingsHandle(new FakeForm({ value: { enabled: true } }))

    // When the console reads the switch state
    // Then the state is ready, enabled and writable
    expect(handle?.getState()).toEqual({ status: 'ready', enabled: true, writable: true })
  })

  it('operator sees the switch as loading until the first accepted section', () => {
    // Given a bound form that has not received a Host section yet
    const handle = createDoctorSettingsHandle(new FakeForm({ status: 'loading', value: undefined, writable: false }))

    // When the console reads the switch state
    // Then it stays loading with the writes refused
    expect(handle?.getState()).toEqual({ status: 'loading', enabled: undefined, writable: false })
  })

  it('operator sees a form that is not exposed as unavailable', () => {
    // Given a form whose entry the Host does not serve to this client
    const handle = createDoctorSettingsHandle(new FakeForm({ status: 'unavailable', value: undefined, writable: false }))

    // When the console reads the switch state
    // Then the state degrades to unavailable instead of a form
    expect(handle?.getState()).toEqual({ status: 'unavailable', enabled: undefined, writable: false })
  })

  it('operator survives a form whose reads throw', () => {
    // Given a hostile form whose snapshot read throws
    const hostile = new FakeForm()
    hostile.getSnapshot = () => { throw new Error('hostile form') }
    const handle = createDoctorSettingsHandle(hostile)

    // When the console reads the switch state
    // Then the read degrades to unavailable instead of taking the console down
    expect(handle?.getState()).toEqual({ status: 'unavailable', enabled: undefined, writable: false })
  })

  it('operator shows the switch state the Host publishes after a write', () => {
    // Given a bound form whose handle is being watched
    const form = new FakeForm({ value: { enabled: true } })
    const handle = createDoctorSettingsHandle(form)
    const seen: string[] = []
    handle?.listen(() => { seen.push(handle.getState().enabled === true ? 'on' : 'off') })

    // When the Host publishes the off state
    form.publish({ value: { enabled: false } })

    // Then the listener saw the new state
    expect(seen).toEqual(['off'])
  })

  it('operator saves the enable switch through the bound form', async () => {
    // Given a bound form whose Host accepts the write
    const form = new FakeForm()
    const handle = createDoctorSettingsHandle(form)

    // When the console turns rescue mode on
    const result = await handle?.setEnabled(true)

    // Then the write landed on the enabled field and the save reports success
    expect(form.lastWrite).toEqual({ field: 'enabled', value: true })
    expect(result).toEqual({ ok: true })
  })

  it('operator sees a refused write as a failed save', async () => {
    // Given a form whose Host refuses or skips the write
    const form = new FakeForm()
    form.refuse(false)
    const handle = createDoctorSettingsHandle(form)

    // When the console toggles the switch on that form
    const refused = await handle?.setEnabled(true)

    // Then the refusal is a failed save, never a silent success
    expect(refused?.ok).toBe(false)
    expect(refused?.ok === false ? refused.error : '').toContain('refused')
  })

  it('operator sees a transport failure as a failed save carrying its reason', async () => {
    // Given a form whose write rejects across the wire
    const form = new FakeForm()
    form.refuse(new Error('settings bridge unreachable'))
    const handle = createDoctorSettingsHandle(form)

    // When the console toggles the switch
    const result = await handle?.setEnabled(false)

    // Then the rejection is reported as a failed save with its reason
    expect(result).toEqual({ ok: false, error: 'settings bridge unreachable' })
  })
})
