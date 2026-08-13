/**
 * Live-quote data layer for the trading skin — the browser half of the
 * 「炒股皮肤」 integration with the two market plugins:
 *
 *  - dsh-fun-ticker: same-origin proxy `/plugins/dsh-ticker/api` (host-side
 *    Binance/Frankfurter/eastmoney/Sina sources). When the plugin is
 *    installed the skin feeds its tape from the user's own watchlist
 *    (settings.symbols) — zero extra upstream calls, no CORS.
 *  - dsh-longbridge: loopback RPC `/longbridge` `panel/snapshot` (broker
 *    HK/US quotes). When the plugin is installed and configured the status
 *    bar renders its real quotes; otherwise the same cells fall back to the
 *    public Tencent feed.
 *
 * Standalone fallback (no plugins installed): Tencent `qt.gtimg.cn` via
 * classic script-tag loading for A/HK/US quotes (GBK-safe in Chromium,
 * verified in-browser), Binance 24h ticker for crypto (CORS `*`), and
 * Frankfurter ECB rates for FX. Every fetch path degrades to an empty list;
 * the skin chrome must never crash on a failed quote cycle.
 *
 * Pure module: no DOM writes, no state — callers own rendering.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

/** Quote trend direction for the 红涨绿跌 coloring (cn scheme). */
export type Trend = 'up' | 'down' | 'flat'

/** One normalized quote cell. */
export interface Quote {
  /** Requested symbol (the grammar of whatever source produced it). */
  symbol: string
  /** Display name (Chinese where the source provides one). */
  name: string
  /** Last price. */
  price: number
  /** Percent change (signed). */
  changePct: number
  /** Absolute change (signed; 0 when the source only reports pct). */
  changeAbs: number
  /** Source family, for debug labeling. */
  source: 'ticker' | 'tencent' | 'binance' | 'frankfurter' | 'longbridge'
}

/** Resolve the cn-scheme trend: red up, green down, gray flat. */
export function trendOf(q: Pick<Quote, 'changeAbs' | 'changePct'>): Trend {
  if (q.changeAbs > 0) return 'up'
  if (q.changeAbs < 0) return 'down'
  if (q.changePct > 0) return 'up'
  if (q.changePct < 0) return 'down'
  return 'flat'
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** AbortSignal for one request; fails safe where AbortSignal.timeout is absent. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  // Non-fatal; the fetch owns the timer for its lifetime.
  void timer
  return controller.signal
}

/** String -> finite number, or NaN. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  if (typeof value === 'string') return Number.parseFloat(value)
  return Number.NaN
}

// ── Tencent (qt.gtimg.cn): A-shares / HK / US, one batch per request ─────────

/** One parsed Tencent row (fields verified against the live endpoint). */
export interface TencentRow {
  name: string
  price: number
  prevClose: number
  change: number
  changePct: number
  high: number
  low: number
}

/**
 * Parse one `v_<sym>="..."` payload. Tencent splits fields on `~`; the
 * stable indices used here (verified on sh/sz/hk/us families):
 *   1 name, 3 last, 4 prevClose, 30 time, 31 change, 32 changePct,
 *   33 high, 34 low.
 * @param raw - the raw quoted string (without the `v_<sym>=` prefix).
 * @returns the row, or null for a malformed payload.
 */
export function parseTencentRow(raw: string): TencentRow | null {
  const f = raw.split('~')
  if (f.length < 35) return null
  const price = toNumber(f[3])
  if (!Number.isFinite(price)) return null
  return {
    name: f[1] !== undefined && f[1] !== '' ? f[1] : f[2] ?? '',
    price,
    prevClose: toNumber(f[4]),
    change: toNumber(f[31]),
    changePct: toNumber(f[32]),
    high: toNumber(f[33]),
    low: toNumber(f[34]),
  }
}

/**
 * Load a Tencent quote batch through a script tag (qt.gtimg.cn serves
 * classic scripts, not JSONP — the response assigns `v_<sym>` globals).
 * Chromium decodes the GBK payload correctly, so Chinese names survive.
 * Resolves with the parsed rows; on load failure or timeout, an empty map.
 * @param symbols - tencent-grammar symbols (sh000001 / hk00700 / usAAPL …).
 * @param timeoutMs - script load cap.
 */
