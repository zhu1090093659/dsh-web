/**
 * Settings-namespace facade for the doctor enable switch.
 *
 * Wraps the bound configuration form in a never-throwing view: a missing
 * namespace, a memory-mode form or a hostile transport degrades to an
 * 'unavailable' state instead of breaking the console. The facade also routes
 * a failed or refused write back as a result value instead of a rejection.
 * @module @linxin666/dsh-doctor/client
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DoctorSettings } from './doctor-types.ts'

/** Read state of the enable switch. */
export interface DoctorSettingsState {
  status: 'loading' | 'ready' | 'unavailable'
  /** Resolved enabled flag; undefined before ready or when absent (treated on). */
  enabled: boolean | undefined
  /** Whether the host document accepts writes right now. */
  writable: boolean
}

/** Settled result of one toggle write (never a rejection). */
export type DoctorSettingsWrite = { ok: true } | { ok: false; error: string }

/** Never-throwing facade over the bound settings form. */
export interface DoctorSettingsHandle {
  /** Read the current derived state (never throws). */
  getState(): DoctorSettingsState
  /** Subscribe to form snapshot replacements (never throws). */
  listen(listener: () => void): () => void
  /** Persist the enabled flag (never rejects). */
  setEnabled(enabled: boolean): Promise<DoctorSettingsWrite>
}

/** Build a handle, or null when no form is available (host half absent). */
export function createDoctorSettingsHandle(scope: ConfigForm<DoctorSettings> | undefined | null): DoctorSettingsHandle | null {
  if (scope === undefined || scope === null) return null
  return new ScopedDoctorSettingsHandle(scope)
}

const UNAVAILABLE_STATE: DoctorSettingsState = { status: 'unavailable', enabled: undefined, writable: false }

class ScopedDoctorSettingsHandle implements DoctorSettingsHandle {
  private readonly scope: ConfigForm<DoctorSettings>
  /** Derived state is cached against the scope's stable snapshot reference so
   * useSyncExternalStore always receives a cached identity between changes. */
  private lastSnapshot: unknown
  private cached: DoctorSettingsState = UNAVAILABLE_STATE

  constructor(scope: ConfigForm<DoctorSettings>) {
    this.scope = scope
    this.lastSnapshot = undefined
  }

  /** Bound field arrow: stable identity for useSyncExternalStore. */
  getState = (): DoctorSettingsState => {
    try {
      const snapshot = this.scope.getSnapshot()
      if (snapshot === this.lastSnapshot) return this.cached
      this.lastSnapshot = snapshot
      if (snapshot.status === 'unavailable') {
        this.cached = UNAVAILABLE_STATE
      } else if (snapshot.status === 'loading') {
        this.cached = { status: 'loading', enabled: undefined, writable: snapshot.writable === true }
      } else {
        this.cached = {
          status: 'ready',
          enabled: snapshot.value?.enabled === true ? true : false,
          writable: snapshot.writable === true,
        }
      }
      return this.cached
    } catch {
      this.lastSnapshot = undefined
      this.cached = UNAVAILABLE_STATE
      return this.cached
    }
  }

  /** Bound field arrow: stable identity for useSyncExternalStore. */
  listen = (listener: () => void): () => void => {
    try {
      return this.scope.subscribe(listener)
    } catch {
      return () => {}
    }
  }

  /** Bound field arrow so invoking the handle method keeps its receiver. */
  setEnabled = async (enabled: boolean): Promise<DoctorSettingsWrite> => {
    // The form contract answers a refusal or a skipped write with `false` (it
    // recovers with a fresh Host view instead of throwing), so a false answer
    // is a save that did not land and must not read as success.
    try {
      const accepted = await this.scope.set('enabled', enabled)
      return accepted === true ? { ok: true } : { ok: false, error: 'the Host refused the settings write' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
