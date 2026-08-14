/**
 * Trading-terminal skin for the dsh web GUI — the 「炒股皮肤」: live ticker
 * tape + market status bar + trading chrome. A hot-pluggable client plugin
 * in the dsh web ui family: apply() owns the whole surface and retracts it
 * on dispose (the ThemePresenter retraction discipline — the plugin only
 * ever removes what it wrote): the `data-dsh-trading` body attribute, the
 * title bar with live quote chips, the scrolling tape strip, the status
 * bar, the injected favicon, and the document title. The CSS rides the
 * bundle's CSS-modules auto-inject (style tag owned by the loader, removed
 * on entry dispose).
 *
 * Data comes from three tiers, each degrading to the next:
 *   1. dsh-fun-ticker (same-origin /plugins/dsh-ticker/api) — the user's
 *      own watchlist, proxied host-side (Binance/Frankfurter/eastmoney/Sina).
 *   2. dsh-longbridge (loopback RPC /longbridge panel/snapshot) — broker
 *      HK/US quotes for the status-bar index cells.
 *   3. standalone public feeds (Tencent qt.gtimg.cn script tag, Binance
 *      24h ticker, Frankfurter ECB rates) when no plugin is installed.
 * Every fetch path fails safe to '--' cells; the chrome never crashes on a
 * dead network, and dispose cancels all timers.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import css from './trading.module.css'
import {
  DEFAULT_INDEX_CELLS,
  DEFAULT_TAPE,
  fetchDirectQuotes,
  fetchLongbridgeQuotes,
  fetchTickerQuotes,
  fetchTickerSettings,
  trendOf,
  type Quote,
  type Trend,
} from './quotes.ts'
import { marketSessions, phaseLabel, type SessionPhase } from './session.ts'

/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
const SKIN_TITLE = '交易终端 · DeepSeek 在线'

/** Quote refresh cadence (matches the fun-ticker plugin default of 30s). */
const QUOTES_REFRESH_MS = 30_000

/** Session-state refresh cadence. */
const SESSION_REFRESH_MS = 60_000

/** Workspace-count refresh cadence. */
const WORKSPACES_REFRESH_MS = 30_000

/** Title bar window buttons (decorative glyphs, aria-hidden). */
const TITLEBAR_GLYPHS = ['–', '□', '×'] as const

/** Resolve one module class name (fallback satisfies the indexed-access type). */
const cls = (name: keyof typeof css): string => css[name] ?? ''

/** Candlestick brand mark, inline so the skin carries no static assets. */
const CANDLE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">',
  '<rect x="6" y="14" width="8" height="20" fill="#fff"/>',
  '<rect x="9" y="6" width="2" height="36" fill="#fff"/>',
  '<rect x="17" y="20" width="8" height="18" fill="#fff"/>',
  '<rect x="20" y="12" width="2" height="34" fill="#fff"/>',
  '<rect x="28" y="10" width="8" height="16" fill="#fff"/>',
  '<rect x="31" y="4" width="2" height="28" fill="#fff"/>',
  '</svg>',
].join('')

/** Brand-red rounded-square favicon carrying the candle mark, inline data URI. */
const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
  '<rect x="2" y="2" width="60" height="60" rx="14" fill="#f23645"/>',
  '<rect x="14" y="24" width="8" height="16" rx="1" fill="#fff"/>',
  '<rect x="17" y="18" width="2" height="28" rx="1" fill="#fff"/>',
  '<rect x="28" y="30" width="8" height="14" rx="1" fill="#fff"/>',
  '<rect x="31" y="24" width="2" height="26" rx="1" fill="#fff"/>',
  '<rect x="42" y="22" width="8" height="12" rx="1" fill="#fff"/>',
  '<rect x="45" y="16" width="2" height="24" rx="1" fill="#fff"/>',
  '</svg>',
].join('')

/** Placeholder quote for the pre-data chrome. */
function placeholderQuote(symbol: string): Quote {
  return { symbol, name: symbol, price: Number.NaN, changePct: Number.NaN, changeAbs: Number.NaN, source: 'tencent' }
}

/** `0.42` -> `+0.42%`; `-0.50` -> `0.50%` (the ▲▼ glyph already carries
 *  direction); flat renders a dash. */
function pctText(trend: Trend, pct: number): string {
  if (trend === 'flat') return '—'
  const abs = Math.abs(pct)
  return `${trend === 'up' ? '+' : ''}${abs.toFixed(2)}%`
}

/** `3926.96` -> `3,926.96`; NaN renders the dash. */
function priceText(price: number): string {
  return Number.isFinite(price) ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'
}

/** Apply the trend to a cell element (data-trend drives the 红涨绿跌 colors). */
function applyTrend(el: HTMLElement, trend: Trend): void {
  if (trend === 'flat') delete el.dataset.trend
  else el.dataset.trend = trend
}

/**
 * Apply the trading skin: body attribute, chrome bars, title, favicon,
 * pollers. All writes are retracted by the effect disposer on dispose.
 * @param ctx - owning context (the effect lifecycle owns retraction).
 */
