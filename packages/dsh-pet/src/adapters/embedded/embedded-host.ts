import type {
  PetDesktopHost,
  PetSurfaceHandle,
  PetSurfaceRequest,
} from '../../contracts/desktop-host.ts'
import { PET_DESKTOP_HOST_API_VERSION } from '../../contracts/desktop-host.ts'
import type {
  PetPresentationAdapter,
  PetPresentationContext,
  PetPresentationHostView,
} from '../../presentation/controller.ts'

export interface EmbeddedPetHostOptions {
  host: PetDesktopHost
  surfaceRequest(context: PetPresentationContext): PetSurfaceRequest
}

/** Adapts a capability-only embedded host without exposing raw Electron objects. */
export class EmbeddedPetHost implements PetPresentationAdapter {
  readonly kind = 'embedded' as const
  readonly host: PetPresentationHostView
  private surface: PetSurfaceHandle | undefined
  private disposeClosed: (() => void | Promise<void>) | undefined
  private disposeTray: (() => void | Promise<void>) | undefined

  constructor(private readonly options: EmbeddedPetHostOptions) {
    this.host = {
      id: options.host.descriptor.id,
      name: options.host.descriptor.name,
      embedded: true,
      ownsTray: options.host.descriptor.ownsTray,
    }
  }

  async start(context: PetPresentationContext): Promise<void> {
    if (this.surface !== undefined) return
    if (this.options.host.descriptor.apiVersion !== PET_DESKTOP_HOST_API_VERSION) {
      throw new Error('embedded host API version is incompatible')
    }
    if (!this.options.host.descriptor.capabilities.floatingSurface) {
      throw new Error('embedded host has no floating surface capability')
    }
    const surface = await this.options.host.createPetSurface(this.options.surfaceRequest(context))
    this.surface = surface
    const closed = surface.onClosed(() => {
      if (this.surface === surface) this.surface = undefined
    })
    this.disposeClosed = () => closed.dispose()
    if (this.options.host.descriptor.capabilities.contributesTrayAction
      && this.options.host.contributeTrayAction !== undefined) {
      const tray = await this.options.host.contributeTrayAction({
        id: 'dsh-pet:show',
        label: '显示桌宠',
        onInvoke: () => { void surface.show().catch(() => undefined) },
      })
      this.disposeTray = () => tray.dispose()
    }
  }

  async show(): Promise<void> {
    await this.surface?.show()
  }

  async hide(): Promise<void> {
    await this.surface?.hide()
  }

  update(_snapshot: unknown): void {
    // The embedded renderer consumes the same native bridge as Standalone.
  }

  async stop(_reason?: string): Promise<void> {
    const surface = this.surface
    this.surface = undefined
    const disposeClosed = this.disposeClosed
    this.disposeClosed = undefined
    const disposeTray = this.disposeTray
    this.disposeTray = undefined
    try {
      await disposeTray?.()
    } finally {
      try {
        await disposeClosed?.()
      } finally {
        await surface?.close()
      }
    }
  }
}
