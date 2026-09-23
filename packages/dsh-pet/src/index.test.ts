import { describe, expect, it } from 'vitest'
import { Config, PET_FORM_DEFAULTS, petSettingsSection, type PetFormConfig } from './index.ts'

/** Resolve one config as plain values: volatile fields resolve to live references. */
function plain(config: ReturnType<typeof Config>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).map(([field, value]) => {
    const ref = value as { get?: () => unknown }
    return [field, typeof ref.get === 'function' ? ref.get() : value]
  }))
}

/** The write hook the Loader uses to commit a value into a live config reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Commit a value the way the Loader's volatile update does. */
function commitLive(reference: unknown, value: unknown): void {
  const write = (reference as Record<symbol, ((next: unknown) => void) | undefined>)[VOLATILE_WRITE]
  if (write === undefined) throw new Error('the config field is not a live reference')
  write(value)
}

describe('pet configuration schema', () => {
  it('operator gets the pet selection and display defaults from an entry config that sets nothing', () => {
    // Given a profile entry that declares no pet settings at all
    // When the Host resolves the plugin's own Config schema
    const resolved = plain(Config({}))
    // Then every field the settings page edits carries its documented default
    expect(resolved).toMatchObject({
      visible: true,
      size: 160,
      right: 24,
      bottom: 20,
      bubbleScale: 1,
      enabled: true,
      decorationEnabled: true,
    })
  })

  it('operator keeps a stale pet selection instead of failing config validation', () => {
    // Given a stored selection naming a pet the registry no longer has
    // When the entry config is resolved against the schema
    const resolved = Config({ petId: 'dragon' })
    // Then the selection survives (the service clamps it against the registry)
    expect(resolved.petId.get()).toBe('dragon')
  })

  it('user keeps the saved pet after restart when the profile never selected one', () => {
    // Given a persisted maid whale and no profile-level pet choice
    const resolved = Config({})
    // When the plugin starts and resolves its active settings
    const section = petSettingsSection(resolved, 'jyn')
    // Then the persisted pet survives instead of being reset to the schema default
    expect(section.petId).toBe('jyn')
  })

  it('operator edits every page field through a Host-served config path', () => {
    // Given the Host serves only the volatile fields of a plugin's Config
    // When the pet's schema is inspected field by field
    const volatile = Object.fromEntries(
      Object.entries(Config.dict ?? {}).map(([field, fieldSchema]) => [field, fieldSchema.meta.volatile === true]),
    )
    // Then every field the settings card renders is a volatile one
    expect(volatile).toEqual({
      visible: true,
      size: true,
      right: true,
      bottom: true,
      bubbleScale: true,
      petId: true,
      enabled: true,
      decorationEnabled: true,
    })
  })
})

describe('petSettingsSection', () => {
  it('user runs the pet on the settings the Host committed into the live config', () => {
    // Given a running row whose config references carry the edited values
    const config = {
      size: { get: () => 240 },
      visible: { get: () => false },
      petId: { get: () => 'doro' },
    } as unknown as PetFormConfig
    // When the plugin resolves the settings section it runs with
    const section = petSettingsSection(config, 'whale-girl')
    // Then the edited fields win and the untouched ones resolve to their defaults
    expect(section).toEqual({
      visible: false,
      size: 240,
      right: 24,
      bottom: 20,
      bubbleScale: 1,
      petId: 'doro',
      enabled: true,
      decorationEnabled: true,
    })
  })

  it('user edits a served field and the running pet reads the committed value', () => {
    // Given a resolved config whose volatile fields are live references
    const resolved = Config({})
    const before = petSettingsSection(resolved, 'whale-girl')

    // When the Host commits an edited size the way the Loader does
    commitLive(resolved.size, 260)

    // Then the same activation reads the edit, while the earlier read stays a snapshot
    expect(petSettingsSection(resolved, 'whale-girl').size).toBe(260)
    expect(before.size).toBe(160)
  })

  it('user keeps the pet selection it already has when the config names none', () => {
    // Given a mount whose config carries no pet selection
    // When the plugin resolves the settings section it runs with
    const section = petSettingsSection({}, 'doro')
    // Then the selection the pet already has stands
    expect(section.petId).toBe('doro')
  })
})
