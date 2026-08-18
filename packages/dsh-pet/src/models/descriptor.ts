import {
  PET_MODEL_SCHEMA_VERSION,
  type PetModelDescriptor,
  type PetModelSourceKind,
} from '../contracts/model.ts'
import type { PetExpression, PetMotion } from '../core/intent.ts'

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const NAMESPACED_ID_PATTERN = /^(?:builtin|local|imported|extension):[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/
const FORMAT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MOTIONS = [
  'idle', 'waiting', 'thinking', 'working', 'reviewing',
  'request-input', 'celebrate', 'failure', 'pet', 'feed',
] as const satisfies readonly PetMotion[]
const EXPRESSIONS = [
  'neutral', 'curious', 'focused', 'happy', 'worried', 'questioning',
] as const satisfies readonly PetExpression[]
const motionSet = new Set<string>(MOTIONS)
const expressionSet = new Set<string>(EXPRESSIONS)

export interface PetDexManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  spriteVersionNumber: 1 | 2
}

export type PetModelManifest = Omit<PetModelDescriptor, 'source'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  const text = value.trim()
  if (text.length < min || text.length > max) throw new Error(`${field} 长度必须为 ${min} 到 ${max} 个字符`)
  return text
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined
  const text = boundedText(value, field, 1, max)
  return text
}

function safeEntry(value: unknown): string {
  const entry = boundedText(value, 'entry', 1, 240)
  if (entry.startsWith('/') || entry.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(entry)) {
    throw new Error('entry 必须是模型目录内的相对路径')
  }
  const parts = entry.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('entry 必须是模型目录内的相对路径')
  }
  if (!/\.(?:webp|png)$/i.test(entry)) {
    throw new Error('entry 当前仅允许 WebP 或 PNG 数据资产')
  }
  return entry
}

