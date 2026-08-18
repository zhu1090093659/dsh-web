import type {
  PetPresentationAdapter,
  PetPresentationContext,
  PetPresentationHostView,
} from '../../presentation/controller.ts'
import type { StandaloneRuntimeLaunchHandle } from './launcher.ts'

export interface StandalonePetHostOptions {
  launch(origin: string, nativeToken: string): StandaloneRuntimeLaunchHandle
}

/** Controller adapter around the current managed standalone Electron runtime. */
export class StandalonePetHost implements PetPresentationAdapter {
  readonly kind = 'standalone' as const
  readonly host: PetPresentationHostView = {
    id: 'standalone',
    name: 'Standalone dsh-pet',
    embedded: false,
    ownsTray: true,
  }
  private launchHandle: StandaloneRuntimeLaunchHandle | undefined

  constructor(private readonly options: StandalonePetHostOptions) {}

  async start(context: PetPresentationContext): Promise<void> {
    if (this.launchHandle !== undefined) return
    if (context.bridgeOrigin === undefined || context.nativeToken === undefined) {
      throw new Error('standalone bridge is unavailable')
    }
    const handle = this.options.launch(context.bridgeOrigin, context.nativeToken)
    this.launchHandle = handle
    try {
      await handle.ready
    } catch (error) {
      if (this.launchHandle === handle) this.launchHandle = undefined
      handle.dispose()
      throw error
    }
  }

  async show(): Promise<void> {
    // Visibility is mirrored through Host settings and the native state stream.
  }

  async hide(): Promise<void> {
    // Visibility is mirrored through Host settings and the native state stream.
  }

  update(_snapshot: unknown): void {
    // Standalone consumes the authenticated SSE stream directly.
  }

  async stop(_reason?: string): Promise<void> {
    this.launchHandle?.dispose()
    this.launchHandle = undefined
  }
}
