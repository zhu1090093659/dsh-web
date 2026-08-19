export type DesktopPetExitResult = 'quitting' | 'cancelled' | 'disable-failed'

/** Disable the Host-owned desktop presentation before ending the companion. */
export async function disableDesktopPetAndQuit(
  disableDesktopPet: () => Promise<unknown>,
  quit: () => boolean | Promise<boolean>,
): Promise<DesktopPetExitResult> {
  try {
    await disableDesktopPet()
    return await quit() ? 'quitting' : 'cancelled'
  } catch {
    return 'disable-failed'
  }
}
