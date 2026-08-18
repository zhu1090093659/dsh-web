import type { PetPresentationAdapter, PetPresentationContext } from './controller.ts'

/** No-op adapter used by headless, disabled, CI, and configured-none modes. */
export class NullPresentation implements PetPresentationAdapter {
  readonly kind = 'none' as const

  async start(_context: PetPresentationContext): Promise<void> {}
  async show(): Promise<void> {}
  async hide(): Promise<void> {}
  update(_snapshot: unknown): void {}
  async stop(_reason?: string): Promise<void> {}
}
