/** Minimal lifecycle handle shared by public contracts. */
export interface PetDisposable {
  dispose(): void | Promise<void>
}
