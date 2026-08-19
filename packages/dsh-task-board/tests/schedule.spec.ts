/**
 * Cron parser + next-run tests: expression validity, field-set parsing, and
 * next-run computation across minute/day/month/weekday boundaries.
 */
import { describe, expect, it } from 'vitest'
import { isValidCron, nextRunAtMs, parseCron } from '../src/core/schedule.ts'

/** Local-time ms epoch helper. */
function at(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

describe('isValidCron', () => {
  it('accepts well-formed expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true)
    expect(isValidCron('*/5 * * * *')).toBe(true)
    expect(isValidCron('0 9 * * 1')).toBe(true)
    expect(isValidCron('1,15,30 * * * *')).toBe(true)
    expect(isValidCron('0 0 1 1 *')).toBe(true)
    expect(isValidCron('0 8-18/2 * * *')).toBe(true)
    expect(isValidCron('  0  9  *  *  *  ')).toBe(true) // padded whitespace
  })

  it('rejects malformed expressions', () => {
    expect(isValidCron('')).toBe(false)
    expect(isValidCron('   ')).toBe(false)
    expect(isValidCron('* * * *')).toBe(false) // four fields
    expect(isValidCron('* * * * * *')).toBe(false) // six fields
    expect(isValidCron('60 * * * *')).toBe(false) // minutes out of range
    expect(isValidCron('* 24 * * *')).toBe(false) // hours out of range
    expect(isValidCron('* * 0 * *')).toBe(false) // days out of range
    expect(isValidCron('* * * 13 *')).toBe(false) // months out of range
    expect(isValidCron('* * * * 8')).toBe(false) // weekdays out of range
    expect(isValidCron('a b c d e')).toBe(false)
    expect(isValidCron('* * * * */0')).toBe(false) // zero step
    expect(isValidCron('5-1 * * * *')).toBe(false) // inverted range
  })
})

describe('parseCron', () => {
  it('parses wildcard fields into full sets', () => {
    const schedule = parseCron('* * * * *')!
    expect(schedule.minutes.size).toBe(60)
    expect(schedule.hours.size).toBe(24)
    expect(schedule.days.size).toBe(31)
    expect(schedule.months.size).toBe(12)
    expect(schedule.weekdays.size).toBe(7)
  })

  it('parses steps, ranges, and lists', () => {
    const stepped = parseCron('*/15 * * * *')!
    expect([...stepped.minutes]).toEqual([0, 15, 30, 45])
    const ranged = parseCron('* 1-5 * * *')!
    expect([...ranged.hours]).toEqual([1, 2, 3, 4, 5])
    const listed = parseCron('1,15,30 * * * *')!
    expect([...listed.minutes]).toEqual([1, 15, 30])
    const mixed = parseCron('1,30-45/5 * * * *')!
    expect([...mixed.minutes]).toEqual([1, 30, 35, 40, 45])
  })

  it('normalizes weekday 7 to 0 (Sunday)', () => {
    expect([...(parseCron('* * * * 7')!.weekdays)]).toEqual([0])
    expect([...(parseCron('* * * * 0')!.weekdays)]).toEqual([0])
    const both = parseCron('* * * * 0,7')!
    expect([...both.weekdays]).toEqual([0])
  })

  it('returns null for invalid input', () => {
    expect(parseCron('')).toBeNull()
    expect(parseCron('* * * *')).toBeNull()
    expect(parseCron('61 * * * *')).toBeNull()
  })
})

