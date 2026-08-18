import { copyFile, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'

import type { PetModelDescriptor, PetModelSourceKind } from '../contracts/model.ts'
import { dshHome } from '../dsh-home.ts'
import { modelDescriptorToManifest } from './descriptor.ts'
import { PET_MODEL_MANIFEST_NAME, readPetModelPackage, type PetModelPackage } from './manifest.ts'

export interface PetModelRecord {
  descriptor: PetModelDescriptor
  directory: string
  entryPath: string
}

export interface PetModelStoreOptions {
  root?: string
  /** Optional shared PetDex directory scanned directly by the Web registry. */
  importedRoot?: string
  compatibilityLocalRoots?: readonly string[]
}

export function petModelRoot(home: string = dshHome()): string {
  return join(home, 'pet', 'models')
}

function runtimeDescriptor(
  model: PetModelPackage,
  source: Exclude<PetModelSourceKind, 'builtin' | 'extension'>,
): PetModelDescriptor {
  return {
    ...structuredClone(model.manifest),
    id: `${source}:${model.manifest.id}`,
    source: { kind: source },
  }
}

export class PetModelStore {
  readonly root: string
  readonly localRoot: string
  readonly importedRoot: string
  readonly #compatibilityLocalRoots: readonly string[]

  constructor(options: PetModelStoreOptions = {}) {
    this.root = options.root ?? petModelRoot()
    this.localRoot = join(this.root, 'local')
    this.importedRoot = options.importedRoot ?? join(this.root, 'imported')
    this.#compatibilityLocalRoots = options.compatibilityLocalRoots ?? []
  }

  async records(): Promise<PetModelRecord[]> {
    const localGroups = await Promise.all([
      this.localRoot,
      ...this.#compatibilityLocalRoots,
    ].map(root => this.#readRoot(root, 'local')))
    const imported = await this.#readRoot(this.importedRoot, 'imported')
    const unique = new Map<string, PetModelRecord>()
    for (const record of [...localGroups.flat(), ...imported]) {
      if (!unique.has(record.descriptor.id)) unique.set(record.descriptor.id, record)
    }
    return [...unique.values()].sort((left, right) =>
      left.descriptor.displayName.localeCompare(right.descriptor.displayName))
  }

  async record(modelId: string): Promise<PetModelRecord | undefined> {
    return (await this.records()).find(record => record.descriptor.id === modelId)
  }

  async importDirectory(sourceDirectory: string): Promise<PetModelRecord> {
    const source = await readPetModelPackage(sourceDirectory)
    await mkdir(this.importedRoot, { recursive: true })
    const id = await this.#availableImportedId(source.manifest.id)
    return this.#install(source, id)
  }

  /** Copy old Electron userData models once; the legacy directory is never deleted. */
  async migrateLegacyImportedRoot(legacyRoot: string): Promise<number> {
    let entries
    try {
      entries = await readdir(legacyRoot, { withFileTypes: true })
    } catch {
      return 0
    }
    await mkdir(this.importedRoot, { recursive: true })
    let migrated = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const destination = join(this.importedRoot, entry.name)
      try {
        await readdir(destination)
        continue
      } catch {
        // A missing destination is eligible for one-way copy migration.
      }
      try {
        const source = await readPetModelPackage(join(legacyRoot, entry.name))
        await this.#install(source, entry.name)
        migrated += 1
      } catch {
        // One malformed legacy model must not prevent the remaining migration.
      }
    }
    return migrated
  }

  async remove(modelId: string): Promise<void> {
    if (!modelId.startsWith('imported:')) throw new Error('only imported models can be removed')
    const record = await this.record(modelId)
    if (record === undefined) return
    const canonicalImportedRoot = await realpath(this.importedRoot)
    const relation = relative(canonicalImportedRoot, record.directory)
    if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) throw new Error('unsafe imported model path')
    await rm(record.directory, { recursive: true, force: true })
  }

  async #readRoot(
    root: string,
    source: Exclude<PetModelSourceKind, 'builtin' | 'extension'>,
  ): Promise<PetModelRecord[]> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }
    const records = await Promise.all(entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async entry => {
        try {
          const model = await readPetModelPackage(join(root, entry.name))
          return {
            descriptor: runtimeDescriptor(model, source),
            directory: model.directory,
            entryPath: model.entryPath,
          }
        } catch {
          return undefined
        }
      }))
    return records.filter((record): record is PetModelRecord => record !== undefined)
  }

  async #install(source: PetModelPackage, id: string): Promise<PetModelRecord> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('无法分配安全的模型 id')
    const destination = join(this.importedRoot, id)
    const temporary = join(this.importedRoot, `.${id}.import-${process.pid}-${Date.now()}`)
    const extension = extname(source.entryPath).toLowerCase()
    const entryName = source.manifest.rendererId === 'builtin:sprite2d'
      ? `spritesheet${extension}`
      : `model${extension}`
    const descriptor = runtimeDescriptor(source, 'imported')
    const manifest = modelDescriptorToManifest({
      ...descriptor,
      id: `imported:${id}`,
      entry: entryName,
    }, id)
    try {
      await mkdir(temporary)
      await copyFile(source.entryPath, join(temporary, entryName))
      await writeFile(join(temporary, PET_MODEL_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      // Keep a PetDex view beside the renderer-neutral manifest. The Web pet
      // registry understands this file, so a desktop import becomes available
      // to both presentations after the documented DSH restart.
      await writeFile(join(temporary, 'pet.json'), `${JSON.stringify({
        id,
        displayName: descriptor.displayName,
        ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
        spritesheetPath: entryName,
        ...(descriptor.format === 'petdex-v2' ? { spriteVersionNumber: 2 } : {}),
      }, null, 2)}\n`, 'utf8')
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      throw error
    }
    const installed = await readPetModelPackage(destination)
    return {
      descriptor: runtimeDescriptor(installed, 'imported'),
      directory: installed.directory,
      entryPath: installed.entryPath,
    }
  }

  async #availableImportedId(base: string): Promise<string> {
    let existing = new Set<string>()
    try {
      existing = new Set((await readdir(this.importedRoot, { withFileTypes: true }))
        .map(entry => entry.name))
    } catch {
      // The import root is created immediately before this check.
    }
    if (!existing.has(base)) return base
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}-${suffix}`
      if (!existing.has(candidate)) return candidate
    }
    throw new Error(`无法为 ${basename(base)} 分配本地模型 id`)
  }
}
