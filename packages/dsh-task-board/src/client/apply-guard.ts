/**
 * Cross-module-instance apply guard for the task-board client bundle.
 *
 * The client factory can run more than once in a single page lifetime (for
 * example when a stale bundle is mixed with a rebuilt one while `dsh web` is
 * restarted). Without a guard, every factory run mounts its own sidebar entry
 * and board view, so the shell ends up showing two "task board" rows.
 *
 * The flag lives on globalThis so separate module instances (independent
 * factory runs) still share one guard. First claim wins; later claims become
 * no-ops until the page reloads.
 */

declare global {
  // eslint-disable-next-line no-var
  var __dshTaskboardApplied: boolean | undefined
}

/** Claims the plugin apply slot. Returns true when this call won the slot. */
export function claimTaskboardApply(): boolean {
  if (globalThis.__dshTaskboardApplied === true) return false
  globalThis.__dshTaskboardApplied = true
  return true
}
