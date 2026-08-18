import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { nextRunAtMs } from '../src/core/schedule.ts'

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
})
