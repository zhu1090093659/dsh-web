import { describe, expect, it } from 'vitest'
import { autoArchiveCandidates, autoDeleteSeedCandidates, DAY_MS } from '../src/core/auto-rules.ts'
import { DEFAULT_AUTO_CONFIG, readArchiveConfig, resolveAutoConfig, validateDays } from '../src/core/config.ts'
import type { ArchiveSessionRow } from '../src/core/types.ts'

function row(overrides: Partial<ArchiveSessionRow> & { id: string }): ArchiveSessionRow {
  return {
    workspaceIds: [],
    archived: false,
    lastActivityReliable: true,
    running: false,
    blank: false,
    childIds: [],
    childCount: 0,
    issues: [],
    ...overrides,
  }
}

describe('auto-archive candidates', () => {
  const now = 1_000_000_000_000

  it('selects by last-activity, not creation time', () => {
    const rows = [
      // Created long ago but active recently: NOT a candidate.
      row({ id: 'session-fresh', createdAt: now - 100 * DAY_MS, lastActivityAt: now - 1 * DAY_MS }),
      // Created recently but inactive long: IS a candidate.
      row({ id: 'session-stale', createdAt: now - 2 * DAY_MS, lastActivityAt: now - 40 * DAY_MS }),
    ]
    const candidates = autoArchiveCandidates(rows, { days: 30, now, protectedIds: new Set() })
    expect(candidates.map((entry) => entry.id)).toEqual(['session-stale'])
  })

  it('never selects sessions with unreliable last activity', () => {
    const rows = [
      row({ id: 'session-noact', lastActivityReliable: false, lastActivityAt: undefined }),
      row({ id: 'session-unreliable', lastActivityReliable: false, lastActivityAt: now - 100 * DAY_MS }),
    ]
    expect(autoArchiveCandidates(rows, { days: 30, now, protectedIds: new Set() })).toEqual([])
  })

  it('never selects archived or protected sessions', () => {
    const rows = [
      row({ id: 'session-arch', archived: true, lastActivityAt: now - 100 * DAY_MS }),
      row({ id: 'session-run', running: true, lastActivityAt: now - 100 * DAY_MS }),
    ]
    const candidates = autoArchiveCandidates(rows, { days: 30, now, protectedIds: new Set(['session-run']) })
    expect(candidates).toEqual([])
  })
})

describe('auto-delete seed candidates', () => {
  const now = 1_000_000_000_000

  it('selects archived sessions past retention by ARCHIVE time', () => {
    const rows = [
      row({ id: 'session-old', archived: true, archivedAt: now - 100 * DAY_MS, lastActivityAt: now - 1 * DAY_MS, sizeBytes: 50 }),
      row({ id: 'session-new', archived: true, archivedAt: now - 5 * DAY_MS, lastActivityAt: now - 100 * DAY_MS }),
    ]
    const seeds = autoDeleteSeedCandidates(rows, { retainDays: 90, now, runStartedAt: now, protectedIds: new Set() })
    expect(seeds.map((entry) => entry.id)).toEqual(['session-old'])
    expect(seeds[0]?.sizeBytes).toBe(50)
  })

  it('excludes sessions with UNKNOWN archive time (historical archives)', () => {
    const rows = [row({ id: 'session-hist', archived: true, lastActivityAt: now - 100 * DAY_MS })]
    expect(autoDeleteSeedCandidates(rows, { retainDays: 90, now, runStartedAt: now, protectedIds: new Set() })).toEqual([])
  })

  it('excludes sessions archived at or after the run start (same-tick guard)', () => {
    const rows = [
      row({ id: 'session-just', archived: true, archivedAt: now, lastActivityAt: now - DAY_MS }),
      row({ id: 'session-edge', archived: true, archivedAt: now - 100 * DAY_MS }),
    ]
    const seeds = autoDeleteSeedCandidates(rows, { retainDays: 90, now, runStartedAt: now, protectedIds: new Set() })
    expect(seeds.map((entry) => entry.id)).toEqual(['session-edge'])
  })

  it('excludes protected sessions', () => {
    const rows = [row({ id: 'session-x', archived: true, archivedAt: now - 100 * DAY_MS })]
    expect(autoDeleteSeedCandidates(rows, { retainDays: 90, now, runStartedAt: now, protectedIds: new Set(['session-x']) })).toEqual([])
  })
})

describe('config', () => {
  it('defaults both automatic policies OFF', () => {
    expect(DEFAULT_AUTO_CONFIG.autoArchiveEnabled).toBe(false)
    expect(DEFAULT_AUTO_CONFIG.autoDeleteEnabled).toBe(false)
    expect(resolveAutoConfig(undefined).autoArchiveEnabled).toBe(false)
    expect(resolveAutoConfig(undefined).autoDeleteEnabled).toBe(false)
  })

  it('falls back to defaults for invalid day values', () => {
    expect(resolveAutoConfig({ autoArchiveDays: 0 }).autoArchiveDays).toBe(7)
    expect(resolveAutoConfig({ autoArchiveDays: 99999 }).autoArchiveDays).toBe(7)
    expect(resolveAutoConfig({ autoDeleteDays: Number.NaN }).autoDeleteDays).toBe(7)
    expect(resolveAutoConfig({ checkIntervalMin: 1 }).checkIntervalMin).toBe(60)
  })

  it('accepts valid values and rounds fractional days', () => {
    expect(resolveAutoConfig({ autoArchiveDays: 7.4 }).autoArchiveDays).toBe(7)
    expect(validateDays(3650, 1, 3650)).toBe(3650)
    expect(validateDays('30', 1, 3650)).toBeUndefined()
  })

  it('admin reads a committed volatile field at call time', () => {
    // Given an activation whose day threshold arrived as a volatile reference
    let committed = 30
    const field = { get: () => committed }
    const first = readArchiveConfig({ autoArchiveDays: field }).autoArchiveDays

    // When the Host commits a settings write into that reference
    committed = 45

    // Then the next read sees the committed value, not the activation-time one
    expect(first).toBe(30)
    expect(readArchiveConfig({ autoArchiveDays: field }).autoArchiveDays).toBe(45)
  })

  it('admin whose row carries plain values reads them unchanged', () => {
    // Given a profile patch that passed this plugin plain config values
    // When the activation config is read
    // Then every plain value flows through for the resolver to validate
    expect(readArchiveConfig({ enabled: false, autoArchiveDays: 30, checkIntervalMin: 120 }))
      .toEqual({ enabled: false, autoArchiveDays: 30, checkIntervalMin: 120 })
  })
})
