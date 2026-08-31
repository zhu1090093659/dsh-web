import { describe, expect, it } from 'vitest'
import { hudAlertReason, type PerfTranslate } from '../src/client/perf-alert'
import { en, zh } from '../src/client/perf-locales'

/** Translate seat stub: records the key + params, echoes a deterministic string. */
function makeT(locale: Record<string, string>): { t: PerfTranslate; calls: { key: string; params?: Record<string, unknown> }[] } {
  const calls: { key: string; params?: Record<string, unknown> }[] = []
  const t: PerfTranslate = (key, params) => {
    calls.push({ key, params })
    let out = locale[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) out = out.replaceAll(`{${name}}`, String(value))
    return out
  }
  return { t, calls }
}

describe('hudAlertReason', () => {
  it('returns undefined without an alert block', () => {
    const { t } = makeT(zh)
    expect(hudAlertReason(undefined, t)).toBeUndefined()
    expect(hudAlertReason(null, t)).toBeUndefined()
  })

  it('formats the session alert through the dictionary placeholders', () => {
    const { t, calls } = makeT(zh)
    expect(hudAlertReason({ kind: 'sessions', activeSessions: 7, maxSessions: 5 }, t)).toBe('会话 7 个 ≥ 阈值 5')
    expect(calls[0]?.key).toBe('hud.alert.sessions')
    expect(calls[0]?.params).toEqual({ count: 7, max: 5 })
  })

  it('formats the events alert with the per-second count', () => {
    const { t } = makeT(en)
    expect(hudAlertReason({ kind: 'events', eventsPerSec: 412, maxEventsPerSec: 300 }, t)).toBe('Events 412/s ≥ threshold 300')
  })

  it('falls back to the both-over copy and degrades missing numbers to ?', () => {
    const { t } = makeT(zh)
    expect(hudAlertReason({ kind: 'both' }, t)).toBe('会话与事件均超阈值')
    expect(hudAlertReason({ kind: 'sessions' }, t)).toBe('会话 ? 个 ≥ 阈值 ?')
    expect(hudAlertReason({ kind: 'events' }, t)).toBe('事件 ?/s ≥ 阈值 ?')
  })

  it('uses the same keys the zh and en dictionaries define (placeholder parity)', () => {
    for (const key of ['hud.alert.sessions', 'hud.alert.events', 'hud.alert.both']) {
      expect(Object.keys(en)).toContain(key)
      expect(Object.keys(zh)).toContain(key)
    }
  })
})
