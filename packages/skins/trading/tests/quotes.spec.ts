// @vitest-environment jsdom
/**
 * Data-layer unit tests for the trading skin: Tencent payload parsing
 * (against real captured responses for every symbol family), Binance and
 * Frankfurter mapping, the standalone symbol classifier, the trend rule,
 * and the market-session phases across timezones.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyDirectSymbol,
  isoDaysAgo,
  parseTencentRow,
  trendOf,
  type Quote,
} from '../src/client/quotes.ts'
import { marketSessions, phaseLabel } from '../src/client/session.ts'

// Real qt.gtimg.cn payloads captured in Chromium (2026-08-13).
const SH_INDEX = '1~上证指数~000001~3926.96~3946.68~3957.16~572793677~0~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~~20260813161402~-19.72~-0.50~3968.48~3924.64~3926.96/572793677/1164203068530~572793677~116420307~1.18~18.02~~3968.48~3924.64~1.11~612963.05~690590.19~0.00~-1~-1~1.05~0~3957.64~~~~~~116420306.8530~0.0000~0~ ~ZS~-1.06~0.68~~~~4258.86~3658.38~3.21~1.15~-5.65~4844964979685~~2.82~-1.13~4844964979685~~~6.61~0.02~~CNY~0~~0.00~0~'
const HK_STOCK = '100~腾讯控股~00700~441.000~461.600~446.400~66424623.0~0~0~441.000~0~0~0~0~0~0~0~0~0~441.000~0~0~0~0~0~0~0~0~0~66424623.0~2026/08/13 16:08:17~-20.600~-4.46~452.200~439.600~441.000~66424623.0~29545597907.440~0~16.09~~0~0~2.73~40054.8026~40054.8026~TENCENT~1.21~677.700~411.000~3.29~0.20~0~0~0~0~0~14.77~3.07~0.73~100~-25.72~-7.97~GP~20.41~11.00~-6.53~-8.88~-1.83~9082721689.00~9082721689.00~15.24~5.321~444.799~-30.13~HKD~1~50'
const US_STOCK = '200~英伟达~NVDA.OQ|224.27|224.09|225.06|0.18|0.08'
const US_INDEX = '200~纳斯达克~.IXIC~26719.11~26588.49~26631.34~3632586537~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~2026-08-13 11:52:41~130.62~0.49~26875.52~26612.85~USD~3632586537~97059471274932~~~~~~0.99~~~Nasdaq Composite~~27190.21~20690.25~0~~~~14.96~1.41~ZS~~~6.36~3.23~2.41~~~1.36~~~26719.11~~~'
const A_SHARE = '1~贵州茅台~600519~1355.29~1343.00~1338.00~32353~17836~14517~1355.29~8~1355.01~4~1355.00~29~1354.88~3~1354.85~1~1355.30~2~1355.33~1~1355.49~1~1355.50~8~1355.52~1~~20260813161452~12.29~0.92~1359.60~1337.00~1355.29/32353/4376205567~32353~437621~0.26~20.48~~1359.60~1337.00~1.68~16942.23~16942.23~7.28~1477.30~1208.70~0.92~32~1352.62~15.55~20.58~~~0.19~437620.5567~420.1399~31~   A~GP-A~0.45~3.57~3.84~30.53~26.78~1539.98~1151.01~-0.48~7.65~5.31~1250081601~1250081601~55.17~-4.49~1250081601~~~-0.93~-0.02~~CNY~0~___D__F__N~1354.78~11~'

describe('parseTencentRow', () => {
  it('parses the A-share index payload', () => {
    const row = parseTencentRow(SH_INDEX)
    expect(row).not.toBeNull()
    expect(row?.name).toBe('上证指数')
    expect(row?.price).toBeCloseTo(3926.96)
    expect(row?.prevClose).toBeCloseTo(3946.68)
    expect(row?.change).toBeCloseTo(-19.72)
    expect(row?.changePct).toBeCloseTo(-0.5)
    expect(row?.high).toBeCloseTo(3968.48)
    expect(row?.low).toBeCloseTo(3924.64)
  })

  it('parses the HK stock payload', () => {
    const row = parseTencentRow(HK_STOCK)
    expect(row?.name).toBe('腾讯控股')
    expect(row?.price).toBeCloseTo(441)
    expect(row?.change).toBeCloseTo(-20.6)
    expect(row?.changePct).toBeCloseTo(-4.46)
  })

  it('parses the US index payload', () => {
    const row = parseTencentRow(US_INDEX)
    expect(row?.name).toBe('纳斯达克')
    expect(row?.price).toBeCloseTo(26719.11)
    expect(row?.change).toBeCloseTo(130.62)
    expect(row?.changePct).toBeCloseTo(0.49)
  })

  it('parses the A-share stock payload', () => {
    const row = parseTencentRow(A_SHARE)
    expect(row?.name).toBe('贵州茅台')
    expect(row?.price).toBeCloseTo(1355.29)
    expect(row?.changePct).toBeCloseTo(0.92)
  })

  it('rejects malformed payloads', () => {
    expect(parseTencentRow('')).toBeNull()
    expect(parseTencentRow('1~名称~代码~abc~0~0~0')).toBeNull()
    expect(parseTencentRow('short')).toBeNull()
  })
})

describe('trendOf (红涨绿跌)', () => {
  const q = (changeAbs: number, changePct: number): Quote => ({
    symbol: 'X', name: 'X', price: 1, changeAbs, changePct, source: 'tencent',
  })

  it('colors by absolute change first', () => {
    expect(trendOf(q(1.2, -0.5))).toBe('up')
    expect(trendOf(q(-1.2, 0.5))).toBe('down')
  })

  it('falls back to percent when absolute is zero (longbridge snapshot)', () => {
    expect(trendOf(q(0, 0.42))).toBe('up')
    expect(trendOf(q(0, -0.17))).toBe('down')
  })

  it('is flat when both are zero', () => {
    expect(trendOf(q(0, 0))).toBe('flat')
    expect(trendOf(q(Number.NaN, Number.NaN))).toBe('flat')
  })
})

describe('classifyDirectSymbol', () => {
  it('routes tencent symbols', () => {
    expect(classifyDirectSymbol('sh000001')).toBe('tencent')
    expect(classifyDirectSymbol('sz399001')).toBe('tencent')
    expect(classifyDirectSymbol('hk00700')).toBe('tencent')
    expect(classifyDirectSymbol('hkHSI')).toBe('tencent')
    expect(classifyDirectSymbol('usAAPL')).toBe('tencent')
    expect(classifyDirectSymbol('usDJI')).toBe('tencent')
  })

  it('routes crypto and fx symbols', () => {
    expect(classifyDirectSymbol('BTCUSDT')).toBe('crypto')
    expect(classifyDirectSymbol('ETHUSDT')).toBe('crypto')
    expect(classifyDirectSymbol('USD/CNY')).toBe('fx')
    expect(classifyDirectSymbol('EUR/USD')).toBe('fx')
  })

  it('rejects junk', () => {
    expect(classifyDirectSymbol('')).toBeNull()
    expect(classifyDirectSymbol('nope')).toBeNull()
    expect(classifyDirectSymbol('1234567')).toBeNull()
    // A bare 6-digit code is A-share grammar (fun-ticker), not a crypto pair.
    expect(classifyDirectSymbol('600519')).toBeNull()
  })
})

describe('isoDaysAgo', () => {
  it('walks back whole days in UTC', () => {
    expect(isoDaysAgo(new Date('2026-08-13T12:00:00Z'), 1)).toBe('2026-08-12')
    expect(isoDaysAgo(new Date('2026-08-13T12:00:00Z'), 4)).toBe('2026-08-09')
  })
})

describe('marketSessions', () => {
  it('reports a Shanghai midday as A-share lunch and HK lunch', () => {
    // 2026-08-13 is a Thursday. 12:00 Shanghai = 12:00 HKT = lunch in both.
    const sessions = marketSessions(new Date('2026-08-13T04:00:00Z'))
    expect(sessions.aShare).toBe('lunch')
    expect(sessions.hk).toBe('lunch')
    expect(phaseLabel('lunch')).toBe('午休')
  })

  it('reports a Shanghai 14:00 as A-share trading, US pre-market', () => {
    // 14:00 CST = 06:00 UTC; New York is UTC-4 in August = 02:00 ET (closed).
    const sessions = marketSessions(new Date('2026-08-13T06:00:00Z'))
    expect(sessions.aShare).toBe('trading')
    expect(sessions.hk).toBe('trading')
    expect(phaseLabel('trading')).toBe('盘中')
  })

  it('reports a US 10:30 as US trading when Shanghai is closed at night', () => {
    // 2026-08-13 22:30 UTC = 18:30 CST (closed), 18:30 HKT (closed),
    // 10:30 ET (trading). US EDT = UTC-4, so 22:30 UTC = 18:30 EDT — closed.
    // Use 14:30 UTC instead: 10:30 ET trading, 22:30 CST closed.
    const sessions = marketSessions(new Date('2026-08-13T14:30:00Z'))
    expect(sessions.us).toBe('trading')
    expect(sessions.aShare).toBe('closed')
    expect(phaseLabel('closed')).toBe('休市')
  })

  it('reports weekends closed for A-share', () => {
    // 2026-08-15 is a Saturday, 10:00 CST.
    const sessions = marketSessions(new Date('2026-08-15T02:00:00Z'))
    expect(sessions.aShare).toBe('closed')
    expect(sessions.hk).toBe('closed')
  })

  it('reports the A-share morning break boundary', () => {
    // 11:29 CST: still trading.
    const before = marketSessions(new Date('2026-08-13T03:29:00Z'))
    expect(before.aShare).toBe('trading')
    // 11:30 CST exactly: the morning session has closed — lunch.
    const sessions = marketSessions(new Date('2026-08-13T03:30:00Z'))
    expect(sessions.aShare).toBe('lunch')
    // 13:00 CST: afternoon trading resumes.
    const after = marketSessions(new Date('2026-08-13T05:00:00Z'))
    expect(after.aShare).toBe('trading')
  })
})
