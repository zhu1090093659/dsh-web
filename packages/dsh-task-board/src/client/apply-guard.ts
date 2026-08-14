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
 * no-ops until the claim is released (fiber unload / hot-reload) or the page
 * reloads.
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

/**
 * Releases the claim. Called from the client fiber cleanup so that a
 * hot-reloaded bundle (the loader unloads the old plugin fiber and invokes
 * the rebuilt one in the same page) can claim again instead of being
 * silently dropped.
 */
export function releaseTaskboardApply(): void {
  globalThis.__dshTaskboardApplied = undefined
}
