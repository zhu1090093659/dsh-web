/**
 * Host-half configuration contract: rescue mode is on by default so a fresh
 * install or a Web UI version update boots protected, while an explicit off
 * choice stays off. Under 0.1.7 the plugin's own Config schema IS what the
 * Host settings surface serves, so this spec asserts the two properties that
 * carries: every policy field is declared volatile (the fields the Host
 * projects into the entry's form and the only paths that accept a write), and
 * the runtime reads its effective policy through the references the Host
 * commits edits into.
 */
import { describe, expect, it } from 'vitest'
import { Config, effectiveConfig, type Config as LiveConfig } from '../src/index.ts'

/** The write hook the Loader uses to commit a new value into a live reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Commit a value into a live config reference, exactly as the Loader's volatile update does. */
function commit(reference: unknown, value: unknown): void {
  const write = (reference as Record<symbol, ((next: unknown) => void) | undefined>)[VOLATILE_WRITE]
  if (write === undefined) throw new Error('the config field is not a live reference')
  write(value)
}

describe('doctor host config', () => {
  it('operator gets the rescue-mode defaults from a fresh config entry', () => {
    // Given a profile row that carries no doctor config at all
    const resolved = Config({})

    // When the runtime reads its effective policy
    const value = effectiveConfig(resolved)

    // Then rescue mode, full protection and auto migration default on, while
    // automatic repair stays opt-in and the heartbeat keeps its cadence
    expect(value).toEqual({ enabled: true, fullProtection: true, autoRepair: false, autoMigrate: true, heartbeatIntervalMs: 5000 })
  })

  it('operator keeps an explicit off choice', () => {
    // Given a profile row that turns rescue mode off explicitly
    const resolved = Config({ enabled: false })

    // When the runtime reads its effective policy
    // Then the off choice is what the runtime acts on
    expect(effectiveConfig(resolved).enabled).toBe(false)
  })

  it('operator edits a policy field and the runtime reads it without a remount', () => {
    // Given a validated config whose references the running activation holds
    const resolved = Config({})
    const held = effectiveConfig(resolved)
    expect(held.autoRepair).toBe(false)

    // When the Host commits the edited value into that reference (the Loader's
    // live update for a volatile field, not a row remount) and reads the refs again
    const committed = Config({ autoRepair: true, heartbeatIntervalMs: 2000 })
    commit(resolved.autoRepair, committed.autoRepair.get())
    commit(resolved.heartbeatIntervalMs, committed.heartbeatIntervalMs.get())

    // Then the same activation reports the new policy
    expect(effectiveConfig(resolved)).toEqual({ ...held, autoRepair: true, heartbeatIntervalMs: 2000 })
  })

  it('operator sees every policy field served to the settings surface', () => {
    // Given the plugin config schema the Host projects for this entry
    const fields = Object.entries(Config.dict as Record<string, { meta: { volatile?: boolean } }>)

    // When the Host settings surface collects the entry's editable fields
    const editable = fields.filter(([, schema]) => schema.meta.volatile === true).map(([name]) => name).sort()

    // Then the form carries exactly the policy fields the settings card edits
    expect(editable).toEqual(['autoMigrate', 'autoRepair', 'enabled', 'fullProtection', 'heartbeatIntervalMs'])
  })

  it('operator keeps working on a host that hands over plain values', () => {
    // Given a resolved config that carries plain values instead of references
    const plain = { enabled: false, fullProtection: true, autoRepair: true, autoMigrate: false } as unknown as LiveConfig

    // When the runtime reads its effective policy
    // Then the plain values are honored and only the absent field falls back
    expect(effectiveConfig(plain)).toEqual({ enabled: false, fullProtection: true, autoRepair: true, autoMigrate: false, heartbeatIntervalMs: 5000 })
  })
})
