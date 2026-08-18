import type { PetModelDescriptor } from '../contracts/model.ts'
import { BUILTIN_SPRITE_MODEL_FORMATS, BUILTIN_WHALE_MODEL } from './builtin-whale.ts'
import { PetModelStore, type PetModelStoreOptions } from './store.ts'

export interface PetModelCatalogOptions extends PetModelStoreOptions {
  store?: PetModelStore
}

export function resolvePetModelSelection(
  rendererId: string,
  modelId: string,
  models: readonly Pick<PetModelDescriptor, 'id' | 'rendererId' | 'format'>[],
): string {
  const selected = models.find(model => model.id === modelId)
  return selected?.rendererId === rendererId
    && (rendererId !== 'builtin:sprite2d' || BUILTIN_SPRITE_MODEL_FORMATS.some(format => format === selected.format))
    ? selected.id
    : BUILTIN_WHALE_MODEL.id
}

export class PetModelCatalog {
  readonly #store: PetModelStore

  constructor(options: PetModelCatalogOptions = {}) {
    this.#store = options.store ?? new PetModelStore(options)
  }

  async list(): Promise<PetModelDescriptor[]> {
    return [structuredClone(BUILTIN_WHALE_MODEL), ...(await this.#store.records()).map(record => structuredClone(record.descriptor))]
  }

  async get(modelId: string): Promise<PetModelDescriptor | undefined> {
    if (modelId === BUILTIN_WHALE_MODEL.id) return structuredClone(BUILTIN_WHALE_MODEL)
    const record = await this.#store.record(modelId)
    return record === undefined ? undefined : structuredClone(record.descriptor)
  }

  async importDirectory(path: string): Promise<PetModelDescriptor> {
    return structuredClone((await this.#store.importDirectory(path)).descriptor)
  }

  remove(modelId: string): Promise<void> {
    return this.#store.remove(modelId)
  }

  migrateLegacyImportedRoot(path: string): Promise<number> {
    return this.#store.migrateLegacyImportedRoot(path)
  }

  async assetPath(modelId: string, path: string): Promise<string | undefined> {
    const record = await this.#store.record(modelId)
    return record?.descriptor.entry === path ? record.entryPath : undefined
  }

  async supports(rendererId: string, modelId: string, formats: readonly string[]): Promise<boolean> {
    const model = await this.get(modelId)
    return model !== undefined && model.rendererId === rendererId && formats.includes(model.format)
  }
}
