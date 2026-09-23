/**
 * Capability-declaration core: pure logic over the pi-ai settings document.
 *
 * The official `llm-pi-ai` settings namespace already carries every field a
 * custom model needs — `models[].input` (request modalities) and
 * `models[].reasoningEfforts` (selectable reasoning levels with their wire
 * spellings). The 0.1.6-alpha.2 Models page edits `models[].input` itself
 * (the shared `ModelInputTypes` control on the pi-ai model list), so this
 * module declares reasoning efforts only and treats every other field,
 * `input` included, as data to preserve. It reads a redacted namespace view,
 * drafts the per-model reasoning edits, validates them against the adapter's
 * own rules, and builds the single path op a save performs.
 *
 * Write granularity note: the settings `mutate` path-op walker only descends
 * plain objects (`applyPathOp` replaces arrays it meets mid-path), so a model
 * entry can only be addressed by writing the provider's whole `models` array
 * — the same whole-array override the official card performs on its first
 * edit. Unknown fields on each entry survive: drafts are structurally open.
 *
 * @module @linxin666/dsh-client-ui-model-capabilities/core
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** The official adapter family this plugin extends (the card slot's key). */
export const PI_AI_SETTINGS_NAMESPACE = 'llm-pi-ai'

/** Every thinking level a profile may declare, in escalation order. */
export type ModelThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The levels a capability draft may toggle, in escalation order. */
export const THINKING_LEVELS: readonly ModelThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** Selectable reasoning efforts: level -> wire spelling; `off` alone may be empty ("send nothing"). */
export type ReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>

/**
 * One model profile as the plugin drafts it. Fields this plugin does not edit
 * (id, name, input, contextWindow, maxTokens, compat, ...) are kept as-is so a
 * save never drops what the official card or a hand edit wrote.
 */
export interface ModelEntryDraft {
  /** Model id sent to the provider; the only required field. */
  id: string
  /** `false` = declared non-reasoning; a dict = declared levels; absent = inherit. */
  reasoningEfforts?: false | ReasoningEfforts
  [field: string]: unknown
}

/** How one entry's reasoning disposition is drafted. */
export type EffortsMode = 'inherit' | 'none' | 'levels'

/**
 * Read the value at a settings path. Plain-object walk only; an absent or
 * non-object link yields undefined. (Mirrors the redacted view's shape, not
 * the host's op walker: reads never need array indexing because the whole
 * `models` array is one value.)
 */
export function readAt(section: unknown, path: readonly string[]): unknown {
  let current: unknown = section
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Coerce a stored `models` value into drafts. Returns undefined when the value
 * is not an array; entries without a non-empty string id are skipped (the
 * adapter refuses them anyway, and dropping them here keeps the editor
 * renderable). Unknown fields are preserved by reference.
 */
export function modelsArrayOf(value: unknown): ModelEntryDraft[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: ModelEntryDraft[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record['id'] !== 'string' || record['id'].length === 0) continue
    entries.push(record as ModelEntryDraft)
  }
  return entries
}

/** Classify one entry's reasoning disposition for the tri-state editor. */
export function effortsModeOf(entry: ModelEntryDraft): EffortsMode {
  const efforts = entry['reasoningEfforts']
  if (efforts === undefined) return 'inherit'
  if (efforts === false) return 'none'
  if (typeof efforts === 'object' && efforts !== null && !Array.isArray(efforts)) return 'levels'
  // A malformed stored value reads as inherit: the editor rewrites the whole
  // field on save, so rendering it as an editable state is safer than hiding.
  return 'inherit'
}

/**
 * Normalize one entry's declared levels to wire spellings, escalation order.
 * `off` normalizes null/empty to '' ("supported, send nothing"); every other
 * declared level keeps its wire spelling (empty normalizes to '', which
 * validation reports).
 */
export function declaredLevelsOf(entry: ModelEntryDraft): Array<{ level: ModelThinkingLevel, wire: string }> {
  if (effortsModeOf(entry) !== 'levels') return []
  const efforts = entry['reasoningEfforts'] as ReasoningEfforts
  const declared: Array<{ level: ModelThinkingLevel, wire: string }> = []
  for (const level of THINKING_LEVELS) {
    if (!(level in efforts)) continue
    const wire = efforts[level]
    declared.push({ level, wire: typeof wire === 'string' ? wire : '' })
  }
  return declared
}