describe('nextRunAtMs', () => {
  it('fires every minute, strictly after the from instant', () => {
    expect(nextRunAtMs('* * * * *', at(2026, 1, 1, 10, 0, 30))).toBe(at(2026, 1, 1, 10, 1, 0))
    // Already exactly on a minute boundary → the next minute.
    expect(nextRunAtMs('* * * * *', at(2026, 1, 1, 10, 0, 0))).toBe(at(2026, 1, 1, 10, 1, 0))
  })

  it('honours step expressions', () => {
    expect(nextRunAtMs('*/5 * * * *', at(2026, 1, 1, 10, 0, 30))).toBe(at(2026, 1, 1, 10, 5, 0))
    expect(nextRunAtMs('*/5 * * * *', at(2026, 1, 1, 10, 3, 0))).toBe(at(2026, 1, 1, 10, 5, 0))
  })

  it('crosses day boundaries for a fixed time', () => {
    expect(nextRunAtMs('0 9 * * *', at(2026, 1, 1, 8, 59))).toBe(at(2026, 1, 1, 9, 0))
    expect(nextRunAtMs('0 9 * * *', at(2026, 1, 1, 9, 1))).toBe(at(2026, 1, 2, 9, 0))
  })

  it('crosses month boundaries', () => {
    expect(nextRunAtMs('0 0 1 * *', at(2026, 1, 15, 0, 0))).toBe(at(2026, 2, 1, 0, 0))
    expect(nextRunAtMs('0 0 1 12 *', at(2026, 6, 1, 0, 0))).toBe(at(2026, 12, 1, 0, 0))
  })

  it('matches weekdays (0 and 7 both Sunday)', () => {
    // 2026-01-01 is a Thursday.
    expect(nextRunAtMs('0 9 * * 1', at(2026, 1, 1, 0, 0))).toBe(at(2026, 1, 5, 9, 0))
    expect(nextRunAtMs('0 9 * * 0', at(2026, 1, 1, 0, 0))).toBe(at(2026, 1, 4, 9, 0))
    expect(nextRunAtMs('0 9 * * 7', at(2026, 1, 1, 0, 0))).toBe(at(2026, 1, 4, 9, 0))
  })

  it('combines restricted day and weekday fields with OR semantics', () => {
    // Monday 2026-01-05: the weekday matches even though the day (15) does not.
    expect(nextRunAtMs('0 9 15 * 1', at(2026, 1, 5, 0, 0))).toBe(at(2026, 1, 5, 9, 0))
    // Friday 2026-01-16 with only day 15 → next month's 15th.
    expect(nextRunAtMs('0 9 15 * *', at(2026, 1, 16, 0, 0))).toBe(at(2026, 2, 15, 9, 0))
  })

  it('treats an explicit day range as restricted, not the * wildcard', () => {
    // "1-31" enumerates every day but is NOT the * wildcard: combined with a
    // restricted weekday (Monday) the OR semantics fire every day, so the very
    // first 9:00 (Thursday 2026-01-01) matches. Treating 1-31 as * would
    // incorrectly defer to the next Monday (2026-01-05).
    expect(nextRunAtMs('0 9 1-31 * 1', at(2026, 1, 1, 0, 0))).toBe(at(2026, 1, 1, 9, 0))
  })

  it('does not collapse a numeric day into the * wildcard', () => {
    // Day 31 only: the 31st, never every day.
    expect(nextRunAtMs('0 9 31 * *', at(2026, 1, 1, 0, 0))).toBe(at(2026, 1, 31, 9, 0))
  })

  it('returns undefined for impossible dates (Feb 30)', () => {
    expect(nextRunAtMs('0 0 30 2 *', at(2026, 1, 1, 0, 0))).toBeUndefined()
  })

  it('finds a leap-day occurrence beyond the old one-year scan horizon', () => {
    expect(nextRunAtMs('0 0 29 2 *', at(2025, 3, 1, 0, 0))).toBe(at(2028, 2, 29, 0, 0))
  })

  it('returns undefined for invalid expressions', () => {
    expect(nextRunAtMs('not a cron', at(2026, 1, 1, 0, 0))).toBeUndefined()
  })

  it('matches an independent day-granular reference across sparse and dense schedules', () => {
    const crons = [
      '* * * * *',
      '*/5 * * * *',
      '0 9 * * *',
      '0 9 * * 1',
      '0 9 15 * 1',
      '0 9 1-31 * 1',
      '0 0 1 * *',
      '30 2 * * *',
      '0 0 29 2 *',
      '0 0 31 12 *',
      '15 8-18/3 * * *',
      '0 9 * 2 1',
      '0 0 1 */2 *',
      '0 0 30 2 *',
    ]
    const froms = [
      at(2026, 1, 1, 0, 0),
      at(2026, 1, 1, 10, 30),
      at(2026, 6, 15, 12, 0),
      at(2025, 3, 1, 0, 0),
      at(2026, 12, 31, 23, 59),
      at(2027, 2, 28, 23, 59),
    ]
    for (const expr of crons) {
      for (const fromMs of froms) {
        expect(nextRunAtMs(expr, fromMs), `${expr} from ${new Date(fromMs).toISOString()}`).toBe(referenceNextRunAtMs(expr, fromMs))
      }
    }
  })
})

/**
 * Independent fast behavioural reference: walks calendar days inside the
 * same five-year horizon (never scanning minutes), and for each matching day
 * picks the earliest matching hour/minute strictly after `fromMs`. Wall-clock
 * field construction plus the hour/minute re-check reproduce the production
 * implementation's DST semantics without sharing its control flow, so the
 * two implementations still cross-check each other.
 */
function referenceNextRunAtMs(expr: string, fromMs: number): number | undefined {
  const schedule = parseCron(expr)
  if (schedule === null) return undefined
  if (!schedule.dayWildcard && schedule.weekdayWildcard) {
    const maximumDay = new Map<number, number>([
      [1, 31], [2, 29], [3, 31], [4, 30], [5, 31], [6, 30],
      [7, 31], [8, 31], [9, 30], [10, 31], [11, 30], [12, 31],
    ])
    const possible = [...schedule.months].some(month => [...schedule.days].some(day => day <= (maximumDay.get(month) ?? 0)))
    if (!possible) return undefined
  }
  const from = new Date(fromMs)
  const limitMs = fromMs + 5 * 366 * 24 * 60 * 60 * 1000
  const hours = [...schedule.hours].sort((a, b) => a - b)
  const minutes = [...schedule.minutes].sort((a, b) => a - b)
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0)
  for (let offset = 0; ; offset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 0, 0, 0, 0)
    if (day.getTime() > limitMs) return undefined
    if (!schedule.months.has(day.getMonth() + 1)) continue
    const dayMatches = schedule.days.has(day.getDate())
    const weekdayMatches = schedule.weekdays.has(day.getDay())
    const matchesDay = schedule.dayWildcard ? weekdayMatches : schedule.weekdayWildcard ? dayMatches : dayMatches || weekdayMatches
    if (!matchesDay) continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0)
        // Wall-clock re-check: a nonexistent spring-forward time normalizes
        // forward, so the constructed fields must equal the intended ones.
        if (candidate.getHours() !== hour || candidate.getMinutes() !== minute) continue
        const time = candidate.getTime()
        if (time <= fromMs) continue
        if (time > limitMs) return undefined
        return time
      }
    }
  }
}