export function apply(ctx: Context): void {
  const body = document.body
  const originalTitle = document.title
  body.dataset.dshTrading = ''
  let disposed = false

  // ── chrome skeleton ─────────────────────────────────────────────────────────

  const titlebar = document.createElement('div')
  titlebar.className = cls('tradingTitlebar')
  titlebar.dataset.skinChrome = 'titlebar'
  const brand = document.createElement('span')
  brand.className = cls('tradingTitlebarIcon')
  brand.innerHTML = CANDLE_SVG
  const title = document.createElement('span')
  title.className = cls('tradingTitlebarTitle')
  title.textContent = SKIN_TITLE
  const chips = document.createElement('span')
  chips.className = cls('tradingTitlebarChips')
  titlebar.append(brand, title, chips)
  for (const glyph of TITLEBAR_GLYPHS) {
    const btn = document.createElement('span')
    btn.className = cls('tradingTitlebarBtn')
    btn.setAttribute('aria-hidden', 'true')
    btn.textContent = glyph
    titlebar.append(btn)
  }

  const tape = document.createElement('div')
  tape.className = cls('tradingTape')
  tape.dataset.skinChrome = 'tape'
  const track = document.createElement('div')
  track.className = cls('tradingTapeTrack')
  tape.append(track)

  const statusbar = document.createElement('div')
  statusbar.className = cls('tradingStatusbar')
  statusbar.dataset.skinChrome = 'statusbar'
  const leftGroup = document.createElement('span')
  leftGroup.className = cls('tradingStatusbarGroup')
  const sessionCells = new Map<keyof ReturnType<typeof marketSessions>, HTMLElement>()
  const sessionLabels: Array<[keyof ReturnType<typeof marketSessions>, string]> = [
    ['aShare', 'A股'], ['hk', '港股'], ['us', '美股'],
  ]
  for (const [key, label] of sessionLabels) {
    const cell = document.createElement('span')
    cell.className = cls('tradingStatusbarCell')
    cell.textContent = `${label} 休市`
    sessionCells.set(key, cell)
    leftGroup.append(cell)
  }
  const spacer = document.createElement('span')
  spacer.className = cls('tradingStatusbarSpacer')
  const lbGroup = document.createElement('span')
  lbGroup.className = cls('tradingStatusbarGroup')
  const lbLabel = document.createElement('span')
  lbLabel.className = cls('tradingStatusbarLbLabel')
  lbLabel.textContent = '长桥'
  const lbCells: HTMLElement[] = []
  for (let i = 0; i < DEFAULT_INDEX_CELLS.length; i += 1) {
    const cell = document.createElement('span')
    cell.className = cls('tradingStatusbarCell')
    cell.textContent = '-- --'
    lbCells.push(cell)
    lbGroup.append(cell)
  }
  lbGroup.prepend(lbLabel)
  const codeIndexCell = document.createElement('span')
  codeIndexCell.className = cls('tradingStatusbarCell')
  codeIndexCell.textContent = '工作区 --'
  const rightGroup = document.createElement('span')
  rightGroup.className = cls('tradingStatusbarGroup')
  for (const state of ['就绪', '已连接', '在线'] as const) {
    const cell = document.createElement('span')
    cell.className = cls('tradingStatusbarCell')
    cell.textContent = state
    rightGroup.append(cell)
  }
  statusbar.append(leftGroup, spacer, lbGroup, codeIndexCell, rightGroup)

  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(FAVICON_SVG)}`

  document.title = SKIN_TITLE
  document.head.append(favicon)
  body.append(titlebar, tape, statusbar)

  // ── rendering ────────────────────────────────────────────────────────────────

  /** Render one quote cell (tape item or titlebar chip). */
  function renderQuoteCell(
    container: HTMLElement, quote: Quote, nameClass: string, valueClass: string, chgClass: string,
  ): void {
    container.textContent = ''
    const trend = trendOf(quote)
    const name = document.createElement('span')
    name.className = nameClass
    name.textContent = quote.name
    const price = document.createElement('span')
    price.className = valueClass
    price.textContent = priceText(quote.price)
    const chg = document.createElement('span')
    chg.className = chgClass
    chg.textContent = `${trend === 'up' ? '▲' : trend === 'down' ? '▼' : ''}${pctText(trend, quote.changePct)}`
    applyTrend(chg, trend)
    container.append(name, price, chg)
  }

  /** Rebuild the tape track: two identical copies for the seamless loop. */
  function renderTape(quotes: Quote[]): void {
    const items = quotes.length > 0 ? quotes : DEFAULT_TAPE.map(placeholderQuote)
    track.textContent = ''
    for (let copy = 0; copy < 2; copy += 1) {
      for (const quote of items) {
        const item = document.createElement('span')
        item.className = cls('tradingTapeItem')
        renderQuoteCell(
          item, quote,
          cls('tradingTapeName'), cls('tradingTapePrice'), cls('tradingTapeChg'),
        )
        track.append(item)
      }
    }
    // Loop speed scales with content length so the tape never crawls.
    track.style.animationDuration = `${Math.max(30, items.length * 4)}s`
  }

  /** Titlebar chips: the first quotes of the tape, compact. */
  function renderChips(quotes: Quote[]): void {
    chips.textContent = ''
    const shown = quotes.length > 0 ? quotes.slice(0, 3) : DEFAULT_TAPE.slice(0, 3).map(placeholderQuote)
    for (const quote of shown) {
      const chip = document.createElement('span')
      chip.className = cls('tradingTitlebarChip')
      renderQuoteCell(chip, quote, cls('tradingTitlebarChipName'), cls('tradingTitlebarChipVal'), cls('tradingTitlebarChipChg'))
      chips.append(chip)
    }
  }

  /** Status-bar HK/US index cells: longbridge first, public feed fallback. */
  function renderIndexCells(quotes: Quote[]): void {
    for (let i = 0; i < lbCells.length; i += 1) {
      const cell = lbCells[i]
      const quote = quotes[i]
      if (quote === undefined) {
        cell.textContent = '-- --'
        delete cell.dataset.trend
        continue
      }
      cell.textContent = `${quote.name} ${priceText(quote.price)}`
      const trend = trendOf(quote)
      const chg = document.createElement('span')
      chg.textContent = `${trend === 'up' ? '▲' : trend === 'down' ? '▼' : ''}${pctText(trend, quote.changePct)}`
      cell.append(' ', chg)
      applyTrend(cell, trend)
    }
  }

  /** Session cells: A股 / 港股 / 美股 phases. */
  function renderSessions(now: Date): void {
    const phases = marketSessions(now)
    for (const [key, cell] of sessionCells) {
      const phase: SessionPhase = phases[key]
      cell.textContent = `${sessionLabels.find(([k]) => k === key)?.[1] ?? key} ${phaseLabel(phase)}`
      cell.dataset.phase = phase
    }
  }

  // ── data pollers ─────────────────────────────────────────────────────────────

  const connection = (() => {
    try {
      return ctx.get('connection') as ConnectionHandle | undefined
    } catch {
      return undefined
    }
  })()

  /** One quote cycle: fun-ticker watchlist first, standalone feeds second. */
  const refreshQuotes = async (): Promise<void> => {
    if (disposed) return
    let quotes: Quote[] = []
    const tickerSymbols = await fetchTickerSettings()
    if (tickerSymbols !== null) {
      const tickerQuotes = await fetchTickerQuotes(tickerSymbols)
      if (tickerQuotes !== null) quotes = tickerQuotes
    }
    if (quotes.length === 0) quotes = await fetchDirectQuotes(DEFAULT_TAPE)
    if (disposed) return
    renderTape(quotes)
    renderChips(quotes)
  }

  /** One longbridge cycle: broker snapshot, public indices fallback. */
  const refreshLongbridge = async (): Promise<void> => {
    if (disposed) return
    const longbridgeQuotes = await fetchLongbridgeQuotes(connection)
    if (longbridgeQuotes !== null && longbridgeQuotes.length > 0) {
      if (disposed) return
      lbLabel.textContent = '长桥'
      renderIndexCells(longbridgeQuotes)
      return
    }
    const fallback = await fetchDirectQuotes(DEFAULT_INDEX_CELLS)
    if (disposed) return
    lbLabel.textContent = '指数'
    renderIndexCells(fallback)
  }

  /** Workspace-count cell: how many workspaces the terminal is watching.
   *  Live data rides the workspace.list RPC when the connection handle is
   *  available; failures degrade to the dash — the stock chrome must never
   *  crash the terminal. */
  const refreshWorkspaces = async (): Promise<void> => {
    if (connection === undefined || disposed) return
    try {
      const list = await connection.api.workspace.list({})
      if (!list.result.ok) return
      if (disposed) return
      const count = list.result.value.items.length
      codeIndexCell.textContent = `工作区 ${count}`
    } catch {
      codeIndexCell.textContent = '工作区 --'
    }
  }

  // First paint: placeholders + session cells, then live cycles.
  renderTape([])
  renderChips([])
  renderIndexCells([])
  renderSessions(new Date())
  void refreshQuotes()
  void refreshLongbridge()
  void refreshWorkspaces()
  const quotesTimer = setInterval(() => { void refreshQuotes(); void refreshLongbridge() }, QUOTES_REFRESH_MS)
  const sessionTimer = setInterval(() => renderSessions(new Date()), SESSION_REFRESH_MS)
  const workspacesTimer = setInterval(() => { void refreshWorkspaces() }, WORKSPACES_REFRESH_MS)

  ctx.effect(() => () => {
    disposed = true
    clearInterval(quotesTimer)
    clearInterval(sessionTimer)
    clearInterval(workspacesTimer)
    delete body.dataset.dshTrading
    titlebar.remove()
    tape.remove()
    statusbar.remove()
    favicon.remove()
    // Only restore when the skin's own title still stands — a session title
    // projected by the shell must not be clobbered by skin teardown.
    if (document.title === SKIN_TITLE) document.title = originalTitle
  }, 'ui-skin-trading: trading chrome')
}
