/**
 * Live2D .model3.json reference closure — the set of files a model declares
 * (pet-center M2, issue #623). The host asset route only ever serves a pet's
 * declared manifest, its declared primary assets, and this closure; the CLI
 * validator reuses the same extractor so an install-time check proves the
 * serving set is complete.
 *
 * Cubism file family: Moc (.moc3), Textures (images), Physics (.physics3.json),
 * Pose (.pose3.json), DisplayInfo (.cdi3.json), Expressions[].File
 * (.exp3.json), Motions.<group>[].File (.motion3.json), UserData
 * (.userdata3.json). Every reference must be a safe manifest-relative path
 * (safeManifestPath); unsafe entries make the model unloadable.
 *
 * Erasable-syntax-only: scripts/ import this under node strip-only mode.
 * @module @linxin666/dsh-pet/model3
 */

import { safeManifestPath } from './manifest-v2.ts'

/** Collect the safe relative paths one model3.json references. */
export function collectModel3References(model3: unknown): { references: string[]; errors: string[] } {
  const errors: string[] = []
  if (typeof model3 !== 'object' || model3 === null) {
    return { references: [], errors: ['model3.json is not an object'] }
  }
  const fileReferences = (model3 as Record<string, unknown>).FileReferences
  if (typeof fileReferences !== 'object' || fileReferences === null) {
    return { references: [], errors: ['model3.json has no FileReferences'] }
  }
  const refs = fileReferences as Record<string, unknown>
  const collected = new Set<string>()
  const push = (raw: unknown, field: string): void => {
    const safe = safeManifestPath(raw)
    if (safe === undefined) {
      errors.push(field + ' is not a safe relative path: ' + JSON.stringify(String(raw)))
      return
    }
    collected.add(safe)
  }
  if (refs.Moc !== undefined) push(refs.Moc, 'FileReferences.Moc')
  if (Array.isArray(refs.Textures)) {
    refs.Textures.forEach((texture, index) => push(texture, 'FileReferences.Textures[' + index + ']'))
  }
  for (const scalar of ['Physics', 'Pose', 'DisplayInfo', 'UserData'] as const) {
    if (refs[scalar] !== undefined) push(refs[scalar], 'FileReferences.' + scalar)
  }
  if (Array.isArray(refs.Expressions)) {
    refs.Expressions.forEach((expression, index) => {
      const file = typeof expression === 'object' && expression !== null
        ? (expression as Record<string, unknown>).File
        : undefined
      if (file !== undefined) push(file, 'FileReferences.Expressions[' + index + '].File')
    })
  }
  if (typeof refs.Motions === 'object' && refs.Motions !== null) {
    for (const [group, motions] of Object.entries(refs.Motions as Record<string, unknown>)) {
      if (!Array.isArray(motions)) {
        errors.push('FileReferences.Motions.' + group + ' is not an array')
        continue
      }
      motions.forEach((motion, index) => {
        const file = typeof motion === 'object' && motion !== null
          ? (motion as Record<string, unknown>).File
          : undefined
        if (file !== undefined) push(file, 'FileReferences.Motions.' + group + '[' + index + '].File')
      })
    }
  }
  return { references: [...collected].sort(), errors }
}

/** The motion group names a model3.json declares (for CLI diagnostics). */
export function model3MotionGroups(model3: unknown): string[] {
  if (typeof model3 !== 'object' || model3 === null) return []
  const fileReferences = (model3 as Record<string, unknown>).FileReferences
  if (typeof fileReferences !== 'object' || fileReferences === null) return []
  const motions = (fileReferences as Record<string, unknown>).Motions
  if (typeof motions !== 'object' || motions === null) return []
  return Object.keys(motions as Record<string, unknown>).sort()
}

/** The hit area names a model3.json declares (top-level HitAreas). */
export function model3HitAreas(model3: unknown): string[] {
  if (typeof model3 !== 'object' || model3 === null) return []
  const hitAreas = (model3 as Record<string, unknown>).HitAreas
  if (!Array.isArray(hitAreas)) return []
  return hitAreas
    .map(area => typeof area === 'object' && area !== null ? (area as Record<string, unknown>).Name : undefined)
    .filter((name): name is string => typeof name === 'string')
    .sort()
}
