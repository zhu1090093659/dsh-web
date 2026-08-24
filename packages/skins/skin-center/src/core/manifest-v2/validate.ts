/**
 * Fail-closed validator for skin.json manifest v2.
 *
 * Pure, dependency-free, safe in both the host (node) and the browser
 * bundle. Rules (issue #506, section 5):
 *  - unknown top-level / nested fields are hard errors (fail-closed);
 *  - the v1 fields `package` / `wiring` / `bodyAttr` are an explicit
 *    deprecated allowlist: ignored with a migration warning, never an
 *    error — otherwise the 11 legacy manifests would be rejected by their
 *    own validator;
 *  - all file references must be relative paths inside the skin directory
 *    (no leading slash, no "..", no protocol URLs);
 *  - `skinManifestVersion` declares file structure only; hooks runtime
 *    compatibility is carried by `facets.client.apiVersion` and checked
 *    by the loader, not here.
 */

import { DEPRECATED_V1_FIELDS } from './types.ts'
import type { SkinManifestV2, SkinManifestValidation } from './types.ts'

const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*:\/\/)[A-Za-z0-9._\-/]+$/
const SKIN_ID = /^[a-z][a-z0-9-]{0,31}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const API_VERSION = /^x-org\.linxin666\.skin-center\/[a-z0-9]+$/

const TOP_LEVEL_KEYS = new Set([
  '$schema', 'skinManifestVersion', 'id', 'name', 'nameEn', 'version',
  'author', 'tagline', 'description', 'tags', 'accent', 'order', 'preview',
  'license', 'licenseUrl', 'noticeUrl', 'sourceUrl', 'attribution',
  'requires', 'contributes', 'facets', ...DEPRECATED_V1_FIELDS,
])

const DEPRECATED_SET = new Set<string>(DEPRECATED_V1_FIELDS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${path}: unknown field "${key}"`)
  }
}

function checkRelPath(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'string' || !REL_PATH.test(value)) {
    errors.push(`${path}: must be a relative path inside the skin directory (got ${JSON.stringify(value)})`)
  }
}

function checkOptionalString(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined && typeof value !== 'string') {
    errors.push(`${path}: must be a string`)
  }
}

function checkBackgroundLayer(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`)
    return
  }
  checkKeys(value, new Set(['type', 'src', 'scrim']), path, errors)
  if (value.type !== 'image' && value.type !== 'video') {
    errors.push(`${path}.type: must be "image" or "video"`)
  }
  checkRelPath(value.src, `${path}.src`, errors)
  checkOptionalString(value.scrim, `${path}.scrim`, errors)
}

function checkContracts(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    errors.push(`${path}: must be an array`)
    return
  }
  value.forEach((entry, index) => {
    const p = `${path}[${index}]`
    if (!isRecord(entry)) {
      errors.push(`${p}: must be an object`)
      return
    }
    checkKeys(entry, new Set(['apiVersion', 'kind', 'optional']), p, errors)
    if (typeof entry.apiVersion !== 'string' || !API_VERSION.test(entry.apiVersion)) {
      errors.push(`${p}.apiVersion: must match x-org.linxin666.skin-center/<tag>`)
    }
    if (entry.kind !== 'SkinRuntime' && entry.kind !== 'SkinHooks') {
      errors.push(`${p}.kind: must be "SkinRuntime" or "SkinHooks"`)
    }
    if (entry.optional !== undefined && typeof entry.optional !== 'boolean') {
      errors.push(`${p}.optional: must be a boolean`)
    }
  })
}

/**
 * Validate a parsed skin.json payload against the v2 contract.
 * Never throws; malformed input yields `ok: false` with human-readable errors.
 */
