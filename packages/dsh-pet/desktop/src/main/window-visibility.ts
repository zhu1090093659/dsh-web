interface PetWindowVisibility {
  isVisible(): boolean
  show(): void
  showInactive(): void
}

/** Prefer a non-activating show, with the supported Linux fallback. */
export function showPetWindow(
  window: PetWindowVisibility,
  platform: NodeJS.Platform = process.platform,
): void {
  window.showInactive()
  if (platform === 'linux' && !window.isVisible()) window.show()
}
