import { describe, expect, it } from 'vitest'
import { faceValue, formatDay, formatDenomination, deepseekVoucherData, voucherSerial, TOKENS_PER_WHALE_YUAN } from '../src/client/voucher.ts'
import { emptyTotals, type UsageProviderSummary, type UsageWindowSummary } from '../src/core/types.ts'

/**
 * The voucher's pure face: DeepSeek official family summation over a usage
 * window, the 1,000,000:1 whale-yuan exchange, the banknote denomination
 * formatting, the deterministic serial, and the observed-since day. The
 * canvas draw itself is composition, verified visually.
 */

function row(provider: string, inputTokens: number, calls = 1, cost = 0): UsageProviderSummary {
  return { provider, totals: { ...emptyTotals(), inputTokens, calls, cost }, models: [] }
}

function windowOf(providers: UsageProviderSummary[]): UsageWindowSummary {
  return { from: '2025-12-01', to: '2026-01-01', totals: emptyTotals(), providers }
}

describe('deepseekVoucherData', () => {
  it('returns undefined without a window (older host) or without family usage', () => {
    expect(deepseekVoucherData(undefined)).toBeUndefined()
    expect(deepseekVoucherData(windowOf([row('kimi-coding', 100)]))).toBeUndefined()
    expect(deepseekVoucherData(windowOf([]))).toBeUndefined()
  })

  it('sums the whole official family across route aliases and ignores other providers', () => {
    const data = deepseekVoucherData(windowOf([
      row('deepseek', 100_000, 3, 1.25),
      row('deepseek-official', 50_000, 2, 0.75),
      row('kimi-coding', 999_999, 40, 0),
    ]))
    expect(data).toMatchObject({ tokens: 150_000, calls: 5, cost: 2, from: '2025-12-01', to: '2026-01-01' })
  })

  it('counts cache tokens as minted whale yuan', () => {
    const data = deepseekVoucherData(windowOf([{
      provider: 'deepseek',
      totals: { ...emptyTotals(), inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, calls: 1 },
      models: [],
    }]))
    expect(data?.tokens).toBe(100)
  })
})

describe('faceValue (1,000,000 tokens = 1 whale yuan)', () => {
  it('exchanges at the anti-inflation rate and rounds to whole yuan', () => {
    expect(TOKENS_PER_WHALE_YUAN).toBe(1_000_000)
    expect(faceValue(1_234_567_890)).toBe(1235)
    expect(faceValue(1_086_000_000_000)).toBe(1_086_000)
    expect(faceValue(1_000_000)).toBe(1)
  })

  it('keeps the smallest denomination at 1 instead of a zero note', () => {
    expect(faceValue(42)).toBe(1)
    expect(faceValue(999_999)).toBe(1)
  })
})

describe('formatDenomination', () => {
  it('prints full digits with thousands separators', () => {
    expect(formatDenomination(0)).toBe('0')
    expect(formatDenomination(999)).toBe('999')
    expect(formatDenomination(1234)).toBe('1,234')
    expect(formatDenomination(1_234_567)).toBe('1,234,567')
    expect(formatDenomination(1_234_567_890)).toBe('1,234,567,890')
  })

  it('rounds fractional accumulations away', () => {
    expect(formatDenomination(1234.6)).toBe('1,235')
  })
})

describe('voucherSerial', () => {
  it('derives a deterministic zero-padded serial from the face value', () => {
    expect(voucherSerial(42)).toBe('000000042')
    expect(voucherSerial(123_456_789)).toBe('123456789')
    expect(voucherSerial(1_000_000_000)).toBe('000000000')
    expect(voucherSerial(1_000_000_042)).toBe('000000042')
  })
})

describe('formatDay', () => {
  it('formats the observation start as a deterministic local day', () => {
    expect(formatDay(new Date(2026, 0, 2, 12).getTime())).toBe('2026-01-02')
    expect(formatDay(new Date(2026, 8, 10, 7, 30).getTime())).toBe('2026-09-10')
  })
})
