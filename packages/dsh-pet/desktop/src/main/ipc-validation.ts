import type { PetRenderQuality } from '../../../src/contracts/renderer.ts'
import { PET_DESKTOP_SCALE_MAX, PET_DESKTOP_SCALE_MIN } from '../../../src/contracts/desktop-host.ts'
import type { MoveTarget, PetInteraction } from '../shared/desktop-api.ts'
import { normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

export function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('expected a boolean IPC payload')
  return value
}

export function parsePetScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || value < PET_DESKTOP_SCALE_MIN || value > PET_DESKTOP_SCALE_MAX) {
    throw new TypeError('invalid pet scale')
  }
  return Math.round(value * 20) / 20
}

export function parseRenderQuality(value: unknown): PetRenderQuality {
  if (value !== 'low' && value !== 'balanced' && value !== 'high') throw new TypeError('invalid render quality')
  return value
}

export function parseMoveTarget(value: unknown): MoveTarget {
  if (typeof value !== 'object' || value === null) throw new TypeError('expected a move target')
  const target = value as Partial<MoveTarget>
  if (typeof target.x !== 'number' || !Number.isFinite(target.x)
    || typeof target.y !== 'number' || !Number.isFinite(target.y)
    || Math.abs(target.x) > 1_000_000 || Math.abs(target.y) > 1_000_000) {
    throw new TypeError('invalid move target')
  }
  return { x: Math.round(target.x), y: Math.round(target.y) }
}

export function parsePetInteraction(value: unknown): PetInteraction {
  if (value !== 'pet' && value !== 'feed') throw new TypeError('invalid pet interaction')
  return value
}

export function parsePetName(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('invalid pet name')
  const name = value.trim()
  if (name.length < 1 || name.length > 20) throw new TypeError('invalid pet name')
  return name
}

export function parsePetModelId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:builtin|local|imported|extension):[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) {
    throw new TypeError('invalid pet model id')
  }
  return value
}

export function parseWebDshUrl(value: unknown): string {
  return normalizeWebDshUrl(value)
}
