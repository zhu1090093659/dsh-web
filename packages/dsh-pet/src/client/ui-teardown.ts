/**
 * Cross-bundle-instance teardown slot for the page-global pet root
 * (issue #785).
 *
 * A client bundle swap (HMR rebuilt frame, plugin update, duplicate
 * injection) runs a new apply body while the previous instance's fiber
 * may still be draining. Module state does not survive the swap, so a
 * closure guard only sees one apply body and the previous instance's
 * container keeps sitting on document.body: the page shows two pets
 * until a full refresh. The slot rides globalThis (which does survive)
 * so a re-apply can find the previous instance and unmount its React
 * root cleanly before mounting its own; the previous fiber's later
 * disposal stays a no-op through the idempotent teardowns.
 */

const SLOT = Symbol.for('dsh-pet.client-ui-teardown')

interface TeardownSlot {
  [SLOT]?: (() => void) | undefined
}

/**
 * Claim the page-global pet UI slot with the current instance's teardown
 * (React root unmount + container removal + poll stop).
 * @param teardown - what a later instance runs to take the slot over.
 * @returns a disposer that clears the slot when the current instance's
 * UI is torn down (settings toggle, takeover, or fiber disposal).
 */
export function registerPetUiTeardown(teardown: () => void): () => void {
  const slot = globalThis as TeardownSlot
  slot[SLOT] = teardown
  return () => {
    if (slot[SLOT] === teardown) slot[SLOT] = undefined
  }
}

/**
 * Run the previous instance's teardown if one is registered, so the
 * re-applying instance becomes the sole owner of the page-global pet
 * root. No-op when the previous fiber already tore down cleanly.
 */
export function takeoverPetUiTeardown(): void {
  const slot = globalThis as TeardownSlot
  const teardown = slot[SLOT]
  slot[SLOT] = undefined
  teardown?.()
}
