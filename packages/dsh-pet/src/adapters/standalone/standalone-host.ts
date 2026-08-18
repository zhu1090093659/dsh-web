import type {
  PetPresentationAdapter,
  PetPresentationContext,
  PetPresentationHostView,
} from '../../presentation/controller.ts'

export interface StandalonePetHostOptions {
  launch(origin: string, nativeToken: string): () => void
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
  private disposeProcess: (() => void) | undefined

  constructor(private readonly options: StandalonePetHostOptions) {}

  async start(context: PetPresentationContext): Promise<void> {
    if (this.disposeProcess !== undefined) return
    if (context.bridgeOrigin === undefined || context.nativeToken === undefined) {
      throw new Error('standalone bridge is unavailable')
    }
    this.disposeProcess = this.options.launch(context.bridgeOrigin, context.nativeToken)
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
    this.disposeProcess?.()
    this.disposeProcess = undefined
  }
}
