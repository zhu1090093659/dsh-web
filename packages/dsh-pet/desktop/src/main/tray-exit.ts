/** Disable the Host-owned desktop presentation before ending the companion. */
export async function disableDesktopPetAndQuit(
  disableDesktopPet: () => Promise<unknown>,
  quit: () => void,
): Promise<boolean> {
  try {
    await disableDesktopPet()
    quit()
    return true
  } catch {
    return false
  }
}