/** Validation failure for one capability draft, phrased for the editor. */
export type CapabilitiesIssue =
  | { kind: 'effortsOffOnly' }
  | { kind: 'effortsWireMissing', level: ModelThinkingLevel }

/**
 * Validate one draft against the rules the pi-ai adapter enforces on apply
 * (an invalid write would be refused after the fact; this reports it before):
 * a levels dict must declare at least one level beyond `off`, and every
 * non-off level must name a non-empty wire spelling.
 */
export function validateEntry(entry: ModelEntryDraft): CapabilitiesIssue | undefined {
  if (effortsModeOf(entry) !== 'levels') return undefined
  const declared = declaredLevelsOf(entry)
  let hasBeyondOff = false
  for (const { level, wire } of declared) {
    if (level !== 'off') {
      hasBeyondOff = true
      if (wire.length === 0) return { kind: 'effortsWireMissing', level }
    }
  }
  if (!hasBeyondOff) return { kind: 'effortsOffOnly' }
  return undefined
}

/**
 * Immutable draft update: set the reasoning disposition.
 * - `inherit` drops the field.
 * - `none` writes `false`.
 * - `levels` writes a dict; toggled levels keep a previously stored wire
 *   spelling, new ones default to the identity (the level name itself). An
 *   empty dict is invalid downstream, so a fresh switch materializes the
 *   common OpenAI-style preset (low/medium/high) instead of starting empty.
 */
export function withEffortsMode(
  entry: ModelEntryDraft,
  mode: EffortsMode,
  levels?: ReadonlyMap<ModelThinkingLevel, string>,
): ModelEntryDraft {
  if (mode === 'inherit') {
    const { reasoningEfforts: _efforts, ...rest } = entry
    return rest
  }
  if (mode === 'none') return { ...entry, reasoningEfforts: false }
  const efforts: ReasoningEfforts = {}
  for (const level of THINKING_LEVELS) {
    if (levels === undefined || !levels.has(level)) continue
    efforts[level] = levels.get(level) ?? level
  }
  return { ...entry, reasoningEfforts: efforts }
}

/** The common reasoning preset a fresh levels-mode editor starts from. */
export const COMMON_EFFORTS_PRESET: ReadonlyArray<readonly [ModelThinkingLevel, string]> = [
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high'],
]

/** Wire-spelling map of one entry's declared levels (editors toggle against this). */
export function levelsMapOf(entry: ModelEntryDraft): Map<ModelThinkingLevel, string> {
  return new Map(declaredLevelsOf(entry).map(({ level, wire }) => [level, wire]))
}

/**
 * Sanitize a draft for storage: drop keys whose value is undefined (JSON has
 * no undefined) and clone plain objects/arrays one level deep so later draft
 * edits cannot alias stored state. Unknown fields ride along untouched.
 */
export function sanitizeEntry(entry: ModelEntryDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined) continue
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out[key] = { ...(value as Record<string, unknown>) }
    } else if (Array.isArray(value)) {
      out[key] = [...value]
    } else {
      out[key] = value
    }
  }
  return out
}

/** One settings path op (the wire shape the remote mutate takes). */
export interface SetPathOp {
  op: 'set'
  path: string[]
  value: JsonValue
}

export interface UnsetPathOp {
  op: 'unset'
  path: string[]
}

export type PathOp = SetPathOp | UnsetPathOp

/**
 * Build the single op a save performs: replace the provider's whole `models`
 * array. The empty path suffix works on a stored section that does not carry
 * the array yet — the walker creates the intermediate objects, and every
 * other profile field keeps inheriting from its layer.
 */
export function buildModelsOp(settingsPath: readonly string[], entries: readonly ModelEntryDraft[]): SetPathOp {
  return {
    op: 'set',
    path: [...settingsPath, 'models'],
    // Entries originate from JSON-parsed stored views plus editor primitives,
    // so the sanitized output is JSON-shaped by construction.
    value: entries.map(sanitizeEntry) as JsonValue,
  }
}

/** A saved-models summary chip description used by the collapsed row header. */
export function effortsSummaryOf(entry: ModelEntryDraft): { mode: EffortsMode, levels: readonly ModelThinkingLevel[] } {
  const mode = effortsModeOf(entry)
  if (mode !== 'levels') return { mode, levels: [] }
  return { mode, levels: declaredLevelsOf(entry).map(({ level }) => level) }
}
