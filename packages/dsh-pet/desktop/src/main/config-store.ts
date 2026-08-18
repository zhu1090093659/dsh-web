import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { PetRenderQuality } from '../../../src/contracts/renderer.ts'
import { PET_DESKTOP_SCALE_MAX, PET_DESKTOP_SCALE_MIN } from '../../../src/contracts/desktop-host.ts'
import type { MoveTarget } from '../shared/desktop-api.ts'
import { DEFAULT_WEB_DSH_URL, normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

export type PetPresentationHostId = 'standalone' | 'dshcode' | 'dsh-desktop' | `custom:${string}`

export interface DesktopConfig {
  schemaVersion: 7
  hostId: PetPresentationHostId
  surface: {
    visible: boolean
    locked: boolean
    alwaysOnTop: boolean
    scale: number
    position?: MoveTarget & { displayId?: string }
  }
  renderer: {
    rendererId: string
    modelId: string
    quality: PetRenderQuality
    modelAliases: Record<string, string>
  }
  standalone: {
    lastWebOrigin: string
  }
}

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  schemaVersion: 7,
  hostId: 'standalone',
  surface: { visible: true, locked: false, alwaysOnTop: true, scale: 1 },
  renderer: {
    rendererId: 'builtin:sprite2d',
    modelId: 'builtin:whale',
    quality: 'balanced',
    modelAliases: {},
  },
  standalone: { lastWebOrigin: DEFAULT_WEB_DSH_URL },
}

function defaults(): DesktopConfig {
  return structuredClone(DEFAULT_DESKTOP_CONFIG)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
}

function parsePosition(value: unknown): DesktopConfig['surface']['position'] {
  if (!isRecord(value) || !validCoordinate(value.x) || !validCoordinate(value.y)) return undefined
  const displayId = typeof value.displayId === 'string' && value.displayId.length >= 1 && value.displayId.length <= 128
    ? value.displayId
    : undefined
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    ...(displayId === undefined ? {} : { displayId }),
  }
}

function parseOrigin(value: unknown): string {
  try {
    return normalizeWebDshUrl(value)
  } catch {
    return DEFAULT_WEB_DSH_URL
  }
}

function parseModelAliases(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const aliases: Record<string, string> = {}
  for (const [modelId, rawName] of Object.entries(value).slice(0, 128)) {
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (/^(?:builtin|local|imported|extension):[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(modelId)
      && name.length >= 1 && name.length <= 20) aliases[modelId] = name
  }
  return aliases
}

function parseHostId(value: unknown): PetPresentationHostId {
  if (value === 'standalone' || value === 'dshcode' || value === 'dsh-desktop') return value
  if (typeof value === 'string' && /^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    return value as `custom:${string}`
  }
  return 'standalone'
}

function parseNamespacedId(value: unknown, fallback: string): string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
    ? value
    : fallback
}

function parseScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= PET_DESKTOP_SCALE_MIN && value <= PET_DESKTOP_SCALE_MAX
    ? Math.round(value * 20) / 20
    : 1
}

function parseV7(value: Record<string, unknown>): DesktopConfig {
  const base = defaults()
  const surface = isRecord(value.surface) ? value.surface : {}
  const renderer = isRecord(value.renderer) ? value.renderer : {}
  const standalone = isRecord(value.standalone) ? value.standalone : {}
  const position = parsePosition(surface.position)
  const quality = renderer.quality === 'low' || renderer.quality === 'balanced' || renderer.quality === 'high'
    ? renderer.quality
    : base.renderer.quality
  return {
    schemaVersion: 7,
    hostId: parseHostId(value.hostId),
    surface: {
      visible: surface.visible !== false,
      locked: surface.locked === true,
      alwaysOnTop: surface.alwaysOnTop !== false,
      scale: parseScale(surface.scale),
      ...(position === undefined ? {} : { position }),
    },
    renderer: {
      rendererId: parseNamespacedId(renderer.rendererId, base.renderer.rendererId),
      modelId: parseNamespacedId(renderer.modelId, base.renderer.modelId),
      quality,
      modelAliases: parseModelAliases(renderer.modelAliases),
    },
    standalone: { lastWebOrigin: parseOrigin(standalone.lastWebOrigin) },
  }
}

function migrateLegacy(value: Record<string, unknown>): DesktopConfig {
  const version = value.schemaVersion as number
  const base = defaults()
  const position = parsePosition(value.position)
  return {
    ...base,
    surface: {
      visible: version >= 5 ? value.visible !== false : true,
      locked: value.locked === true,
      alwaysOnTop: value.alwaysOnTop !== false,
      scale: version >= 6 ? parseScale(value.scale) : 1,
      ...(position === undefined ? {} : { position }),
    },
    renderer: {
      ...base.renderer,
      modelId: version >= 3 ? parseNamespacedId(value.pixelModelId, base.renderer.modelId) : base.renderer.modelId,
      modelAliases: version >= 4 ? parseModelAliases(value.pixelModelNames) : {},
    },
    standalone: { lastWebOrigin: version >= 2 ? parseOrigin(value.webDshUrl) : DEFAULT_WEB_DSH_URL },
  }
}

/** Idempotently normalize V7 and migrate every frozen legacy version. */
export function migrateDesktopConfig(value: unknown): DesktopConfig {
  if (!isRecord(value)) return defaults()
  if (value.schemaVersion === 7) return parseV7(value)
  if ([1, 2, 3, 4, 5, 6].includes(value.schemaVersion as number)) return migrateLegacy(value)
  return defaults()
}

/** Compatibility name retained for internal callers during the V7 transition. */
export const parseDesktopConfig = migrateDesktopConfig

export class ConfigStore {
  private saveQueue = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async load(): Promise<DesktopConfig> {
    try {
      return migrateDesktopConfig(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      return defaults()
    }
  }

  save(config: DesktopConfig): Promise<void> {
    const snapshot = migrateDesktopConfig(config)
    this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
      try {
        await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
        await rename(temporaryPath, this.filePath)
      } catch (error) {
        await rm(temporaryPath, { force: true })
        throw error
      }
    })
    return this.saveQueue
  }
}
