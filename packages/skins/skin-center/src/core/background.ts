/**
 * Shared skin-background preference contract (issue #996): the six values the
 * skin-center card edits — master switch, backdrop occlusion, per-state
 * backdrop blur, composer-card blur, and bubble opacity.
 *
 * These used to live only in the `skin-background` settings namespace, which
 * the remote pairing channel fences as loopback-only, so a paired remote
 * desktop always read defaults and silently dropped writes. They now persist
 * in the skin center's own v2 state (POST /api/skin-center/v2/active), which
 * rides the same allow-listed channel as skin switching. This module is the
 * dependency-free source of truth both halves (host routes / migration and
 * the browser controller) share.
 * @module @linxin666/dsh-client-ui-skin-center/core/background
 */

/** Skin-background preference set persisted in the v2 active state file. */
export interface SkinBackgroundConfig {
  /** Master switch for the skin center. */
  enabled?: boolean
  /** Background occlusion 0-100 (0 = no extra veil, 100 = fully obscured). */
  backgroundOpacity?: number
  /** Empty-conversation backdrop blur, 0-20 px (0 disables). */
  backgroundBlurEmpty?: number
  /** With-content backdrop blur, 0-20 px (0 disables). */
  backgroundBlurContent?: number
  /** Composer-card backdrop blur, 0-20 px. */
  inputCardBlur?: number
  /** Message bubble opacity 0-100, for skins exposing bubble alpha. */
  bubbleOpacity?: number
  /** Message-bubble backdrop blur 0-20 px, for skins exposing bubble blur. */
  bubbleBlur?: number
}

/** Effective value of every field when the state carries none. */
export const SKIN_BACKGROUND_DEFAULTS: Readonly<Required<SkinBackgroundConfig>> = {
  enabled: true,
  backgroundOpacity: 0,
  backgroundBlurEmpty: 0,
  backgroundBlurContent: 0,
  inputCardBlur: 10,
  bubbleOpacity: 50,
  bubbleBlur: 10,
}

/** The fields normalize/sanitize know about; unknown keys are dropped. */
export const SKIN_BACKGROUND_FIELDS = Object.keys(SKIN_BACKGROUND_DEFAULTS) as Array<keyof SkinBackgroundConfig>

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

const RANGES: Record<Exclude<keyof SkinBackgroundConfig, 'enabled'>, [number, number]> = {
  backgroundOpacity: [0, 100],
  backgroundBlurEmpty: [0, 20],
  backgroundBlurContent: [0, 20],
  inputCardBlur: [0, 20],
  bubbleOpacity: [0, 100],
  bubbleBlur: [0, 20],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lenient normalization for stored/legacy data: unknown keys and wrongly
 * typed fields are dropped, numeric fields are clamped into range. Never
 * fails; a non-object input yields an empty config.
 */
export function normalizeSkinBackground(value: unknown): SkinBackgroundConfig {
  if (!isRecord(value)) return {}
  const out: SkinBackgroundConfig = {}
  if (typeof value.enabled === 'boolean') out.enabled = value.enabled
  for (const field of Object.keys(RANGES) as Array<keyof typeof RANGES>) {
    const raw = value[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const [min, max] = RANGES[field]
    out[field] = clampInt(raw, min, max)
  }
  return out
}

/**
 * Strict validation for the POST /active write surface: a background value
 * must be an object whose known fields are correctly typed (numbers are then
 * clamped). Returns null for anything else so the route can answer 400.
 */
export function sanitizeSkinBackground(value: unknown): SkinBackgroundConfig | null {
  if (!isRecord(value)) return null
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return null
  for (const field of Object.keys(RANGES) as Array<keyof typeof RANGES>) {
    const raw = value[field]
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw))) return null
  }
  return normalizeSkinBackground(value)
}

/** Fill every absent field from {@link SKIN_BACKGROUND_DEFAULTS}. */
export function resolveSkinBackground(value: SkinBackgroundConfig | null | undefined): Required<SkinBackgroundConfig> {
  return { ...SKIN_BACKGROUND_DEFAULTS, ...(value ?? {}) }
}

/** True when at least one field departs from its default (customized data). */
export function hasCustomSkinBackground(value: SkinBackgroundConfig): boolean {
  return SKIN_BACKGROUND_FIELDS.some((field) => value[field] !== undefined && value[field] !== SKIN_BACKGROUND_DEFAULTS[field])
}
