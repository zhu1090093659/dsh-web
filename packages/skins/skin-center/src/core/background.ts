/**
 * Skin-background preference contract shared by the Host and browser halves.
 * The Host registers the settings section and persists the values into the
 * v2 state store; the browser half owns the live application and reads its
 * initial values from the same store (the settings scope is loopback-only
 * for paired remote devices, so background preferences ride the v2 channel
 * instead — see active-state.ts and routes-v2.ts).
 * @module @linxin666/dsh-client-ui-skin-center/core/background
 */

import z from 'schemastery'

/**
 * Plugin-configuration fields for the main-interface background, plus the
 * master switch that turns the whole skin center on or off.
 */
export interface SkinBackgroundConfig {
  /** Master switch for the skin center. */
  enabled?: boolean
  /**
   * Background occlusion 0-100 (0 = no extra veil, 100 = fully obscured).
   * Skins that paint a backdrop image (blue-fantasy / whale-song) read the
   * equivalent CSS variable value and raise their scrim; the official stock
   * look has no backdrop and is unaffected.
   */
  backgroundOpacity?: number
  /**
   * Gaussian blur (px, 0-20) applied to the backdrop while the conversation
   * pane has no content (empty state). Painted only by skins that draw a
   * backdrop; 0 disables the empty-state blur.
   */
  backgroundBlurEmpty?: number
  /**
   * Gaussian blur (px, 0-20) applied to the backdrop once the conversation
   * pane has content. Painted only by skins that draw a backdrop; 0 disables
   * the with-content blur.
   */
  backgroundBlurContent?: number
  /** Backdrop blur on the composer card while backdrop art is visible. */
  inputCardBlur?: number
  /** Message bubble opacity 0-100, consumed by skins that expose bubble alpha. */
  bubbleOpacity?: number
}

/**
 * Runtime schema for SkinBackgroundConfig. Persists the master switch
 * (`enabled`) alongside the background strength fields.
 */
export const SkinBackgroundConfigSchema: z<SkinBackgroundConfig> = z.object({
  enabled: z.boolean().default(true),
  backgroundOpacity: z.number().min(0).max(100).step(5).default(0),
  backgroundBlurEmpty: z.number().min(0).max(20).step(1).default(0),
  backgroundBlurContent: z.number().min(0).max(20).step(1).default(0),
  inputCardBlur: z.number().min(0).max(20).step(1).default(10),
  bubbleOpacity: z.number().min(0).max(100).step(5).default(50),
})

/**
 * Schema-resolved defaults, one per field (field order matches the schema so
 * JSON comparisons against schema output stay stable).
 */
export const BACKGROUND_DEFAULTS: Readonly<Required<SkinBackgroundConfig>> = {
  enabled: true,
  backgroundOpacity: 0,
  backgroundBlurEmpty: 0,
  backgroundBlurContent: 0,
  inputCardBlur: 10,
  bubbleOpacity: 50,
}

/** Numeric field ranges shared by the clamp and the schema. */
const BACKGROUND_NUMBER_RANGES = {
  backgroundOpacity: { min: 0, max: 100 },
  backgroundBlurEmpty: { min: 0, max: 20 },
  backgroundBlurContent: { min: 0, max: 20 },
  inputCardBlur: { min: 0, max: 20 },
  bubbleOpacity: { min: 0, max: 100 },
} as const

/** Clamp (and round) every numeric field of a raw input record into range. */
export function clampBackgroundNumbers(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value }
  for (const [field, range] of Object.entries(BACKGROUND_NUMBER_RANGES)) {
    const raw = next[field]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      next[field] = Math.max(range.min, Math.min(range.max, Math.round(raw)))
    }
  }
  return next
}

/**
 * Parse untrusted input into a valid config: numeric fields are clamped,
 * missing fields resolve to the schema defaults, and anything the schema
 * rejects yields null. Synchronous by contract (readActiveState feeds the
 * per-response tapIndex adapter and must never await).
 */
export function parseBackgroundConfig(value: unknown): SkinBackgroundConfig | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  try {
    // Schemastery's raw resolver: returns [resolved] and throws
    // ValidationError on rejection (the ~standard validate wrapper is typed
    // as possibly-async, so the sync path is used directly here).
    const [resolved] = z.resolve(clampBackgroundNumbers(value as Record<string, unknown>), SkinBackgroundConfigSchema, {})
    return resolved as SkinBackgroundConfig
  } catch {
    return null
  }
}

/** True when a resolved config differs from the schema defaults (user-customized). */
export function backgroundDiffersFromDefaults(value: SkinBackgroundConfig): boolean {
  return JSON.stringify(value) !== JSON.stringify(BACKGROUND_DEFAULTS)
}
