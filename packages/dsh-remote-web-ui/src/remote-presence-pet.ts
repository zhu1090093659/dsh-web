/**
 * Remote-presence to pet-visibility link (user requirement): while at least
 * one paired device is online (an active phone mirror session), the
 * host-global pet is hidden through the pet's OWN hide switch (the
 * PetService.setVisible RPC, the same one the pet's hide button uses);
 * once the last device stays offline past a grace window, the pet is
 * restored. The pet plugin is optional: without it (or on any pet failure)
 * the link is a no-op - the remote-control feature never depends on the
 * pet being installed.
 *
 * The visibility is host-global by design (the pet is host-global, no
 * session dimension): the desktop and the phone share one pet, so the link
 * hides it while the operator is away on a phone mirror and restores it
 * when the mirror ends. A manual user hide is respected: if the pet is
 * already hidden when the first device comes online, nothing is recorded
 * and nothing is restored later.
 */

/** The pet service seam the link needs (structural slice, no package edge). */
export interface PresencePetSeam {
  /** RPC: show or hide the pet. */
  setVisible(visible: boolean): Promise<unknown>
  /** Read the current display state (the visibility the user sees). */
  state(): Promise<{ display?: { visible?: boolean } }>
}

/** Dependencies of the presence link (all injectable for tests). */
export interface PresencePetDeps {
  /** Subscribe to pairing snapshot changes (fires with every state change). */
  onState(listener: (snapshot: { phase: string; onlineCount: number }) => void): () => void
  /** Resolve the pet service seam (undefined when the pet plugin is absent). */
  pet(): PresencePetSeam | undefined
  /** Grace before restoring the pet after the last device went offline. */
  restoreAfterMs?: number
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown
    clearTimeout(t: unknown): void
  }
}

/** Default restore grace: the presence sweep flips a device offline after
 * ~25 s, and a phone that was briefly backgrounded should not flicker the
 * pet; 2 minutes keeps the restore stable. */
const DEFAULT_RESTORE_AFTER_MS = 120_000

const nodeTimers = { setTimeout, clearTimeout }

/**
 * Start the presence link. Returns the disposer (withdraws the state
 * subscription and cancels a pending restore).
 * @param deps - pairing stream + pet seam (+ test seams).
 */
export function startRemotePresencePet(deps: PresencePetDeps): () => void {
  const restoreAfterMs = deps.restoreAfterMs ?? DEFAULT_RESTORE_AFTER_MS
  const timers = deps.timers ?? nodeTimers
  let previousOnline = false
  let hiddenByRemote = false
  let restoreTimer: unknown | undefined
  let disposed = false

  const clearRestore = (): void => {
    if (restoreTimer !== undefined) {
      timers.clearTimeout(restoreTimer)
      restoreTimer = undefined
    }
  }

  const scheduleRestore = (): void => {
    clearRestore()
    restoreTimer = timers.setTimeout(() => {
      restoreTimer = undefined
      restoreAfterTick()
    }, restoreAfterMs)
  }

  const restoreAfterTick = (): void => {
    if (disposed || !hiddenByRemote) return
    const pet = deps.pet()
    if (pet === undefined) return
    hiddenByRemote = false
    void pet.setVisible(true).catch(() => {
      // The pet bridge failed (e.g. the pet host was mid-reload): the pet
      // stays whatever it is; the next connect/disconnect cycle re-evaluates.
    })
  }

  const hideForRemote = (): void => {
    if (hiddenByRemote) return
    const pet = deps.pet()
    if (pet === undefined) return
    void pet.state().then(
      (value) => {
        if (disposed || hiddenByRemote) return
        const visible = value.display?.visible
        if (visible !== true) return
        hiddenByRemote = true
        return pet.setVisible(false).catch(() => {
          // Hide failed: leave the flag unset so a later transition retries.
          hiddenByRemote = false
        })
      },
      () => {
        // The state read failed; do not record a hide we never performed.
      },
    )
  }

  const handle = (snapshot: { phase: string; onlineCount: number }): void => {
    const online = snapshot.phase === 'connected' && snapshot.onlineCount > 0
    if (online && !previousOnline) {
      cancelRestoreAndClear()
      hideForRemote()
    } else if (!online && previousOnline) {
      scheduleRestore()
    }
    previousOnline = online
  }

  const cancelRestoreAndClear = (): void => {
    clearRestore()
  }

  const unsubscribe = deps.onState(handle)
  return () => {
    disposed = true
    unsubscribe()
    clearRestore()
  }
}
