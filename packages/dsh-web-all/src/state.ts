/**
 * Cross-module shared state for the dsh-web-all host half. The aggregate
 * loads through two entry artifacts in one host process — lib/index.js (the
 * config-less self row) and lib/shells/shell.js (one per family row) — and
 * the bundler splits shared code into a chunk, so each artifact carries its
 * OWN copy of every module. State kept module-locally silently splits: the
 * instance that wins route registration would serve its own (empty) ledger
 * while the other instance records into an unread one, and both would try to
 * register the same routes (2026-09-09 duplicate-route incident). All shell
 * state therefore lives in this globalThis registry keyed by Symbol.for —
 * the same dedup idiom the client half uses for mounted plugins.
 */
import type { DegradedRecord } from './degraded.ts'

export interface ShellSharedState {
  /** Active family rows: real plugin package names in insertion order. */
  activeRows: Set<string>
  /** Degraded family plugins keyed by real plugin package name. */
  degraded: Map<string, DegradedRecord>
  /** Health-route registration, refcounted across ALL shell entries. */
  healthRoutes: { count: number; unregister?: () => void }
}

const KEY = Symbol.for('dsh-web-all.shell-state')

/** The process-wide shared shell state (one instance across module copies). */
export function shellState(): ShellSharedState {
  const registry = globalThis as unknown as Record<symbol, ShellSharedState | undefined>
  return (registry[KEY] ??= {
    activeRows: new Set<string>(),
    degraded: new Map<string, DegradedRecord>(),
    healthRoutes: { count: 0 },
  })
}
