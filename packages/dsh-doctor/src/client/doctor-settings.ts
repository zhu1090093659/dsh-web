/**
 * Settings-namespace facade for the doctor enable switch.
 *
 * Wraps the bound SettingsScope in a never-throwing view: a missing namespace,
 * a memory-mode scope or a hostile scope degrades to an 'unavailable' state
 * instead of breaking the console. The facade also routes a failed write back
 * as a result value instead of a rejection.
 * @module @linxin666/dsh-doctor/client
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
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

/** Never-throwing facade over the bound settings scope. */
export interface DoctorSettingsHandle {
  /** Read the current derived state (never throws). */
  getState(): DoctorSettingsState
  /** Subscribe to scope snapshot replacements (never throws). */
  listen(listener: () => void): () => void
  /** Persist the enabled flag (never rejects). */
  setEnabled(enabled: boolean): Promise<DoctorSettingsWrite>
}

/** Build a handle, or null when no scope is available (host half absent). */
export function createDoctorSettingsHandle(scope: SettingsScope<DoctorSettings> | undefined | null): DoctorSettingsHandle | null {
  if (scope === undefined || scope === null) return null
  return new ScopedDoctorSettingsHandle(scope)
}

const UNAVAILABLE_STATE: DoctorSettingsState = { status: 'unavailable', enabled: undefined, writable: false }

class ScopedDoctorSettingsHandle implements DoctorSettingsHandle {
  private readonly scope: SettingsScope<DoctorSettings>
  /** Derived state is cached against the scope's stable snapshot reference so
   * useSyncExternalStore always receives a cached identity between changes. */
  private lastSnapshot: unknown
  private cached: DoctorSettingsState = UNAVAILABLE_STATE

  constructor(scope: SettingsScope<DoctorSettings>) {
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
    try {
      await this.scope.set('enabled', enabled)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
