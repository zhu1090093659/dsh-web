/**
 * skin.json manifest v2 — TypeScript contract types.
 *
 * Mirrors contracts/skin-manifest-v2.schema.json (the JSON Schema copy used
 * by editors and external validators). Keep both in sync; the runtime
 * validator in ./validate.ts is the authoritative fail-closed check.
 *
 * v2 in a nutshell: a skin is a pure asset directory (skin.json + skin.css +
 * optional patches.css / hooks.mjs / assets/). The skin-center package is the
 * only loader and renderer; skins never ship package.json, never enter the
 * boot graph, and never touch cordis.patch.yml.
 */

/** Hooks runtime contract coordinate family. */
export type SkinContractApiVersion = `x-org.linxin666.skin-center/${string}`

/** Relative path inside the skin directory (no leading slash, no "..", no protocol URLs). */
export type SkinRelPath = string

export interface SkinContractRequirement {
  apiVersion: SkinContractApiVersion
  kind: 'SkinRuntime' | 'SkinHooks'
  /** Missing optional contract → declared degradation path (e.g. run without hooks). */
  optional?: boolean
}

export interface SkinBackgroundLayer {
  type: 'image' | 'video'
  src: SkinRelPath
  /** CSS background shorthand layered over the media for readability. */
  scrim?: string
}

export interface SkinManifestV2 {
  $schema?: string
  /** File-structure version only; NOT a compatibility negotiation axis. */
  skinManifestVersion: 2
  /** Globally unique lowercase short id; scopes html[data-dsh-skin="<id>"]. */
  id: string
  name: string
  nameEn: string
  /** SemVer. */
  version: string
  author: string
  tagline?: string
  description?: string
  tags?: string[]
  accent?: string
  order?: number
  /** Optional legal metadata for third-party artwork (shop display). */
  license?: string
  licenseUrl?: string
  noticeUrl?: string
  sourceUrl?: string
  attribution?: string
  preview?: { light: SkinRelPath; dark: SkinRelPath }
  requires?: { contracts?: SkinContractRequirement[] }
  contributes: {
    /** L1 token + L2 semantic styles; scoped by the loader. */
    stylesheet: SkinRelPath
    /** Optional L3 free-selector patches (high sensitivity, disclosed). */
    patches?: SkinRelPath
    /** Fills the fixed 'background' decoration layer; WE wallpaper and the
     *  user's manual background both take precedence over it. */
    backgroundMedia?: { light?: SkinBackgroundLayer; dark?: SkinBackgroundLayer }
  }
  facets?: {
    client?: {
      /** hooks.mjs escape-hatch entry (trusted, high sensitivity). */
      entry: SkinRelPath
      /** Hooks runtime contract version, independent of skinManifestVersion. */
      apiVersion: SkinContractApiVersion
    }
  }
}

/** v1 fields accepted but ignored with a migration warning (never fail-closed). */
export const DEPRECATED_V1_FIELDS = ['package', 'wiring', 'bodyAttr'] as const

export interface SkinManifestValidation {
  ok: boolean
  errors: string[]
  /** Migration warnings (e.g. deprecated v1 fields) — never block loading. */
  warnings: string[]
  manifest?: SkinManifestV2
}