export function loadTencentQuotes(
  symbols: readonly string[], timeoutMs = 8000,
): Promise<Map<string, TencentRow>> {
  return new Promise((resolve) => {
    if (symbols.length === 0) { resolve(new Map()); return }
    const globals = symbols.map((s) => `v_${s}`)
    let settled = false
    const script = document.createElement('script')
    const finish = (out: Map<string, TencentRow>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script.remove()
      for (const g of globals) {
        // The response globals are read before cleanup in onload; deleting
        // them here keeps the page free of skin-owned window pollution.
        try { delete (window as unknown as Record<string, unknown>)[g] } catch { /* noop */ }
      }
      resolve(out)
    }
    const timer = window.setTimeout(() => finish(new Map()), timeoutMs)
    script.onload = () => {
      const out = new Map<string, TencentRow>()
      for (const s of symbols) {
        const raw = (window as unknown as Record<string, unknown>)[`v_${s}`]
        if (typeof raw !== 'string') continue
        const row = parseTencentRow(raw)
        if (row !== null) out.set(s, row)
      }
      finish(out)
    }
    script.onerror = () => finish(new Map())
    script.src = `https://qt.gtimg.cn/q=${symbols.join(',')}&_t=${Date.now()}`
    document.head.append(script)
  })
}

// ── Binance: crypto (CORS *) ─────────────────────────────────────────────────

/** Binance hosts in preference order; the public mirror has no geo gating. */
const BINANCE_ENDPOINTS = [
  'https://api.binance.com/api/v3/ticker/24hr',
  'https://data-api.binance.vision/api/v3/ticker/24hr',
] as const

/** Display names for the well-known pairs. */
const CRYPTO_NAMES: Record<string, string> = {
  BTCUSDT: '比特币', ETHUSDT: '以太坊', BNBUSDT: 'BNB', SOLUSDT: 'Solana',
  XRPUSDT: '瑞波币', DOGEUSDT: '狗狗币', ADAUSDT: 'Cardano', AVAXUSDT: 'Avalanche',
  LINKUSDT: 'Chainlink', LTCUSDT: '莱特币', DOTUSDT: 'Polkadot', TRXUSDT: '波场',
  SHIBUSDT: 'SHIB', TONUSDT: 'TON', BCHUSDT: 'BCH', UNIUSDT: 'Uniswap',
  ATOMUSDT: 'Cosmos', NEARUSDT: 'NEAR', APTUSDT: 'Aptos', ARBUSDT: 'Arbitrum',
  OPUSDT: 'Optimism', FILUSDT: 'Filecoin', SUIUSDT: 'SUI', PEPEUSDT: 'PEPE',
}

/**
 * Fetch 24h tickers for a crypto batch. Walks the host list until one
 * answers; an all-fail cycle resolves to an empty map.
 */
export async function fetchBinanceQuotes(
  symbols: readonly string[], timeoutMs = 8000,
): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>()
  if (symbols.length === 0) return out
  for (const endpoint of BINANCE_ENDPOINTS) {
    try {
      const response = await fetch(
        `${endpoint}?symbols=${encodeURIComponent(JSON.stringify(symbols))}`,
        { signal: timeoutSignal(timeoutMs) },
      )
      if (!response.ok) continue
      const rows = await response.json() as Array<{
        symbol?: unknown; lastPrice?: unknown; priceChange?: unknown; priceChangePercent?: unknown
      }>
      for (const row of rows) {
        const symbol = String(row.symbol ?? '')
        const price = toNumber(row.lastPrice)
        if (symbol === '' || !Number.isFinite(price)) continue
        out.set(symbol, {
          symbol,
          name: CRYPTO_NAMES[symbol] ?? symbol,
          price,
          changeAbs: toNumber(row.priceChange),
          changePct: toNumber(row.priceChangePercent),
          source: 'binance',
        })
      }
      if (out.size > 0) return out
    } catch {
      // Try the next host; a total failure resolves empty.
    }
  }
  return out
}

// ── Frankfurter (ECB rates): FX pairs ────────────────────────────────────────

