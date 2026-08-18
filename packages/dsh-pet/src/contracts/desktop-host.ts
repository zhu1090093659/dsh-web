/** Stable capability contract implemented by embedded DSH desktop shells. */

import type {} from '@deepseek-ai/cordis'
import type { PetDisposable } from './disposable.ts'
import type { PetRendererKind } from './renderer.ts'

export type { PetDisposable } from './disposable.ts'
export type { PetRendererKind } from './renderer.ts'

export const PET_DESKTOP_HOST_API_VERSION = 1 as const
export const PET_DESKTOP_SCALE_MIN = 1
export const PET_DESKTOP_SCALE_MAX = 2

export interface PetDesktopHostDescriptor {
  apiVersion: typeof PET_DESKTOP_HOST_API_VERSION
  id: string
  name: string
  version?: string
  capabilities: {
    floatingSurface: boolean
    focusMainWindow: boolean
    openRoute: boolean
    contributesTrayAction: boolean
    rendererKinds: readonly PetRendererKind[]
  }
  /** Embedded hosts own their existing tray; dsh-pet must not create another. */
  ownsTray: boolean
}

export type PetHostRoute =
  | { kind: 'home' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'settings'; section?: 'plugins' | 'pet' }

export type PetReturnTarget =
  | { kind: 'web'; id: string; label: string; url: string }
  | {
      kind: 'desktop-host'
      id: string
      label: string
      hostId: string
      route?: PetHostRoute
    }
  | { kind: 'none' }

export interface PetSurfaceBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PetNativeSurfaceState {
  bounds: PetSurfaceBounds
  visible: boolean
  alwaysOnTop: boolean
  returnTarget: PetReturnTarget
}

export interface PetNativeSurfaceDragResult {
  state: PetNativeSurfaceState
  moved: boolean
}

/** Sandboxed preload API implemented by every native Presentation Host. */
export interface PetNativeSurfaceApi {
  readonly apiVersion: typeof PET_DESKTOP_HOST_API_VERSION
  getState(): Promise<PetNativeSurfaceState>
  show(): Promise<PetNativeSurfaceState>
  hide(): Promise<PetNativeSurfaceState>
  setBounds(bounds: PetSurfaceBounds): Promise<PetNativeSurfaceState>
  setAlwaysOnTop(value: boolean): Promise<PetNativeSurfaceState>
  beginDrag(): Promise<PetNativeSurfaceState>
  endDrag(): Promise<PetNativeSurfaceDragResult>
  openReturnTarget(): Promise<void>
  onStateChanged(listener: (state: PetNativeSurfaceState) => void): PetDisposable
}

export interface PetSurfaceRequest {
  surfaceId: string
  content: {
    kind: 'loopback-url'
    url: string
    allowedOrigin: string
  }
  initial: {
    width: number
    height: number
    alwaysOnTop: boolean
    visible: boolean
  }
  auth: {
    token: string
  }
  returnTarget: PetReturnTarget
}

export interface PetSurfaceHandle {
  readonly id: string
  show(): Promise<void>
  hide(): Promise<void>
  focus?(): Promise<void>
  setBounds(bounds: PetSurfaceBounds): Promise<void>
  getBounds(): Promise<PetSurfaceBounds>
  setAlwaysOnTop(value: boolean): Promise<void>
  setIgnoreMouseEvents?(value: boolean): Promise<void>
  close(): Promise<void>
  onClosed(listener: () => void): PetDisposable
}

export interface PetTrayContribution {
  id: string
  label: string
  checked?: boolean
  onInvoke(): void
}

export interface PetDesktopHost {
  readonly descriptor: PetDesktopHostDescriptor
  createPetSurface(request: PetSurfaceRequest): Promise<PetSurfaceHandle>
  focusMainWindow(): Promise<void>
  openRoute?(route: PetHostRoute): Promise<void>
  contributeTrayAction?(action: PetTrayContribution): Promise<PetDisposable>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    petDesktopHost: PetDesktopHost
  }
}
