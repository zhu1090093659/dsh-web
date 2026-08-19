/**
 * Voice-pack normalization and merge (pet-center M4, issue #677).
 *
 * A voice pack is the optional 'voice.json' inside a pet directory, or the
 * global '$DSH_HOME/pets/.voice.json' override file — pure JSON content that
 * layers pet copy over the built-in pools. Two halves:
 *
 *  - 'overrides': the chatter pools (status / tools / toolRemaining /
 *    whispers) handed to the chatter engines through a VoicePoolsProvider;
 *  - 'panel': the hover-panel chrome (button labels, stat formats, action
 *    subset) served to the browser half through PetDefinition.panel.
 *
 * Discipline split matches the registry: STRUCTURE is fail-closed per file
 * (a non-object root drops the whole pack with a warning), CONTENT is
 * warn-and-drop per slot — one bad line never breaks a pet. The JSON Schema
 * twin lives at contracts/voice-pack-v1.schema.json for documentation and
 * external tooling; this hand-rolled normalizer is authoritative (the
 * repository ships no schema-validator runtime).
 *
 * Placeholder policy (each pool kind whitelists its own tokens):
 *  - status / whisper pools / panel labels: no placeholders allowed — a line
 *    carrying any '{...}' token is dropped with a warning;
 *  - tools: {tool} and {hint}; toolRemaining: {n}; panel stats:
 *    {rank} / {n} / {points}.
 *
 * This file is imported directly by scripts/dsh-pet under node's strip-only
 * TypeScript mode: keep it erasable-syntax-only.
 * @module @linxin666/dsh-pet/voice-pack
 */

import {
  STATUS_SCENES,
  TOOL_CATEGORIES,
  type VoicePackOverrides,
  type WhisperRule,
} from './chatter.ts'

/** Schema version this module normalizes (optional field; missing = 1). */
export const VOICE_PACK_V1 = 1 as const

/** Hover-panel action buttons a pack can show or hide (canonical order). */
export const PANEL_ACTIONS = ['feed', 'rename', 'hide'] as const
export type PanelAction = (typeof PANEL_ACTIONS)[number]

/** Panel label slots (unset slots keep the client's i18n dictionary copy). */
export const PANEL_LABEL_KEYS = ['feed', 'rename', 'hide', 'confirm'] as const
export type PanelLabelKey = (typeof PANEL_LABEL_KEYS)[number]

/** Panel stat slots ({rank}/{n}/{points} interpolate the live values). */
export const PANEL_STAT_KEYS = ['rank', 'treats', 'points'] as const
export type PanelStatKey = (typeof PANEL_STAT_KEYS)[number]

/** Hover-panel chrome overrides served to the browser half. */
export interface PetPanelView {
  /** Button / input labels; unset slots keep the i18n dictionary copy. */
  labels?: Partial<Record<PanelLabelKey, string>>
  /** Stat line formats; unset slots keep the i18n dictionary copy. */
  stats?: Partial<Record<PanelStatKey, string>>
  /** Actions to render in canonical order; absent = all three; [] = none. */
  actions?: PanelAction[]
}

/** One normalized voice pack (a pet's voice.json or the global override). */
export interface VoicePack {
  /** Chatter pool overrides (draw-time merged with the built-in pools). */
  overrides: VoicePackOverrides
  /** Hover-panel chrome, when the pack declares any. */
  panel?: PetPanelView
}

/** Hard caps shared by every pool slot (mirrors the remarks discipline). */
export const VOICE_POOL_LINES_MAX = 64
export const VOICE_LINE_MAX = 160
export const VOICE_KEYWORDS_PER_RULE_MAX = 16
export const VOICE_KEYWORD_MAX = 40
export const VOICE_RULES_MAX = 32
export const VOICE_LABEL_MAX = 40
export const VOICE_STAT_MAX = 80

/** Any '{token}' placeholder (no nesting, no newlines). */
const PLACEHOLDER_PATTERN = /{[^{}]*}/g

/** Allowed placeholder tokens per pool kind (absent kind = none allowed). */
const PLACEHOLDER_WHITELIST: Partial<Record<PoolKind, readonly string[]>> = {
  tools: ['{tool}', '{hint}'],
  toolRemaining: ['{n}'],
  stat: ['{rank}', '{n}', '{points}'],
}

