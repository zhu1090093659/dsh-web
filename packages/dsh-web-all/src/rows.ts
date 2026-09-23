/**
 * Active-row ledger for the dsh-web-all fault-isolation shell. Each family
 * patch row runs one shell apply carrying the real plugin package name in
 * `config.plugin`; the shell records that name here when the row applies and
 * removes it when the entry disposes. The browser half reads the ledger
 * through GET /api/dsh-web-all/rows to gate which folded client children
 * mount: a row the loader never started (disabled by a user patch override)
 * has no shell apply, so its settings tabs and surfaces stay off the page
 * instead of rendering an entry that errors on click (#1372).
 *
 * Recording happens at apply start, not after the real plugin starts: a row
 * whose plugin degraded (import/start failure captured by the shell) is still
 * an ACTIVE row and keeps its UI entry — the degraded state is the honest
 * signal the user must see. Only a row the loader never applied (disabled)
 * drops out of the ledger.
 *
 * The ledger lives in the process-wide shared state (src/state.ts): the shell
 * loads through two entry artifacts whose bundler chunk split would otherwise
 * give each its own copy.
 */
import { shellState } from './state.ts'

/** Mark one family row active (its shell entry applied). */
export function recordActiveRow(plugin: string): void {
  shellState().activeRows.add(plugin)
}

/** Mark one family row inactive (its shell entry disposed). */
export function removeActiveRow(plugin: string): void {
  shellState().activeRows.delete(plugin)
}

/** Snapshot of the active real-plugin package names, in insertion order. */
export function listActiveRows(): string[] {
  return [...shellState().activeRows]
}

/** For test teardown and test isolation only. */
export function _resetActiveRowsForTest(): void {
  shellState().activeRows.clear()
}
