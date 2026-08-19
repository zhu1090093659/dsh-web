import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nextRunAtMs, parseCron } from '../src/core/schedule.ts'

const originalTimeZone = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})

afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
})

describe('Host-local cron across daylight-saving transitions', () => {
  it('skips a nonexistent spring-forward local minute', () => {
    const beforeGap = new Date(2026, 2, 8, 1, 59).getTime()
    expect(nextRunAtMs('30 2 * * *', beforeGap)).toBe(new Date(2026, 2, 9, 2, 30).getTime())
  })

  it('does not replay the repeated fall-back local minute', () => {
    const afterFirstOccurrence = new Date(2026, 10, 1, 1, 31).getTime()
    expect(nextRunAtMs('30 1 * * *', afterFirstOccurrence)).toBe(new Date(2026, 10, 2, 1, 30).getTime())
  })

  it('matches an independent day-granular reference around both transitions', () => {
    const froms = [
      new Date(2026, 2, 7, 23, 0).getTime(),
      new Date(2026, 2, 8, 1, 59).getTime(),
      new Date(2026, 10, 31, 23, 0).getTime(),
      new Date(2026, 10, 1, 1, 31).getTime(),
      new Date(2026, 10, 1, 0, 30).getTime(),
    ]
    const crons = ['30 2 * * *', '30 1 * * *', '* 2 * * *', '0 3 * * *', '*/15 1 * * *']
    for (const expr of crons) {
      for (const fromMs of froms) {
        expect(nextRunAtMs(expr, fromMs), `${expr} from ${new Date(fromMs).toString()}`).toBe(referenceScan(expr, fromMs))
      }
    }
  })
})

/**
 * Independent fast behavioural reference: walks calendar days inside the
 * same five-year horizon (never scanning minutes), and for each matching day
 * picks the earliest matching hour/minute strictly after `fromMs`. Wall-clock
 * field construction plus the hour/minute re-check reproduce the production
 * implementation's DST semantics without sharing its control flow.
 */
function referenceScan(expr: string, fromMs: number): number | undefined {
  const schedule = parseCron(expr)
  if (schedule === null) return undefined
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