type PoolKind = 'status' | 'tools' | 'toolRemaining' | 'whisperGeneric' | 'whisperRule' | 'label' | 'stat'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Trim, length-cap and placeholder-check one copy line; undefined to drop. */
function normalizeLine(raw: string, kind: PoolKind, onWarning: (message: string) => void): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  let capped = trimmed.length > VOICE_LINE_MAX ? trimmed.slice(0, VOICE_LINE_MAX) : trimmed
  // The length cap may cut a placeholder token in half, leaving a dangling
  // '{' that would render literally; drop the tail from the unmatched brace.
  const dangling = capped.lastIndexOf('{')
  if (dangling !== -1 && capped.indexOf('}', dangling) === -1) {
    onWarning('line cut at an unterminated placeholder; tail dropped: ' + capped.slice(0, 40) + '...')
    capped = capped.slice(0, dangling)
  }
  if (capped === '') return undefined
  const allowed = PLACEHOLDER_WHITELIST[kind]
  const tokens = capped.match(PLACEHOLDER_PATTERN) ?? []
  for (const token of tokens) {
    if (allowed?.includes(token) === true) continue
    const preview = capped.length > 40 ? capped.slice(0, 40) + '...' : capped
    onWarning('line dropped (unsupported placeholder ' + token + '): ' + preview)
    return undefined
  }
  return capped
}

/**
 * Normalize one pool slot. Accepts a single line or an array; non-string
 * entries warn and drop, empty lines drop silently, lines over the length
 * cap truncate, illegal placeholders drop the line, and pools over the line
 * cap keep their first lines. An explicit empty pool normalizes to [] (the
 * whisper channels read that as mute) while an absent slot normalizes to
 * undefined (the slot keeps the built-in pool).
 */
export function normalizePool(
  raw: unknown,
  kind: PoolKind,
  onWarning: (message: string) => void = () => {},
): string[] | undefined {
  if (raw === undefined) return undefined
  const entries = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : undefined
  if (entries === undefined) {
    onWarning('pool must be a string or an array of strings')
    return undefined
  }
  if (entries.length > VOICE_POOL_LINES_MAX) {
    onWarning('pool has more than ' + VOICE_POOL_LINES_MAX + ' lines; extra lines are ignored')
  }
  const pool: string[] = []
  for (const entry of entries.slice(0, VOICE_POOL_LINES_MAX)) {
    if (typeof entry !== 'string') {
      onWarning('non-string pool entry dropped')
      continue
    }
    const line = normalizeLine(entry, kind, onWarning)
    if (line !== undefined) pool.push(line)
  }
  return pool
}

/** Normalize the ordered keyword-rule list ([] disables the keyword channel). */
export function normalizeWhisperRules(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): WhisperRule[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    onWarning('whispers.rules must be an array')
    return undefined
  }
  if (raw.length > VOICE_RULES_MAX) {
    onWarning('whispers.rules has more than ' + VOICE_RULES_MAX + ' rules; extra rules are ignored')
  }
  const rules: WhisperRule[] = []
  for (const item of raw.slice(0, VOICE_RULES_MAX)) {
    if (!isRecord(item)) {
      onWarning('whisper rule must be an object')
      continue
    }
    for (const key of Object.keys(item)) {
      if (key !== 'keywords' && key !== 'pool') onWarning('unknown whisper rule field ' + key + ' ignored')
    }
    const keywordsRaw: unknown = item.keywords
    const keywords: string[] = []
    if (Array.isArray(keywordsRaw)) {
      for (const entry of keywordsRaw.slice(0, VOICE_KEYWORDS_PER_RULE_MAX)) {
        if (typeof entry !== 'string') {
          onWarning('non-string keyword dropped')
          continue
        }
        const trimmed = entry.trim().toLowerCase().slice(0, VOICE_KEYWORD_MAX)
        if (trimmed !== '') keywords.push(trimmed)
      }
      if (keywordsRaw.length > VOICE_KEYWORDS_PER_RULE_MAX) {
        onWarning('rule has more than ' + VOICE_KEYWORDS_PER_RULE_MAX + ' keywords; extra keywords are ignored')
      }
    }
    const pool = normalizePool(item.pool, 'whisperRule', onWarning)
    if (keywords.length === 0 || pool === undefined || pool.length === 0) {
      onWarning('whisper rule dropped (needs keywords and a non-empty pool)')
      continue
    }
    rules.push({ keywords, pool })
  }
  return rules
}

