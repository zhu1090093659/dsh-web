/**
 * DeepSeek official peak/off-peak pricing: the published V4 price book plus
 * the peak-window clock, folded into a per-call spend estimate the ledger
 * stamps at fold time (the provider bills each request in the period the
 * request ran in, so pricing at the fold is the honest estimate).
 *
 * Policy (api-docs.deepseek.com pricing page, effective 2026-08-17): peak
 * hours are Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00; every
 * other hour (nights, weekends) is off-peak and billed at half the peak
 * price. All prices here are CNY per million tokens.
 * @module @linxin666/dsh-usage/core/pricing
 */

import type { UsageTokenTotals } from './types.ts'

/** One peak window in minutes-of-day, Beijing time. */
interface PeakWindow {
  /** Inclusive start, minutes since midnight. */
  from: number
  /** Exclusive end, minutes since midnight. */
  to: number
}

/** The published peak windows: weekday 09:00-12:00 and 14:00-18:00. */
const PEAK_WINDOWS: readonly PeakWindow[] = [
  { from: 9 * 60, to: 12 * 60 },
  { from: 14 * 60, to: 18 * 60 },
]

/** Beijing is UTC+8 year-round (no DST), so a fixed shift is exact. */
const BEIJING_UTC_OFFSET_MS = 8 * 3_600_000

/** One price row in CNY per million tokens, split by billing period. */
interface ModelPrice {
  /** Input served from the provider prompt cache. */
  cacheHit: { offPeak: number; peak: number }
  /** Uncached input (DeepSeek reports no separate cache-write class). */
  inputMiss: { offPeak: number; peak: number }
  /** Output; reasoning tokens bill as output. */
  output: { offPeak: number; peak: number }
}

/** deepseek-v4-flash (and the flash-class vision experiment). */
const FLASH_PRICE: ModelPrice = {
  cacheHit: { offPeak: 0.05, peak: 0.1 },
  inputMiss: { offPeak: 1.5, peak: 3.0 },
  output: { offPeak: 4.5, peak: 9.0 },
}

/** deepseek-v4-pro. */
const PRO_PRICE: ModelPrice = {
  cacheHit: { offPeak: 0.15, peak: 0.3 },
  inputMiss: { offPeak: 4.5, peak: 9.0 },
  output: { offPeak: 13.5, peak: 27.0 },
}

function withinWindow(minuteOfDay: number): PeakWindow | undefined {
  return PEAK_WINDOWS.find((window) => minuteOfDay >= window.from && minuteOfDay < window.to)
}

/**
 * The DeepSeek billing period at `ms`, plus when it next flips. The clock is
 * Beijing time regardless of the host timezone (UTC+8 has no DST, so a fixed
 * shift is exact). `boundaryMs` is the instant the current period ends — the
 * window's close while peaking, the next window's open otherwise.
 */
export function deepseekPeriodAt(ms: number): { peak: boolean; boundaryMs: number } {
  const shifted = new Date(ms + BEIJING_UTC_OFFSET_MS)
  const weekday = shifted.getUTCDay()
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  const current = weekday >= 1 && weekday <= 5 ? withinWindow(minuteOfDay) : undefined
  if (current !== undefined) {
    return { peak: true, boundaryMs: ms + (current.to - minuteOfDay) * 60_000 - shifted.getUTCSeconds() * 1000 - shifted.getUTCMilliseconds() }
  }
  // Next window start: later today (weekday only), else the following days'
  // first morning window; the scan bound makes a malformed clock terminate.
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const day = new Date(ms + BEIJING_UTC_OFFSET_MS + dayOffset * 86_400_000)
    if (day.getUTCDay() < 1 || day.getUTCDay() > 5) continue
    const realDayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - BEIJING_UTC_OFFSET_MS
    for (const window of PEAK_WINDOWS) {
      if (dayOffset === 0 && window.from <= minuteOfDay) continue
      return { peak: false, boundaryMs: realDayStart + window.from * 60_000 }
    }
  }
  // Unreachable (the scan covers a full week); a conservative off-peak answer.
  return { peak: false, boundaryMs: ms + 86_400_000 }
}

/** The price row for a model id; unknown ids take the flash-class row (documented estimate). */
function priceFor(model: string): ModelPrice {
  return model.includes('v4-pro') ? PRO_PRICE : FLASH_PRICE
}

/**
 * Estimate one call's DeepSeek spend in CNY from its token totals, priced in
 * the billing period at `atMs`. Uncatalogued model ids take the flash-class
 * row; ids from other providers never reach this function (the service gates
 * by route family). Rounded to micro-CNY so the ledger stays readable.
 */
export function deepseekModelSpend(model: string, totals: Readonly<UsageTokenTotals>, atMs: number): number {
  const price = priceFor(model)
  const period = deepseekPeriodAt(atMs)
  const column = period.peak ? 'peak' : 'offPeak'
  const spend = (totals.cacheReadTokens * price.cacheHit[column]
    + (totals.inputTokens + totals.cacheWriteTokens) * price.inputMiss[column]
    + totals.outputTokens * price.output[column]) / 1_000_000
  return Math.round(spend * 1e6) / 1e6
}