function enumList<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
): T[] {
  if (!Array.isArray(value) || value.length > 64 || value.some(item => typeof item !== 'string' || !allowed.has(item))) {
    throw new Error(`${field} 无效`)
  }
  return [...new Set(value)] as T[]
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${field} 无效`)
  const result = value.map(item => boundedText(item, field, 1, 64))
  return [...new Set(result)]
}

function parseBindings<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
): Partial<Record<T, string | string[]>> {
  if (!isRecord(value)) throw new Error(`${field} 无效`)
  const result: Partial<Record<T, string | string[]>> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) throw new Error(`${field}.${key} 无效`)
    const values = Array.isArray(raw) ? raw : [raw]
    if (values.length < 1 || values.length > 16) throw new Error(`${field}.${key} 无效`)
    const parsed = values.map(item => boundedText(item, `${field}.${key}`, 1, 128))
    result[key as T] = Array.isArray(raw) ? parsed : parsed[0]
  }
  return result
}

function parseExpressionBindings(value: unknown): Partial<Record<PetExpression, string>> {
  const parsed = parseBindings<PetExpression>(value, 'bindings.expressions', expressionSet)
  const result: Partial<Record<PetExpression, string>> = {}
  for (const [key, binding] of Object.entries(parsed)) {
    if (Array.isArray(binding)) throw new Error(`bindings.expressions.${key} 无效`)
    result[key as PetExpression] = binding
  }
  return result
}

function parseSource(value: unknown): PetModelDescriptor['source'] {
  if (!isRecord(value) || !['builtin', 'local', 'imported', 'extension'].includes(String(value.kind))) {
    throw new Error('source 无效')
  }
  const kind = value.kind as PetModelSourceKind
  const providerId = optionalText(value.providerId, 'source.providerId', 128)
  if (providerId !== undefined && !PROVIDER_ID_PATTERN.test(providerId)) throw new Error('source.providerId 无效')
  if (kind === 'extension' && providerId === undefined) throw new Error('extension 模型必须声明 providerId')
  return { kind, ...(providerId === undefined ? {} : { providerId }) }
}

function parseCommon(value: unknown, manifest: boolean): PetModelDescriptor {
  if (!isRecord(value) || value.schemaVersion !== PET_MODEL_SCHEMA_VERSION) throw new Error('pet-model.json schemaVersion 无效')
  const id = boundedText(value.id, 'id', 1, 80)
  if (!(manifest ? MODEL_ID_PATTERN : NAMESPACED_ID_PATTERN).test(id)) throw new Error('模型 id 无效')
  const rendererId = boundedText(value.rendererId, 'rendererId', 3, 128)
  if (!PROVIDER_ID_PATTERN.test(rendererId)) throw new Error('rendererId 无效')
  const format = boundedText(value.format, 'format', 1, 64)
  if (!FORMAT_PATTERN.test(format)) throw new Error('format 无效')
  if (!isRecord(value.capabilities)) throw new Error('capabilities 无效')
  if (typeof value.capabilities.lookAt !== 'boolean'
    || typeof value.capabilities.lipSync !== 'boolean') throw new Error('capabilities 无效')
  if (!isRecord(value.bindings)) throw new Error('bindings 无效')
  if (!isRecord(value.fallback)
    || typeof value.fallback.motion !== 'string' || !motionSet.has(value.fallback.motion)
    || typeof value.fallback.expression !== 'string' || !expressionSet.has(value.fallback.expression)) {
    throw new Error('fallback 无效')
  }
  let license: PetModelDescriptor['license']
  if (value.license !== undefined) {
    if (!isRecord(value.license)) throw new Error('license 无效')
    const url = optionalText(value.license.url, 'license.url', 500)
    if (url !== undefined && !/^https?:\/\//i.test(url)) throw new Error('license.url 无效')
    license = {
      ...(optionalText(value.license.name, 'license.name', 100) === undefined ? {} : { name: optionalText(value.license.name, 'license.name', 100) }),
      ...(url === undefined ? {} : { url }),
      ...(optionalText(value.license.author, 'license.author', 100) === undefined ? {} : { author: optionalText(value.license.author, 'license.author', 100) }),
    }
  }
  const description = typeof value.description === 'string' ? value.description.trim() : undefined
  if (description !== undefined && description.length > 500) throw new Error('description 不能超过 500 个字符')
  return {
    schemaVersion: PET_MODEL_SCHEMA_VERSION,
    id,
    displayName: boundedText(value.displayName, 'displayName', 1, 80),
    ...(description === undefined || description === '' ? {} : { description }),
    rendererId,
    format,
    entry: safeEntry(value.entry),
    source: manifest ? { kind: 'local' } : parseSource(value.source),
    capabilities: {
      motions: enumList<PetMotion>(value.capabilities.motions, 'capabilities.motions', motionSet),
      expressions: enumList<PetExpression>(value.capabilities.expressions, 'capabilities.expressions', expressionSet),
      lookAt: value.capabilities.lookAt,
      lipSync: value.capabilities.lipSync,
      hitAreas: stringList(value.capabilities.hitAreas, 'capabilities.hitAreas'),
    },
    bindings: {
      motions: parseBindings<PetMotion>(value.bindings.motions, 'bindings.motions', motionSet),
      expressions: parseExpressionBindings(value.bindings.expressions),
    },
    fallback: {
      motion: value.fallback.motion as PetMotion,
      expression: value.fallback.expression as PetExpression,
    },
    ...(license === undefined ? {} : { license }),
  }
}

export function parsePetModelDescriptor(value: unknown): PetModelDescriptor {
  return parseCommon(value, false)
}

export function parsePetModelManifest(value: unknown): PetModelManifest {
  const { source: _source, ...manifest } = parseCommon(value, true)
  return manifest
}

export function parsePetDexManifest(value: unknown): PetDexManifest {
  if (!isRecord(value) || typeof value.id !== 'string' || !MODEL_ID_PATTERN.test(value.id)) {
    throw new Error('pet.json 中的 id 无效')
  }
  const displayName = boundedText(value.displayName, 'displayName', 1, 40)
  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (description.length > 500) throw new Error('description 不能超过 500 个字符')
  if (typeof value.spritesheetPath !== 'string'
    || value.spritesheetPath.includes('/')
    || value.spritesheetPath.includes('\\')
    || !/\.(?:webp|png)$/i.test(value.spritesheetPath)) {
    throw new Error('spritesheetPath 必须指向同目录的 WebP 或 PNG 文件')
  }
  if (value.spriteVersionNumber !== undefined && value.spriteVersionNumber !== 1 && value.spriteVersionNumber !== 2) {
    throw new Error('spriteVersionNumber 仅支持 1 或 2')
  }
  return {
    id: value.id,
    displayName,
    description,
    spritesheetPath: value.spritesheetPath,
    spriteVersionNumber: value.spriteVersionNumber === 2 ? 2 : 1,
  }
}

export function petDexToModelDescriptor(
  manifest: PetDexManifest,
  source: Exclude<PetModelSourceKind, 'builtin' | 'extension'> = 'local',
): PetModelDescriptor {
  return {
    schemaVersion: PET_MODEL_SCHEMA_VERSION,
    id: `${source}:${manifest.id}`,
    displayName: manifest.displayName,
    ...(manifest.description === '' ? {} : { description: manifest.description }),
    rendererId: 'builtin:sprite2d',
    format: manifest.spriteVersionNumber === 2 ? 'petdex-v2' : 'petdex-v1',
    entry: manifest.spritesheetPath,
    source: { kind: source },
    capabilities: {
      motions: [...MOTIONS], expressions: [], lookAt: false, lipSync: false, hitAreas: ['body'],
    },
    bindings: {
      motions: {
        idle: 'idle', waiting: 'waiting', thinking: 'running', working: 'running-right',
        reviewing: 'review', 'request-input': 'waving', celebrate: 'jumping',
        failure: 'failed', pet: 'waving', feed: 'jumping',
      },
      expressions: {},
    },
    fallback: { motion: 'idle', expression: 'neutral' },
  }
}

export function modelDescriptorToManifest(descriptor: PetModelDescriptor, id: string): PetModelManifest {
  const { source: _source, ...manifest } = descriptor
  return { ...structuredClone(manifest), id }
}