/** Normalize the panel block (labels / stats / actions; warn-and-drop). */
export function normalizePanel(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): PetPanelView | undefined {
  if (!isRecord(raw)) {
    onWarning('panel must be an object')
    return undefined
  }
  const panel: PetPanelView = {}
  const labelsRaw = raw.labels
  if (labelsRaw !== undefined) {
    if (!isRecord(labelsRaw)) {
      onWarning('panel.labels must be an object')
    } else {
      const labels: Record<string, string> = {}
      for (const key of PANEL_LABEL_KEYS) {
        const value = labelsRaw[key]
        if (value === undefined) continue
        if (typeof value !== 'string') {
          onWarning('panel.labels.' + key + ' must be a string')
          continue
        }
        const line = normalizeLine(value, 'label', onWarning)
        if (line !== undefined) labels[key] = line.slice(0, VOICE_LABEL_MAX)
      }
      if (Object.keys(labels).length > 0) panel.labels = labels
    }
  }
  const statsRaw = raw.stats
  if (statsRaw !== undefined) {
    if (!isRecord(statsRaw)) {
      onWarning('panel.stats must be an object')
    } else {
      const stats: Record<string, string> = {}
      for (const key of PANEL_STAT_KEYS) {
        const value = statsRaw[key]
        if (value === undefined) continue
        if (typeof value !== 'string') {
          onWarning('panel.stats.' + key + ' must be a string')
          continue
        }
        const line = normalizeLine(value, 'stat', onWarning)
        if (line !== undefined) stats[key] = line.slice(0, VOICE_STAT_MAX)
      }
      if (Object.keys(stats).length > 0) panel.stats = stats
    }
  }
  const actionsRaw = raw.actions
  if (actionsRaw !== undefined) {
    if (!Array.isArray(actionsRaw)) {
      onWarning('panel.actions must be an array')
    } else {
      const seen = new Set<PanelAction>()
      for (const entry of actionsRaw) {
        if (typeof entry !== 'string' || !(PANEL_ACTIONS as readonly string[]).includes(entry)) {
          onWarning('unknown panel action dropped: ' + String(entry))
          continue
        }
        seen.add(entry as PanelAction)
      }
      // Canonical order, deduplicated; an explicit empty array hides all.
      panel.actions = PANEL_ACTIONS.filter(action => seen.has(action))
    }
  }
  if (panel.labels === undefined && panel.stats === undefined && panel.actions === undefined) return undefined
  return panel
}

/** Voice-pack top-level fields ('$schema' mirrors the schema twin; drift-locked in tests). */
export const VOICE_PACK_KEYS = new Set(['$schema', 'voicePackVersion', 'status', 'tools', 'toolRemaining', 'whispers', 'panel'])

/** Allowed whisper-section fields (drift-locked in tests). */
export const WHISPER_KEYS = new Set(['generic', 'rules'])

/**
 * Normalize one raw voice.json document into a VoicePack, or undefined when
 * the file cannot serve as a pack at all (non-object root — structure is
 * fail-closed per file). Every slot issue is a warning, never a throw.
 */
