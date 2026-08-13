/**
 * Market-session state for the trading skin status bar: A-share, HK and US
 * trading hours computed in their own timezones. Pure functions over a Date
 * — the status bar renders a cell per market (盘中 / 午休 / 盘前 / 休市).
 *
 * Boundaries (weekdays only; exchange holidays are not modeled — a closed
 * holiday still reads as an open session, which is acceptable for a status
 * ornament):
 *   A-share (Asia/Shanghai): 09:30-11:30 + 13:00-15:00, lunch 11:30-13:00
 *   HK      (Asia/Hong_Kong): 09:30-12:00 + 13:00-16:00, lunch 12:00-13:00
 *   US      (America/New_York): 09:30-16:00, pre-market 04:00-09:30
 */

/** One market's session phase. */
export type SessionPhase = 'trading' | 'lunch' | 'pre' | 'closed'

/** Session phases for the three markets, keyed by market. */
export interface MarketSessions {
  aShare: SessionPhase
  hk: SessionPhase
  us: SessionPhase
}

/** Weekday in the target timezone ('Mon'..'Sun'). */
function tzWeekday(timeZone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date)
}

/** Minutes since midnight in the target timezone. */
function tzMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Is `now` a weekday in `timeZone`? */
function isWeekday(timeZone: string, now: Date): boolean {
  const day = tzWeekday(timeZone, now)
  return day !== 'Sat' && day !== 'Sun'
}

/** Phase for one continuous-session market. */
function continuousPhase(
  minutes: number, open: number, close: number, preOpen?: number,
): SessionPhase {
  if (minutes >= open && minutes < close) return 'trading'
  if (preOpen !== undefined && minutes >= preOpen && minutes < open) return 'pre'
  return 'closed'
}

/** Phase for a split-session market (A-share, HK). */
function splitPhase(minutes: number, open: number, lunch: number, resume: number, close: number): SessionPhase {
  if (minutes >= open && minutes < lunch) return 'trading'
  if (minutes >= lunch && minutes < resume) return 'lunch'
  if (minutes >= resume && minutes < close) return 'trading'
  return 'closed'
}

/**
 * Session phases for the three markets at `now`.
 * @param now - wall-clock instant to evaluate (defaults to now).
 */
export function marketSessions(now: Date = new Date()): MarketSessions {
  const aShareOpen = isWeekday('Asia/Shanghai', now)
  const hkOpen = isWeekday('Asia/Hong_Kong', now)
  const usOpen = isWeekday('America/New_York', now)
  return {
    aShare: aShareOpen
      ? splitPhase(tzMinutes('Asia/Shanghai', now), 9 * 60 + 30, 11 * 60 + 30, 13 * 60, 15 * 60)
      : 'closed',
    hk: hkOpen
      ? splitPhase(tzMinutes('Asia/Hong_Kong', now), 9 * 60 + 30, 12 * 60, 13 * 60, 16 * 60)
      : 'closed',
    us: usOpen
      ? continuousPhase(tzMinutes('America/New_York', now), 9 * 60 + 30, 16 * 60, 4 * 60)
      : 'closed',
  }
}

/** Chinese label for one phase. */
export function phaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case 'trading': return '盘中'
    case 'lunch': return '午休'
    case 'pre': return '盘前'
    case 'closed': return '休市'
  }
}
