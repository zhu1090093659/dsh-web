/**
 * Structural typing for the Cordis Loader service the host half drives.
 *
 * The dsh host composition always mounts `ctx.loader` (@deepseek-ai/
 * cordis-plugin-loader), but the published SDK does not ship its types, so
 * the plugin declares the service locally with the minimal face it uses —
 * the same local-augmentation precedent as the webUiSettings binder.
 * FiberState is a cross-package const enum, mirrored here by value.
 * @module @linxin666/dsh-plugin-manager/loader-types
 */

import type { Context } from '@deepseek-ai/cordis'

/** Projected Cordis fiber phase of one loader entry. */
export type LoaderFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** The Loader entry slice the manager reads and updates. */
export interface LoaderEntryLike {
  /** Stable entry id from the composition row. */
  id: string
  /** Effective enablement (expression rows evaluate to a boolean). */
  disabled: boolean
  /** The composition row options. */
  options: {
    /** The module name the row mounts. */
    name: string
    /** Whether the entry is a group row (never toggleable). */
    group?: boolean
  }
  /** The live fiber of an enabled entry. */
  fiber?: { state: number }
  /**
   * Transactionally replace entry options; a failing candidate rolls back.
   * @param options - the options to change.
   */
  update(options: { disabled?: boolean }): Promise<unknown>
}

/** The Cordis Loader service face. */
export interface LoaderLike {
  /** Iterate the current loader entries in composition order. */
  entries(): Iterable<LoaderEntryLike>
  /** Settle once every pending fiber finished loading. */
  await(): Promise<unknown>
}

/** FiberState value mirrors, aligned with cordis-plugin-loader's const enum. */
export const FIBER_PHASE: Record<number, Exclude<LoaderFiberPhase, null>> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  5: 'unloading',
}

/**
 * Project a fiber state value to its wire phase.
 * @param state - the fiber state number (undefined when no fiber exists).
 * @returns the phase, or null for disposed/absent fibers.
 */
export function fiberPhaseOf(state: number | undefined): LoaderFiberPhase {
  if (state === undefined) return null
  return FIBER_PHASE[state] ?? null
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Cordis Loader service (typed structurally; not shipped by the SDK). */
    loader: LoaderLike
  }
}
