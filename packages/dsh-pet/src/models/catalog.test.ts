import { mkdir, mkdtemp, readFile, readdir, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { FilePetAssetResolver } from './file-asset-resolver.ts'
import { PetModelCatalog, resolvePetModelSelection } from './catalog.ts'
import { modelDescriptorToManifest, petDexToModelDescriptor } from './descriptor.ts'

function losslessWebpHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  buffer.write('VP8L', 12, 'ascii')
  buffer[20] = 0x2f
  buffer.writeUInt32LE((((height - 1) << 14) | (width - 1)) >>> 0, 21)
  return buffer
}

async function writePetDex(directory: string, id = 'boba', version: 1 | 2 = 1): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'pet.json'), JSON.stringify({
    id,
    displayName: 'Boba',
    description: 'A test pet.',
    spritesheetPath: 'spritesheet.webp',
    ...(version === 1 ? {} : { spriteVersionNumber: 2 }),
  }), 'utf8')
  await writeFile(join(directory, 'spritesheet.webp'), losslessWebpHeader(1536, version === 1 ? 1872 : 2288))
}

describe('PetModelCatalog', () => {
  it('normalizes PetDex imports into declarative manifests and copies no code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-model-'))
    const source = join(root, 'source')
    const managed = join(root, 'managed')
    await writePetDex(source)
    await writeFile(join(source, 'untrusted.js'), 'throw new Error("never execute")', 'utf8')
    const catalog = new PetModelCatalog({ root: managed })

    const first = await catalog.importDirectory(source)
    const second = await catalog.importDirectory(source)

    expect(first.id).toBe('imported:boba')
    expect(second.id).toBe('imported:boba-2')
    expect(JSON.parse(await readFile(join(managed, 'imported', 'boba', 'pet-model.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      id: 'boba',
      rendererId: 'builtin:sprite2d',
      format: 'petdex-v1',
      entry: 'spritesheet.webp',
    })
    expect(JSON.parse(await readFile(join(managed, 'imported', 'boba', 'pet.json'), 'utf8'))).toMatchObject({
      id: 'boba',
      displayName: 'Boba',
      spritesheetPath: 'spritesheet.webp',
    })
    await expect(readFile(join(managed, 'imported', 'boba', 'untrusted.js'))).rejects.toThrow()

    const resolver = new FilePetAssetResolver(catalog)
    const bytes = await resolver.fetch({ modelId: first.id, path: first.entry })
    expect(bytes.byteLength).toBe(32)
  })

  it('copies the old userData directory idempotently without deleting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-migrate-'))
    const legacy = join(root, 'pixel-models')
    await writePetDex(join(legacy, 'boba'))
    const catalog = new PetModelCatalog({ root: join(root, 'dsh-home-models') })

    await expect(catalog.migrateLegacyImportedRoot(legacy)).resolves.toBe(1)
    await expect(catalog.migrateLegacyImportedRoot(legacy)).resolves.toBe(0)
    expect((await catalog.list()).map(model => model.id)).toContain('imported:boba')
    await expect(readFile(join(legacy, 'boba', 'pet.json'), 'utf8')).resolves.toContain('boba')
  })

  it('imports a real PetDex V2 package and preserves its renderer format', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-v2-'))
    const source = join(root, 'source')
    await writePetDex(source, 'v2-model', 2)
    const catalog = new PetModelCatalog({ root: join(root, 'managed') })

    await expect(catalog.importDirectory(source)).resolves.toMatchObject({
      id: 'imported:v2-model',
      format: 'petdex-v2',
    })
  })

  it('rejects oversized manifests and textures before copying model data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-limits-'))
    const catalog = new PetModelCatalog({ root: join(root, 'managed') })
    const hugeManifest = join(root, 'huge-manifest')
    await mkdir(hugeManifest)
    await writeFile(join(hugeManifest, 'pet.json'), Buffer.alloc(64 * 1024 + 1, 0x20))
    await writeFile(join(hugeManifest, 'spritesheet.webp'), losslessWebpHeader(1536, 1872))
    await expect(catalog.importDirectory(hugeManifest)).rejects.toThrow('大小无效')

    const hugeTexture = join(root, 'huge-texture')
    await writePetDex(hugeTexture, 'huge-texture')
    await truncate(join(hugeTexture, 'spritesheet.webp'), 32 * 1024 * 1024 + 1)
    await expect(catalog.importDirectory(hugeTexture)).rejects.toThrow('模型纹理大小无效')
    await expect(readdir(join(root, 'managed', 'imported'))).rejects.toThrow()
  })

  it('rejects a texture symlink that escapes the model directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-symlink-'))
    const source = join(root, 'source')
    const external = join(root, 'outside')
    await mkdir(source)
    await mkdir(external)
    await writeFile(join(external, 'spritesheet.webp'), losslessWebpHeader(1536, 1872))
    const descriptor = petDexToModelDescriptor({
      id: 'escape', displayName: 'Escape', description: '',
      spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 1,
    })
    await writeFile(join(source, 'pet-model.json'), JSON.stringify({
      ...modelDescriptorToManifest(descriptor, 'escape'),
      entry: 'assets/spritesheet.webp',
    }))
    await symlink(external, join(source, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
    const catalog = new PetModelCatalog({ root: join(root, 'managed') })

    await expect(catalog.importDirectory(source)).rejects.toThrow('模型资产不能位于模型目录之外')
  })

  it('does not overwrite a colliding non-directory destination during atomic import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-atomic-'))
    const source = join(root, 'source')
    const managed = join(root, 'managed')
    await writePetDex(source)
    await mkdir(join(managed, 'imported'), { recursive: true })
    await writeFile(join(managed, 'imported', 'boba'), 'occupied', 'utf8')
    const catalog = new PetModelCatalog({ root: managed })

    await expect(catalog.importDirectory(source)).resolves.toMatchObject({ id: 'imported:boba-2' })
    expect(await readFile(join(managed, 'imported', 'boba'), 'utf8')).toBe('occupied')
    expect((await readdir(join(managed, 'imported'))).filter(name => name.startsWith('.boba-2.import-'))).toEqual([])
  })

  it('removes only a managed import and lets runtime selection fall back without deleting the preference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-remove-'))
    const source = join(root, 'source')
    await writePetDex(source)
    const catalog = new PetModelCatalog({ root: join(root, 'managed') })
    const imported = await catalog.importDirectory(source)

    await catalog.remove(imported.id)
    const models = await catalog.list()
    expect(models.map(model => model.id)).not.toContain(imported.id)
    expect(resolvePetModelSelection('builtin:sprite2d', imported.id, models)).toBe('builtin:whale')
    await expect(catalog.remove('local:boba')).rejects.toThrow('only imported models')
  })

  it('removes an import when the configured model root resolves through a filesystem alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pet-remove-alias-'))
    const source = join(root, 'source')
    const actualRoot = join(root, 'actual')
    const aliasRoot = join(root, 'alias')
    await writePetDex(source)
    await mkdir(actualRoot)
    await symlink(actualRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
    const catalog = new PetModelCatalog({ root: join(aliasRoot, 'managed') })
    const imported = await catalog.importDirectory(source)

    await catalog.remove(imported.id)

    expect((await catalog.list()).map(model => model.id)).not.toContain(imported.id)
  })

  it('keeps missing or renderer-incompatible preferences but resolves the whale at runtime', async () => {
    const catalog = new PetModelCatalog({ root: await mkdtemp(join(tmpdir(), 'dsh-pet-empty-')) })
    const models = await catalog.list()

    expect(resolvePetModelSelection('builtin:sprite2d', 'local:removed', models)).toBe('builtin:whale')
    expect(resolvePetModelSelection('extension:live2d', 'builtin:whale', models)).toBe('builtin:whale')
    await expect(catalog.supports('builtin:sprite2d', 'builtin:whale', ['petdex-v1'])).resolves.toBe(true)
    await expect(catalog.supports('extension:live2d', 'builtin:whale', ['petdex-v1'])).resolves.toBe(false)
  })
})