export function validateSkinManifestV2(input: unknown): SkinManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isRecord(input)) {
    return { ok: false, errors: ['manifest: must be a JSON object'], warnings }
  }

  // Deprecated v1 allowlist first: ignore + migration warning, never fail.
  for (const field of Object.keys(input)) {
    if (DEPRECATED_SET.has(field)) {
      warnings.push(`deprecated v1 field "${field}" ignored; run the v1→v2 migration codemod`)
    }
  }
  checkKeys(input, TOP_LEVEL_KEYS, 'manifest', errors)

  if (input.skinManifestVersion !== 2) {
    errors.push('manifest.skinManifestVersion: must be 2 (v1 manifests need the migration codemod)')
  }
  if (typeof input.id !== 'string' || !SKIN_ID.test(input.id)) {
    errors.push(`manifest.id: must match ${SKIN_ID} (got ${JSON.stringify(input.id)})`)
  }
  for (const field of ['name', 'nameEn', 'author'] as const) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      errors.push(`manifest.${field}: required non-empty string`)
    }
  }
  if (typeof input.version !== 'string' || !SEMVER.test(input.version)) {
    errors.push(`manifest.version: required SemVer string (got ${JSON.stringify(input.version)})`)
  }
  checkOptionalString(input.tagline, 'manifest.tagline', errors)
  checkOptionalString(input.description, 'manifest.description', errors)
  for (const field of ['license', 'licenseUrl', 'noticeUrl', 'sourceUrl', 'attribution'] as const) {
    checkOptionalString(input[field], `manifest.${field}`, errors)
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) {
      errors.push('manifest.tags: must be a string array')
    }
  }
  if (input.accent !== undefined && (typeof input.accent !== 'string' || !HEX_COLOR.test(input.accent))) {
    errors.push(`manifest.accent: must be a #rrggbb color (got ${JSON.stringify(input.accent)})`)
  }
  if (input.order !== undefined && (!Number.isInteger(input.order))) {
    errors.push('manifest.order: must be an integer')
  }
  if (input.$schema !== undefined && typeof input.$schema !== 'string') {
    errors.push('manifest.$schema: must be a string')
  }

  if (input.preview !== undefined) {
    if (!isRecord(input.preview)) {
      errors.push('manifest.preview: must be an object')
    } else {
      checkKeys(input.preview, new Set(['light', 'dark']), 'manifest.preview', errors)
      checkRelPath(input.preview.light, 'manifest.preview.light', errors)
      checkRelPath(input.preview.dark, 'manifest.preview.dark', errors)
    }
  }

  if (input.requires !== undefined) {
    if (!isRecord(input.requires)) {
      errors.push('manifest.requires: must be an object')
    } else {
      checkKeys(input.requires, new Set(['contracts']), 'manifest.requires', errors)
      checkContracts(input.requires.contracts, 'manifest.requires.contracts', errors)
    }
  }

  if (!isRecord(input.contributes)) {
    errors.push('manifest.contributes: required object with at least "stylesheet"')
  } else {
    const contributes = input.contributes
    checkKeys(contributes, new Set(['stylesheet', 'patches', 'backgroundMedia', 'backgroundSelfScrim']), 'manifest.contributes', errors)
    checkRelPath(contributes.stylesheet, 'manifest.contributes.stylesheet', errors)
    if (contributes.patches !== undefined) {
      checkRelPath(contributes.patches, 'manifest.contributes.patches', errors)
    }
    if (contributes.backgroundSelfScrim !== undefined && typeof contributes.backgroundSelfScrim !== 'boolean') {
      errors.push('manifest.contributes.backgroundSelfScrim: must be a boolean')
    }
    if (contributes.backgroundMedia !== undefined) {
      if (!isRecord(contributes.backgroundMedia)) {
        errors.push('manifest.contributes.backgroundMedia: must be an object')
      } else {
        checkKeys(contributes.backgroundMedia, new Set(['light', 'dark']), 'manifest.contributes.backgroundMedia', errors)
        checkBackgroundLayer(contributes.backgroundMedia.light, 'manifest.contributes.backgroundMedia.light', errors)
        checkBackgroundLayer(contributes.backgroundMedia.dark, 'manifest.contributes.backgroundMedia.dark', errors)
      }
    }
  }

  if (input.facets !== undefined) {
    if (!isRecord(input.facets)) {
      errors.push('manifest.facets: must be an object')
    } else {
      checkKeys(input.facets, new Set(['client']), 'manifest.facets', errors)
      if (input.facets.client !== undefined) {
        const client = input.facets.client
        if (!isRecord(client)) {
          errors.push('manifest.facets.client: must be an object')
        } else {
          checkKeys(client, new Set(['entry', 'apiVersion']), 'manifest.facets.client', errors)
          checkRelPath(client.entry, 'manifest.facets.client.entry', errors)
          if (typeof client.apiVersion !== 'string' || !API_VERSION.test(client.apiVersion)) {
            errors.push('manifest.facets.client.apiVersion: must match x-org.linxin666.skin-center/<tag>')
          }
        }
      }
    }
  }

  const manifest = errors.length === 0 ? (input as unknown as SkinManifestV2) : undefined
  return { ok: errors.length === 0, errors, warnings, manifest }
}
