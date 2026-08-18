import { open, readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

import type { PetModelManifest } from './descriptor.ts'
import {
  modelDescriptorToManifest,
  parsePetDexManifest,
  parsePetModelManifest,
  petDexToModelDescriptor,
} from './descriptor.ts'

export const PIXEL_FRAME_WIDTH = 192
export const PIXEL_FRAME_HEIGHT = 208
export const PIXEL_FRAME_COLUMNS = 8
export const PET_MODEL_MANIFEST_NAME = 'pet-model.json'
const PETDEX_MANIFEST_NAME = 'pet.json'
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ASSET_BYTES = 32 * 1024 * 1024
const MAX_TEXTURE_DIMENSION = 8192

export interface PetModelPackage {
  directory: string
  manifest: PetModelManifest
  entryPath: string
  legacyPetDex: boolean
}

export function pixelImageDimensions(bytes: Uint8Array): { width: number, height: number } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('模型纹理不是有效的 WebP 或 PNG')
  }
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 }
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  throw new Error('不支持该 WebP 编码格式')
}

async function inspectTexture(path: string, manifest: PetModelManifest): Promise<void> {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size < 30 || metadata.size > MAX_ASSET_BYTES) {
    throw new Error('模型纹理大小无效')
  }
  const extension = extname(path).toLowerCase()
  if (extension !== '.webp' && extension !== '.png') throw new Error('模型纹理格式无效')
  const handle = await open(path, 'r')
  const header = Buffer.alloc(32)
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const dimensions = pixelImageDimensions(header.subarray(0, bytesRead))
    if (dimensions.width < 1 || dimensions.height < 1
      || dimensions.width > MAX_TEXTURE_DIMENSION || dimensions.height > MAX_TEXTURE_DIMENSION) {
      throw new Error('模型纹理尺寸无效')
    }
    if (manifest.rendererId === 'builtin:sprite2d') {
      const expectedHeight = PIXEL_FRAME_HEIGHT * (manifest.format === 'petdex-v2' ? 11 : 9)
      if (dimensions.width !== PIXEL_FRAME_WIDTH * PIXEL_FRAME_COLUMNS || dimensions.height !== expectedHeight) {
        throw new Error(`精灵图必须为 1536×${expectedHeight}`)
      }
    }
  } finally {
    await handle.close()
  }
}

async function readBoundedJson(path: string, label: string): Promise<unknown> {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} 大小无效`)
  }
  return JSON.parse(await readFile(path, 'utf8'))
}

async function existingManifest(directory: string): Promise<{ path: string, legacy: boolean }> {
  for (const [name, legacy] of [[PET_MODEL_MANIFEST_NAME, false], [PETDEX_MANIFEST_NAME, true]] as const) {
    try {
      const path = await realpath(join(directory, name))
      const relation = relative(directory, path)
      if (relation.startsWith('..') || isAbsolute(relation)) throw new Error(`${name} 不能位于模型目录之外`)
      return { path, legacy }
    } catch (error) {
      if (error instanceof Error && error.message.includes('模型目录之外')) throw error
    }
  }
  throw new Error('模型文件夹缺少 pet-model.json 或 pet.json')
}

/** Read only declarative JSON plus its one allow-listed texture entry. */
export async function readPetModelPackage(path: string): Promise<PetModelPackage> {
  const directory = await realpath(path)
  const manifestFile = await existingManifest(directory)
  const raw = await readBoundedJson(
    manifestFile.path,
    manifestFile.legacy ? PETDEX_MANIFEST_NAME : PET_MODEL_MANIFEST_NAME,
  )
  const manifest = manifestFile.legacy
    ? (() => {
        const legacy = parsePetDexManifest(raw)
        return modelDescriptorToManifest(petDexToModelDescriptor(legacy), legacy.id)
      })()
    : parsePetModelManifest(raw)
  const entryPath = await realpath(join(directory, manifest.entry))
  const entryRelation = relative(directory, entryPath)
  if (entryRelation.startsWith('..') || isAbsolute(entryRelation)) {
    throw new Error('模型资产不能位于模型目录之外')
  }
  await inspectTexture(entryPath, manifest)
  return { directory, manifest, entryPath, legacyPetDex: manifestFile.legacy }
}