export function normalizeVoicePack(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): VoicePack | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    onWarning('voice.json must be a JSON object; the file is ignored')
    return undefined
  }
  for (const key of Object.keys(raw)) {
    if (!VOICE_PACK_KEYS.has(key)) onWarning('unknown top-level field ' + key + ' ignored')
  }
  const version = raw.voicePackVersion
  if (version !== undefined && (typeof version !== 'number' || version !== VOICE_PACK_V1)) {
    onWarning('voicePackVersion ' + String(version) + ' is not supported; reading as v1 best-effort')
  }
  const overrides: VoicePackOverrides = {}
  const statusRaw = raw.status
  if (statusRaw !== undefined) {
    if (!isRecord(statusRaw)) {
      onWarning('status must be an object')
    } else {
      for (const key of Object.keys(statusRaw)) {
        if (!(STATUS_SCENES as readonly string[]).includes(key)) {
          onWarning('unknown status scene ' + key + ' ignored')
          continue
        }
        const pool = normalizePool(statusRaw[key], 'status', onWarning)
        if (pool !== undefined && pool.length > 0) {
          overrides.status = { ...overrides.status, [key]: pool }
        }
      }
    }
  }
  const toolsRaw = raw.tools
  if (toolsRaw !== undefined) {
    if (!isRecord(toolsRaw)) {
      onWarning('tools must be an object')
    } else {
      for (const key of Object.keys(toolsRaw)) {
        if (!(TOOL_CATEGORIES as readonly string[]).includes(key)) {
          onWarning('unknown tool family ' + key + ' ignored')
          continue
        }
        const pool = normalizePool(toolsRaw[key], 'tools', onWarning)
        if (pool !== undefined && pool.length > 0) {
          overrides.tools = { ...overrides.tools, [key]: pool }
        }
      }
    }
  }
  const remainingRaw = raw.toolRemaining
  if (remainingRaw !== undefined) {
    const pool = normalizePool(remainingRaw, 'toolRemaining', onWarning)
    if (pool !== undefined && pool.length > 0) overrides.toolRemaining = pool
  }
  const whispersRaw = raw.whispers
  if (whispersRaw !== undefined) {
    if (!isRecord(whispersRaw)) {
      onWarning('whispers must be an object')
    } else {
      for (const key of Object.keys(whispersRaw)) {
        if (!WHISPER_KEYS.has(key)) onWarning('unknown whispers field ' + key + ' ignored')
      }
      const generic = normalizePool(whispersRaw.generic, 'whisperGeneric', onWarning)
      const rules = normalizeWhisperRules(whispersRaw.rules, onWarning)
      if (generic !== undefined || rules !== undefined) {
        overrides.whispers = {
          ...(generic === undefined ? {} : { generic }),
          ...(rules === undefined ? {} : { rules }),
        }
      }
    }
  }
  const panel = raw.panel === undefined ? undefined : normalizePanel(raw.panel, onWarning)
  if (
    overrides.status === undefined && overrides.tools === undefined
    && overrides.toolRemaining === undefined && overrides.whispers === undefined
    && panel === undefined
  ) {
    return undefined
  }
  return {
    overrides,
    ...(panel === undefined ? {} : { panel }),
  }
}

/**
 * Merge voice-pack layers into one pack; later layers win per slot. The
 * built-in pools are NOT a layer here — the chatter engines fall back to
 * them per key at draw time. Merge order for a selected pet:
 * mergeVoicePacks(registry.globalVoice, entry.voice).
 */
export function mergeVoicePacks(...layers: (VoicePack | undefined)[]): VoicePack | undefined {
  const overrides: VoicePackOverrides = {}
  const labels: NonNullable<PetPanelView['labels']> = {}
  const stats: NonNullable<PetPanelView['stats']> = {}
  let actions: PanelAction[] | undefined
  let panelSeen = false
  let any = false
  for (const layer of layers) {
    if (layer === undefined) continue
    any = true
    if (layer.overrides.status !== undefined) {
      overrides.status = { ...overrides.status, ...layer.overrides.status }
    }
    if (layer.overrides.tools !== undefined) {
      overrides.tools = { ...overrides.tools, ...layer.overrides.tools }
    }
    if (layer.overrides.toolRemaining !== undefined) overrides.toolRemaining = layer.overrides.toolRemaining
    if (layer.overrides.whispers !== undefined) {
      overrides.whispers = { ...overrides.whispers, ...layer.overrides.whispers }
    }
    if (layer.panel !== undefined) {
      panelSeen = true
      if (layer.panel.labels !== undefined) Object.assign(labels, layer.panel.labels)
      if (layer.panel.stats !== undefined) Object.assign(stats, layer.panel.stats)
      if (layer.panel.actions !== undefined) actions = layer.panel.actions
    }
  }
  if (!any) return undefined
  const panel: PetPanelView = {
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(actions === undefined ? {} : { actions }),
  }
  const panelEmpty = panel.labels === undefined && panel.stats === undefined && panel.actions === undefined
  return {
    overrides,
    ...(panelSeen && !panelEmpty ? { panel } : {}),
  }
}
