/**
 * Flow of the skin-background settings section into the v2 state store
 * (issue: paired remote devices). The settings.yaml section stays the legacy
 * input surface (the official settings page edits it); the v2 state store is
 * the persistence the paired remote desktop can actually read and write,
 * because the settings scope is loopback-only there. Both flows are
 * fail-closed and write only when there is something meaningful to store.
 * @module @linxin666/dsh-client-ui-skin-center/background-migration
 */

import { backgroundDiffersFromDefaults, parseBackgroundConfig } from './core/background.ts'
import { readActiveState, writeActiveState } from './active-state.ts'

/** Result surface shared by the one-shot migration and the ongoing sync. */
export interface BackgroundStateFlowResult {
  /** Whether this run migrated the settings value into an empty state store. */
  migrated: boolean
  /** Whether this run wrote the current settings value into the state store. */
  wrote: boolean
  /** Fail-closed: an error was swallowed and nothing was written. */
  failed: boolean
  /** Human-readable notes for the host log. */
  notes: string[]
}

function failClosed(error: unknown): BackgroundStateFlowResult {
  const message = (error as Error)?.message ?? String(error)
  return { migrated: false, wrote: false, failed: true, notes: [`failed closed: ${message}`] }
}

/**
 * One-shot migration: when the state store has no background section yet and
 * the settings section carries a user-customized value, copy that value into
 * the store. Idempotent — once the store has a background section this is a
 * silent no-op (steady state stays quiet, same policy as the legacy bridge).
 */
export function migrateBackgroundState(options: {
  activeStatePath: string
  source: () => unknown
}): BackgroundStateFlowResult {
  try {
    const state = readActiveState(options.activeStatePath)
    if (state.background !== null) {
      return { migrated: false, wrote: false, failed: false, notes: [] }
    }
    const value = parseBackgroundConfig(options.source())
    if (value === null || !backgroundDiffersFromDefaults(value)) {
      return { migrated: false, wrote: false, failed: false, notes: [] }
    }
    writeActiveState(options.activeStatePath, state.active, value)
    return { migrated: true, wrote: true, failed: false, notes: ['migrated skin-background settings into the v2 state store'] }
  } catch (error) {
    return failClosed(error)
  }
}

/**
 * Ongoing sync: flow settings-page edits into the state store so the official
 * settings surface keeps working as the legacy input. Skips the pristine
 * defaults only when the store has no background section yet, so fresh
 * installs never pay a boot-time write.
 */
export function syncBackgroundState(options: {
  activeStatePath: string
  source: () => unknown
}): BackgroundStateFlowResult {
  try {
    const state = readActiveState(options.activeStatePath)
    const value = parseBackgroundConfig(options.source())
    if (value === null) {
      return { migrated: false, wrote: false, failed: false, notes: [] }
    }
    if (state.background === null && !backgroundDiffersFromDefaults(value)) {
      return { migrated: false, wrote: false, failed: false, notes: [] }
    }
    writeActiveState(options.activeStatePath, state.active, value)
    return { migrated: false, wrote: true, failed: false, notes: ['synced skin-background settings into the v2 state store'] }
  } catch (error) {
    return failClosed(error)
  }
}
