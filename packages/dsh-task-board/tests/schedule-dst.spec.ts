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

  it('matches the legacy minute scan around both transitions', () => {
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

/** Legacy minute scan reference (wall-clock field stepping). */
function referenceScan(expr: string, fromMs: number): number | undefined {
  const schedule = parseCron(expr)
  if (schedule === null) return undefined
  const from = new Date(fromMs)
  const scan = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0)
  const limitMs = fromMs + 5 * 366 * 24 * 60 * 60 * 1000
  while (scan.getTime() <= limitMs) {
    const dayMatches = schedule.days.has(scan.getDate())
    const weekdayMatches = schedule.weekdays.has(scan.getDay())
    const matchesDay = schedule.dayWildcard ? weekdayMatches : schedule.weekdayWildcard ? dayMatches : dayMatches || weekdayMatches
    if (schedule.minutes.has(scan.getMinutes()) && schedule.hours.has(scan.getHours())
      && schedule.months.has(scan.getMonth() + 1) && matchesDay) {
      return scan.getTime()
    }
    scan.setMinutes(scan.getMinutes() + 1)
  }
  return undefined
}
