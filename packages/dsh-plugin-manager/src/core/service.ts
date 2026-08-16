/**
 * Plugin manager orchestration: list the live Loader entries and toggle one
 * entry's enablement. Toggling applies live through the Loader entry update
 * (transactional; a failing candidate rolls back), then persists through
 * the user patch layer; when the live switch fails for a DISABLE intent the
 * intent falls back to the ledger and takes effect on the next boot.
 * Enabling never defers: a plugin that failed to start would fail the whole
 * boot if re-enabled from a ledger.
 * @module @linxin666/dsh-plugin-manager/service
 */

import type { ListResponse, PluginRow, SetEnabledResponse } from '../protocol.ts'
import type { LoaderEntryLike, LoaderLike } from '../loader-types.ts'
import { fiberPhaseOf } from '../loader-types.ts'
import type { PatchFileEditor } from './patch-file.ts'
import type { PluginLedger } from './ledger.ts'

/** One structured failure. */
export interface ManagerError {
  /** Stable machine code the routes map to HTTP statuses. */
  code: string
  /** Human-readable message (English; the UI chrome carries its own copy). */
  message: string
}

/** One operation outcome. */
export type ManagerResult<T> = { ok: true; value: T } | { ok: false; error: ManagerError }

/** Dependencies of the manager service. */
export interface PluginManagerDeps {
  /** The Cordis Loader service. */
  loader: LoaderLike
  /** The manager plugin's own entry id (never toggleable from its own UI). */
  ownEntryId: string
  /** Loader entry ids that must never be toggled. */
  protectedEntryIds: readonly string[]
  /** Module names that must never be toggled (boot glue and HMR). */
  protectedModuleNames: readonly string[]
  /** User patch-layer editor (durable enablement). */
  patch: PatchFileEditor
  /** Fallback ledger (disable intents when the patch layer is unwritable). */
  ledger: PluginLedger
}

/** Whether one entry is protected from toggling. */
export function isProtectedEntry(entry: LoaderEntryLike, deps: PluginManagerDeps): boolean {
  return entry.id === deps.ownEntryId
    || deps.protectedEntryIds.includes(entry.id)
    || deps.protectedModuleNames.includes(entry.options.name)
}

/** The plugin manager service. */
export class PluginManagerService {
  /** @param deps - injected host edges (readonly: the host replay reads the ledger). */
  constructor(readonly deps: PluginManagerDeps) {}

  /**
   * List the loaded plugin entries in Loader order.
   * @returns the decorated rows.
   */
  list(): ManagerResult<ListResponse> {
    const entries: PluginRow[] = []
    for (const entry of this.deps.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: entry.id,
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: fiberPhaseOf(entry.fiber?.state),
        protected: isProtectedEntry(entry, this.deps),
        official: entry.options.name.startsWith('@deepseek-ai/'),
      })
    }
    return { ok: true, value: { entries } }
  }

  /**
   * Enable or disable one plugin entry.
   * @param entryId - the loader entry id.
   * @param enabled - true enables, false disables.
   * @returns the switch outcome (applied / persisted / deferred).
   */
  async setEnabled(
    entryId: string,
    enabled: boolean,
  ): Promise<ManagerResult<SetEnabledResponse>> {
    const entry = this.findEntry(entryId)
    if (entry === undefined) {
      return { ok: false, error: { code: 'unknown-entry', message: `plugin entry "${entryId}" is not loaded` } }
    }
    if (entry.options.group) {
      return { ok: false, error: { code: 'not-toggleable', message: 'group entries cannot be toggled' } }
    }
    if (isProtectedEntry(entry, this.deps)) {
      return { ok: false, error: { code: 'protected', message: `plugin entry "${entryId}" is protected and cannot be toggled` } }
    }

    const targetDisabled = !enabled
    let applied = true
    try {
      await entry.update({ disabled: targetDisabled })
    } catch {
      applied = false
    }

    if (applied) {
      let persisted = true
      try {
        await this.deps.patch.setEnabled(entryId, enabled)
      } catch {
        persisted = false
      }
      if (!persisted && targetDisabled) {
        try {
          await this.deps.ledger.set(entryId, true)
          persisted = true
        } catch {
          persisted = false
        }
      }
      return { ok: true, value: { entryId, enabled, applied: true, persisted, deferred: false } }
    }

    // Live switch failed. Only a disable intent may defer to the next boot:
    // re-enabling a plugin that failed to start would fail the whole boot.
    if (!targetDisabled) {
      return {
        ok: false,
        error: {
          code: 'toggle-failed',
          message: `enabling "${entryId}" failed: the plugin did not start (no restart fallback for enables)`,
        },
      }
    }
    let persisted = true
    try {
      await this.deps.patch.setEnabled(entryId, false)
    } catch {
      persisted = false
    }
    if (!persisted) {
      try {
        await this.deps.ledger.set(entryId, true)
        persisted = true
      } catch {
        persisted = false
      }
    }
    if (!persisted) {
      return {
        ok: false,
        error: { code: 'toggle-failed', message: `disabling "${entryId}" failed and could not be persisted` },
      }
    }
    return { ok: true, value: { entryId, enabled: false, applied: false, persisted: true, deferred: true } }
  }

  /** Find one entry by id. */
  private findEntry(entryId: string): LoaderEntryLike | undefined {
    for (const entry of this.deps.loader.entries()) {
      if (entry.id === entryId) return entry
    }
    return undefined
  }
}