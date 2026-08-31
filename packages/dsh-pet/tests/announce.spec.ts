import { describe, expect, it } from 'vitest'
import { ANNOUNCE_DEFAULT_TTL_MS, ANNOUNCE_MAX_TTL_MS, announcementFresh, parseAnnouncement } from '../src/announce.ts'

const NOW = 1_788_000_000_000

describe('parseAnnouncement', () => {
  it('accepts a balance payload and bounds its fields', () => {
    const parsed = parseAnnouncement({
      source: 'dsh-usage', kind: 'balance', title: 'DeepSeek', amount: '¥110.00', tone: 'ok',
      unknownField: { drop: 'me' },
    }, NOW)
    expect(parsed).toMatchObject({ source: 'dsh-usage', kind: 'balance', title: 'DeepSeek', amount: '¥110.00', tone: 'ok', ttlMs: ANNOUNCE_DEFAULT_TTL_MS, at: NOW })
    expect(parsed && 'unknownField' in parsed).toBe(false)
  })

  it('accepts a cost payload with its period note', () => {
    const parsed = parseAnnouncement({
      source: 'dsh-usage', kind: 'cost', title: 'DeepSeek', amount: '今日 ¥12.35', note: '高峰时段 计价×2 · 余额 ¥1109.95', tone: 'warn',
    }, NOW)
    expect(parsed).toMatchObject({ kind: 'cost', title: 'DeepSeek', amount: '今日 ¥12.35', tone: 'warn' })
    expect(parseAnnouncement({ source: 's', kind: 'cost', title: 'missing amount' }, NOW)).toBeUndefined()
  })

  it('accepts a plan payload and clamps percent, keeping an in-range poll-cadence ttl', () => {
    const parsed = parseAnnouncement({ source: 'dsh-usage', kind: 'plan', title: 'Kimi', percent: 150, resetAt: '2026-08-31T00:00:00Z', ttlMs: 999_999 }, NOW)
    expect(parsed?.percent).toBe(100)
    expect(parsed?.ttlMs).toBe(999_999)
    // An always-mode announcer declares its poll cadence; only the hard
    // ceiling (one missed refresh cycle at most) clamps.
    expect(parseAnnouncement({ source: 's', kind: 'plan', title: 't', percent: 5, ttlMs: ANNOUNCE_MAX_TTL_MS + 1 }, NOW)?.ttlMs).toBe(ANNOUNCE_MAX_TTL_MS)
    const tiny = parseAnnouncement({ source: 's', kind: 'plan', title: 't', percent: 5, ttlMs: 1 }, NOW)
    expect(tiny?.ttlMs).toBe(1000)
  })

  it('truncates oversized text', () => {
    const parsed = parseAnnouncement({ source: 'dsh-usage', kind: 'balance', title: 'x'.repeat(200), amount: 'y'.repeat(300) }, NOW)
    expect(parsed?.title).toHaveLength(80)
    expect(parsed?.amount).toHaveLength(120)
  })

  it('rejects malformed payloads', () => {
    expect(parseAnnouncement(undefined, NOW)).toBeUndefined()
    expect(parseAnnouncement('nope', NOW)).toBeUndefined()
    expect(parseAnnouncement({ kind: 'balance', title: 'no source' }, NOW)).toBeUndefined()
    expect(parseAnnouncement({ source: 's', kind: 'balance', title: 'missing amount' }, NOW)).toBeUndefined()
    expect(parseAnnouncement({ source: 's', kind: 'plan', title: 'missing percent' }, NOW)).toBeUndefined()
    expect(parseAnnouncement({ source: 's', kind: 'other', title: 'bad kind', amount: '1' }, NOW)).toBeUndefined()
    expect(parseAnnouncement({ source: 's', kind: 'balance', title: 42, amount: '1' }, NOW)).toBeUndefined()
  })
})

describe('announcementFresh', () => {
  it('honors the ttl window', () => {
    const base = { source: 's', kind: 'balance' as const, title: 't', tone: 'ok' as const, ttlMs: 5000, at: NOW }
    expect(announcementFresh(base, NOW + 4999)).toBe(true)
    expect(announcementFresh(base, NOW + 5000)).toBe(false)
  })
})
