import type { PetNativeSurfaceApi } from '../../../src/contracts/desktop-host.ts'
import type { DesktopApi } from '../shared/desktop-api.ts'

declare global {
  interface Window {
    petDesktop: DesktopApi
    petSurface?: PetNativeSurfaceApi
  }
}

export {}