/** Frankfurter hosts in preference order (.dev is the current home). */
const FRANKFURTER_ENDPOINTS = [
  'https://api.frankfurter.dev/v1',
  'https://api.frankfurter.app/v1',
] as const

/** Chinese names for common currencies (fun-ticker's naming convention). */
const FX_CURRENCY_NAMES: Record<string, string> = {
  CNY: '人民币', USD: '美元', EUR: '欧元', JPY: '日元', GBP: '英镑', HKD: '港元',
  AUD: '澳元', CAD: '加元', CHF: '瑞士法郎', KRW: '韩元', SGD: '新加坡元',
  TWD: '新台币', THB: '泰铢', RUB: '卢布', INR: '卢比', BRL: '雷亚尔',
  MXN: '比索', TRY: '里拉', ZAR: '兰特', SEK: '瑞典克朗', NOK: '挪威克朗',
  DKK: '丹麦克朗', NZD: '新西兰元', CZK: '捷克克朗', PLN: '兹罗提', HUF: '福林',
}

/** ISO date (YYYY-MM-DD) of `days` days before `date`, in UTC. */
export function isoDaysAgo(date: Date, days: number): string {
  return new Date(date.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Fetch one FX base's rates for a target list from the first host that
 * answers. Resolves `{ base, rates, prev }` or null on total failure.
 */
async function frankfurterRates(
  base: string, targets: readonly string[],
): Promise<{ base: string; rates: Map<string, number>; prev: Map<string, number> } | null> {
  const symbols = targets.join(',')
  const date = new Date()
  for (const endpoint of FRANKFURTER_ENDPOINTS) {
    try {
      const latestUrl = `${endpoint}/latest?base=${base}&symbols=${symbols}`
      const latestResponse = await fetch(latestUrl, { signal: timeoutSignal(8000) })
      if (!latestResponse.ok) continue
      const latest = await latestResponse.json() as { rates?: Record<string, unknown> }
      if (latest.rates === undefined) continue
      const rates = new Map<string, number>()
      for (const [code, value] of Object.entries(latest.rates)) {
        const n = toNumber(value)
        if (Number.isFinite(n)) rates.set(code, n)
      }
      // Previous business-day close: walk back up to 4 days (weekends +
      // holidays) so the change cell has a reference.
      let prev = new Map<string, number>()
      for (let back = 1; back <= 4 && prev.size === 0; back += 1) {
        const prevUrl = `${endpoint}/${isoDaysAgo(date, back)}?base=${base}&symbols=${symbols}`
        try {
          const prevResponse = await fetch(prevUrl, { signal: timeoutSignal(6000) })
          if (!prevResponse.ok) continue
          const prevJson = await prevResponse.json() as { rates?: Record<string, unknown> }
          prev = new Map<string, number>()
          for (const [code, value] of Object.entries(prevJson.rates ?? {})) {
            const n = toNumber(value)
            if (Number.isFinite(n)) prev.set(code, n)
          }
        } catch {
          // keep walking back
        }
      }
      return { base, rates, prev }
    } catch {
      // next host
    }
  }
  return null
}

/**
 * Fetch FX pair quotes (USD/CNY grammar). Pairs are grouped by base; each
 * group is one request plus one previous-day request for the change.
 */
export async function fetchFrankfurterQuotes(
  pairs: readonly string[], timeoutMs = 8000,
): Promise<Map<string, Quote>> {
  void timeoutMs
  const out = new Map<string, Quote>()
  if (pairs.length === 0) return out
  const byBase = new Map<string, string[]>()
  for (const pair of pairs) {
    const [base, target] = pair.split('/')
    if (base === undefined || target === undefined || base === target) continue
    const list = byBase.get(base) ?? []
    list.push(target)
    byBase.set(base, list)
  }
  const results = await Promise.all(
    [...byBase.entries()].map(([base, targets]) => frankfurterRates(base, targets)),
  )
  for (const result of results) {
    if (result === null) continue
    for (const [target, rate] of result.rates) {
      const symbol = `${result.base}/${target}`
      const prevRate = result.prev.get(target)
      const changeAbs = Number.isFinite(prevRate) && prevRate !== 0 ? rate - (prevRate as number) : 0
      const changePct = Number.isFinite(prevRate) && prevRate !== 0
        ? ((rate - (prevRate as number)) / (prevRate as number)) * 100
        : 0
      out.set(symbol, {
        symbol,
        name: `${FX_CURRENCY_NAMES[result.base] ?? result.base}/${FX_CURRENCY_NAMES[target] ?? target}`,
        price: rate,
        changeAbs,
        changePct,
        source: 'frankfurter',
      })
    }
  }
  return out
}

// ── dsh-fun-ticker same-origin route (installed-plugin mode) ─────────────────

/** The fun-ticker plugin's same-origin API base (404s when not installed). */
const TICKER_API_BASE = '/plugins/dsh-ticker/api'

/** Read the user's fun-ticker watchlist; null when the plugin is absent. */
export async function fetchTickerSettings(timeoutMs = 5000): Promise<string[] | null> {
  if (typeof fetch === 'undefined') return null
  try {
    const response = await fetch(`${TICKER_API_BASE}/settings`, { signal: timeoutSignal(timeoutMs) })
    if (!response.ok) return null
    const data = await response.json() as { ok?: boolean; section?: { symbols?: unknown } }
    if (data.ok !== true) return null
    const symbols = data.section?.symbols
    if (!Array.isArray(symbols)) return null
    const list = symbols.filter((s): s is string => typeof s === 'string' && s.length > 0)
    return list.length > 0 ? list : null
  } catch {
    return null
  }
}

/** Poll the fun-ticker quote proxy for the given watchlist; null on failure. */
export async function fetchTickerQuotes(
  symbols: readonly string[], timeoutMs = 8000,
): Promise<Quote[] | null> {
  if (typeof fetch === 'undefined' || symbols.length === 0) return null
  try {
    const response = await fetch(
      `${TICKER_API_BASE}/quotes?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal: timeoutSignal(timeoutMs) },
    )
    if (!response.ok) return null
    const data = await response.json() as {
      ok?: boolean
      quotes?: Record<string, {
        symbol?: unknown; name?: unknown; price?: unknown; changePct?: unknown; changeAbs?: unknown
      }>
    }
    if (data.ok !== true || data.quotes === undefined) return null
    const quotes: Quote[] = []
    for (const row of Object.values(data.quotes)) {
      const symbol = String(row.symbol ?? '')
      const price = toNumber(row.price)
      if (symbol === '' || !Number.isFinite(price)) continue
      quotes.push({
        symbol,
        name: typeof row.name === 'string' && row.name !== '' ? row.name : symbol,
        price,
        changePct: toNumber(row.changePct),
        changeAbs: toNumber(row.changeAbs),
        source: 'ticker',
      })
    }
    return quotes.length > 0 ? quotes : null
  } catch {
    return null
  }
}

// ── dsh-longbridge RPC (installed-plugin mode) ───────────────────────────────

/** The longbridge plugin's RPC channel and snapshot endpoint. */
export const LONGBRIDGE_RPC_CHANNEL = '/longbridge'
export const LONGBRIDGE_SNAPSHOT_ENDPOINT = 'panel/snapshot'

/** HK/US index symbols the status bar renders from longbridge by default. */
export const LONGBRIDGE_WATCHLIST = ['HSI.HK', 'HSTECH.HK', 'DJI.US', 'SPX.US', 'NDX.US'] as const

/** Display names for common longbridge symbols. */
const LONGBRIDGE_NAMES: Record<string, string> = {
  'HSI.HK': '恒生指数', 'HSTECH.HK': '恒生科技', 'HSCEI.HK': '国企指数',
  'DJI.US': '道琼斯', 'SPX.US': '标普500', 'NDX.US': '纳指100',
  '700.HK': '腾讯控股', '9988.HK': '阿里巴巴', '3690.HK': '美团', '1810.HK': '小米集团',
  'AAPL.US': '苹果', 'NVDA.US': '英伟达', 'TSLA.US': '特斯拉', 'MSFT.US': '微软',
  'META.US': 'Meta', 'GOOGL.US': '谷歌', 'AMZN.US': '亚马逊', 'BABA.US': '阿里巴巴',
}

/**
 * Fetch the longbridge panel snapshot through the loopback RPC. Returns the
 * normalized quotes, or null when the plugin is not installed / not
 * configured / the RPC fails — callers fall back to the public feed.
 * @param connection - the client connection handle (may be absent).
 */
export async function fetchLongbridgeQuotes(
  connection: ConnectionHandle | undefined,
): Promise<Quote[] | null> {
  if (connection === undefined) return null
  try {
    const result = await connection.rpc.call(
      LONGBRIDGE_RPC_CHANNEL, LONGBRIDGE_SNAPSHOT_ENDPOINT,
      { symbols: [...LONGBRIDGE_WATCHLIST] },
    )
    if (!result.ok) return null
    const value = result.value as {
      quotes?: Array<{ symbol?: unknown; lastDone?: unknown; changePct?: unknown }>
    }
    const rows = value.quotes ?? []
    const quotes: Quote[] = []
    for (const row of rows) {
      const symbol = String(row.symbol ?? '')
      const price = toNumber(row.lastDone)
      if (symbol === '' || !Number.isFinite(price)) continue
      quotes.push({
        symbol,
        name: LONGBRIDGE_NAMES[symbol] ?? symbol,
        price,
        changePct: toNumber(row.changePct),
        changeAbs: 0, // the snapshot reports pct only; trendOf falls back to pct
        source: 'longbridge',
      })
    }
    return quotes.length > 0 ? quotes : null
  } catch {
    return null
  }
}

// ── standalone router (no plugins installed) ─────────────────────────────────

/** Skin default watchlist when dsh-fun-ticker is absent (own grammar). */
export const DEFAULT_TAPE: readonly string[] = [
  'sh000001', 'sz399001', 'sz399006',
  'hkHSI', 'hk00700', 'hk09988',
  'usIXIC', 'usDJI', 'usNVDA', 'usAAPL', 'usTSLA',
  'BTCUSDT', 'ETHUSDT', 'USD/CNY',
]

/** Status-bar HK/US fallback (tencent grammar) when longbridge is absent. */
export const DEFAULT_INDEX_CELLS: readonly string[] = ['hkHSI', 'hkHSTECH', 'usDJI', 'usINX', 'usIXIC']

/** Classify one standalone symbol into its upstream family. */
export type DirectCategory = 'tencent' | 'crypto' | 'fx'

export function classifyDirectSymbol(symbol: string): DirectCategory | null {
  const value = symbol.trim()
  if (/^(?:sh|sz|hk|us)[A-Za-z0-9.]+$/.test(value)) return 'tencent'
  // Crypto pairs must contain a letter — a bare 6-digit code is A-share
  // grammar (fun-ticker), never a crypto pair.
  if (/^(?=.*[A-Z])[A-Z0-9]{4,12}$/.test(value)) return 'crypto'
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(value)) return 'fx'
  return null
}

/**
 * Fetch a quote batch from the public feeds directly (used only when the
 * fun-ticker plugin is not installed). Every family failure degrades to an
 * empty slice; the merged result may be shorter than requested.
 */
export async function fetchDirectQuotes(
  symbols: readonly string[], timeoutMs = 8000,
): Promise<Quote[]> {
  const tencentSymbols: string[] = []
  const cryptoSymbols: string[] = []
  const fxSymbols: string[] = []
  for (const symbol of symbols) {
    const category = classifyDirectSymbol(symbol)
    if (category === 'tencent') tencentSymbols.push(symbol)
    else if (category === 'crypto') cryptoSymbols.push(symbol)
    else if (category === 'fx') fxSymbols.push(symbol)
  }
  const [tencent, crypto, fx] = await Promise.all([
    loadTencentQuotes(tencentSymbols, timeoutMs),
    fetchBinanceQuotes(cryptoSymbols, timeoutMs),
    fetchFrankfurterQuotes(fxSymbols, timeoutMs),
  ])
  const quotes: Quote[] = []
  for (const [symbol, row] of tencent) {
    quotes.push({
      symbol,
      name: row.name !== '' ? row.name : symbol,
      price: row.price,
      changeAbs: row.change,
      changePct: row.changePct,
      source: 'tencent',
    })
  }
  for (const quote of crypto.values()) quotes.push(quote)
  for (const quote of fx.values()) quotes.push(quote)
  return quotes
}
