/**
 * Cross-module-instance apply guard for the pet client bundle.
 *
 * A stale client factory can overlap a rebuilt one while DSH swaps the
 * browser bundle.
 * Both factories otherwise append their own global React root to body, so
 * the page shows multiple pets until a full refresh clears the orphaned DOM.
 * The global claim lets the first live fiber win across module instances;
 * its lifecycle cleanup releases the slot for a later clean re-apply.
 */

declare global {
  // eslint-disable-next-line no-var
  var __dshPetClientApplied: boolean | undefined
}

/** Claim the page-global pet client slot. */
export function claimPetClientApply(): boolean {
  if (globalThis.__dshPetClientApplied === true) return false
  globalThis.__dshPetClientApplied = true
  return true
}

/** Release the claim when the owning client fiber is disposed. */
export function releasePetClientApply(): void {
  globalThis.__dshPetClientApplied = undefined
}
