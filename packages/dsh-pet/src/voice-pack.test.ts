/**
 * Voice-pack unit tests (pet-center M4, issue #677): normalization rules
 * (structure fail-closed per file, content warn-and-drop per slot), the
 * per-kind placeholder whitelists, and the layer merge precedence
 * (later layers win per slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  mergeVoicePacks,
  normalizePanel,
  normalizePool,
  normalizeVoicePack,
  normalizeWhisperRules,
  PANEL_ACTIONS,
  PANEL_LABEL_KEYS,
  PANEL_STAT_KEYS,
  VOICE_LINE_MAX,
  VOICE_PACK_KEYS,
  VOICE_PACK_V1,
  WHISPER_KEYS,
} from './voice-pack.ts'
import { STATUS_SCENES, TOOL_CATEGORIES } from './chatter.ts'
import { petPackageRoot } from './registry.ts'

function collectWarnings(pack: unknown): { pack: ReturnType<typeof normalizeVoicePack>; warnings: string[] } {
  const warnings: string[] = []
  const result = normalizeVoicePack(pack, message => warnings.push(message))
  return { pack: result, warnings }
}

describe('normalizeVoicePack structure', () => {
  it('accepts a minimal pack and drops it when nothing usable remains', () => {
    expect(normalizeVoicePack({})).toBeUndefined()
    expect(normalizeVoicePack({ status: { done: ['收工'] } })).toBeDefined()
  })

  it('rejects a non-object root with a warning (fail-closed per file)', () => {
    const { pack, warnings } = collectWarnings(['not', 'an', 'object'])
    expect(pack).toBeUndefined()
    expect(warnings[0]).toContain('must be a JSON object')
  })

  it('warns on unknown top-level fields and unknown voicePackVersion', () => {
    const { pack, warnings } = collectWarnings({
      voicePackVersion: 99,
      mystery: true,
      status: { done: ['收工'] },
    })
    expect(pack).toBeDefined()
    expect(warnings.join('\n')).toContain('mystery')
    expect(warnings.join('\n')).toContain('voicePackVersion')
  })
})

describe('normalizePool', () => {
  it('accepts a single string and arrays, dropping non-string entries', () => {
    const warnings: string[] = []
    expect(normalizePool('一行', 'status', m => warnings.push(m))).toEqual(['一行'])
    expect(normalizePool(['一', 7, '二'], 'status', m => warnings.push(m))).toEqual(['一', '二'])
    expect(warnings.join('\n')).toContain('non-string')
  })

  it('caps pool length and truncates long lines', () => {
    const lines = Array.from({ length: 80 }, (_, i) => '行' + i)
    const warnings: string[] = []
    const pool = normalizePool(lines, 'status', m => warnings.push(m))
    expect(pool).toHaveLength(64)
    expect(warnings.join('\n')).toContain('extra lines')
    expect(normalizePool(['x'.repeat(500)], 'status')?.[0]).toHaveLength(VOICE_LINE_MAX)
  })

  it('drops lines carrying placeholders the pool kind does not allow', () => {
    const warnings: string[] = []
    const pool = normalizePool(['好的 {tool}', '干净的'], 'status', m => warnings.push(m))
    expect(pool).toEqual(['干净的'])
    expect(warnings.join('\n')).toContain('unsupported placeholder')
  })

  it('keeps allowed placeholders per kind', () => {
    expect(normalizePool(['跑 {hint}', '用 {tool}'], 'tools')![0]).toBe('跑 {hint}')
    expect(normalizePool(['还有 {n} 个'], 'toolRemaining')![0]).toBe('还有 {n} 个')
    expect(normalizePool(['好感 {rank}'], 'stat')![0]).toBe('好感 {rank}')
  })

  it('preserves an explicit empty array (mute semantics) but not absent', () => {
    expect(normalizePool([], 'whisperGeneric')).toEqual([])
    expect(normalizePool(undefined, 'whisperGeneric')).toBeUndefined()
  })
})

describe('normalizeWhisperRules', () => {
  it('lowercases and trims keywords, drops unusable rules', () => {
    const warnings: string[] = []
    const rules = normalizeWhisperRules([
      { keywords: ['  测试通过  ', 7], pool: ['全绿'] },
      { keywords: [], pool: ['没有关键词'] },
      { keywords: ['有词'], pool: [] },
    ], m => warnings.push(m))
    expect(rules).toEqual([{ keywords: ['测试通过'], pool: ['全绿'] }])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('caps the rule count and keyword count', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ keywords: ['k' + i], pool: ['p'] }))
    expect(normalizeWhisperRules(many)).toHaveLength(32)
    expect(normalizeWhisperRules([{ keywords: Array.from({ length: 20 }, (_, i) => 'k' + i), pool: ['p'] }])![0]!.keywords).toHaveLength(16)
  })

  it('returns an explicit empty array (disables the keyword channel)', () => {
    expect(normalizeWhisperRules([])).toEqual([])
  })
})

describe('normalizePanel', () => {
  it('normalizes labels, stats and the action subset', () => {
    const panel = normalizePanel({
      labels: { feed: '投喂', confirm: '好的', bogus: 'x' },
      stats: { rank: '好感 {rank}', points: '{points} 分' },
      actions: ['hide', 'feed', 'hide', 'bogus'],
    })
    expect(panel?.labels).toEqual({ feed: '投喂', confirm: '好的' })
    expect(panel?.stats).toEqual({ rank: '好感 {rank}', points: '{points} 分' })
    expect(panel?.actions).toEqual(['feed', 'hide'])
  })

  it('rejects non-string labels and labels carrying placeholders', () => {
    const warnings: string[] = []
    const panel = normalizePanel({ labels: { feed: 3, rename: '改名 {tool}' } }, m => warnings.push(m))
    expect(panel?.labels).toBeUndefined()
    expect(warnings.length).toBe(2)
  })

  it('keeps an explicit empty action list (hides every action)', () => {
    expect(normalizePanel({ actions: [] })?.actions).toEqual([])
  })
})

describe('mergeVoicePacks', () => {
  it('merges per-key with later layers winning', () => {
    const global = normalizeVoicePack({
      status: { done: ['全局收工'], thinking: ['全局思考'] },
      panel: { labels: { feed: '全局投喂' } },
    })
    const pet = normalizeVoicePack({
      status: { done: ['宠物收工'] },
      panel: { labels: { feed: '宠物投喂', hide: '宠物藏' } },
    })
    const merged = mergeVoicePacks(global, pet)
    expect(merged?.overrides.status?.done).toEqual(['宠物收工'])
    expect(merged?.overrides.status?.thinking).toEqual(['全局思考'])
    expect(merged?.panel?.labels).toEqual({ feed: '宠物投喂', hide: '宠物藏' })
  })

  it('lets the pet pack replace whisper sections while the global stays', () => {
    const global = normalizeVoicePack({ whispers: { generic: ['全局碎碎念'] } })
    const pet = normalizeVoicePack({ whispers: { rules: [{ keywords: ['测试'], pool: ['宠物全绿'] }] } })
    const merged = mergeVoicePacks(global, pet)
    expect(merged?.overrides.whispers?.generic).toEqual(['全局碎碎念'])
    expect(merged?.overrides.whispers?.rules).toEqual([{ keywords: ['测试'], pool: ['宠物全绿'] }])
  })

  it('returns undefined when every layer is empty', () => {
    expect(mergeVoicePacks(undefined, undefined)).toBeUndefined()
  })
})

describe('normalizeVoicePack schema twin', () => {
  it('accepts the $schema field without a warning', () => {
    const { pack, warnings } = collectWarnings({
      $schema: 'http://json-schema.org/draft-07/schema#',
      status: { done: ['收工'] },
    })
    expect(pack).toBeDefined()
    expect(warnings).toEqual([])
  })

  it('drops the tail when the length cap cuts a placeholder token in half', () => {
    const line = 'x'.repeat(155) + '{tool}'
    const { pack, warnings } = collectWarnings({ tools: { shell: [line] } })
    expect(pack?.overrides.tools?.shell).toEqual(['x'.repeat(155)])
    expect(warnings.some(w => w.includes('unterminated placeholder'))).toBe(true)
  })
})

describe('voice-pack schema file drift lock', () => {
  const schema = JSON.parse(readFileSync(
    join(petPackageRoot(import.meta.url), 'contracts', 'voice-pack-v1.schema.json'),
    'utf8',
  )) as {
    properties: Record<string, { const?: number; properties?: Record<string, unknown>; items?: { enum?: string[] } }>
  }

  it('locks the schema top-level fields to the validator allow-list', () => {
    expect(new Set(Object.keys(schema.properties))).toEqual(VOICE_PACK_KEYS)
  })

  it('locks the scene, tool, whisper and panel key sets', () => {
    const props = schema.properties
    expect(new Set(Object.keys(props.status?.properties ?? {}))).toEqual(new Set(STATUS_SCENES))
    expect(new Set(Object.keys(props.tools?.properties ?? {}))).toEqual(new Set(TOOL_CATEGORIES))
    expect(new Set(Object.keys(props.whispers?.properties ?? {}))).toEqual(WHISPER_KEYS)
    const panel = props.panel?.properties ?? {}
    const labels = (panel.labels as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    const stats = (panel.stats as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    expect(new Set(Object.keys(labels))).toEqual(new Set(PANEL_LABEL_KEYS))
    expect(new Set(Object.keys(stats))).toEqual(new Set(PANEL_STAT_KEYS))
    const actions = (panel.actions as { items?: { enum?: string[] } } | undefined)
    expect(actions?.items?.enum).toEqual([...PANEL_ACTIONS])
  })

  it('keeps the schema version const in sync', () => {
    expect(schema.properties.voicePackVersion?.const).toBe(VOICE_PACK_V1)
  })
})
