// @vitest-environment jsdom
/**
 * Trading-terminal skin apply spec — the ThemePresenter retraction
 * contract: the body attribute the stylesheet is scoped on is set on apply
 * and retracted on dispose, every injected chrome element (marked
 * data-skin-chrome) is removed, and the document title is pinned then
 * restored — without ever clobbering a session title projected over the
 * skin title. Also asserts the pre-data chrome: the tape renders two
 * placeholder copies, the status bar carries the three market-session
 * cells with their phase attribute, the longbridge index cells and the
 * code-index cell, and the favicon is injected and removed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { DEFAULT_INDEX_CELLS, DEFAULT_TAPE } from '../src/client/quotes.ts'

let fiber: Fiber | undefined

async function mount(): Promise<Fiber> {
  const f = new Context().plugin({ apply })
  await f.await()
  return f
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.innerHTML = ''
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => { link.remove() })
  delete document.body.dataset.dshTrading
  document.title = ''
})

describe('Trading-terminal skin apply', () => {
  it('mounts the terminal surface: attribute, chrome bars, title, favicon', async () => {
    document.title = 'DeepSeek Harness'
    fiber = await mount()

    expect(document.body.dataset.dshTrading).toBe('')
    const titlebar = document.body.querySelector('[class*="tradingTitlebar"]')
    const tape = document.body.querySelector('[class*="tradingTape"]')
    const statusbar = document.body.querySelector('[class*="tradingStatusbar"]')
    expect(titlebar).not.toBeNull()
    expect(tape).not.toBeNull()
    expect(statusbar).not.toBeNull()
    expect(titlebar?.textContent).toContain('交易终端 · DeepSeek 在线')
    // Decorative window buttons.
    expect(titlebar?.querySelectorAll('[class*="tradingTitlebarBtn"]').length).toBe(3)
    // The tape renders two copies of the placeholder watchlist for the loop.
    const items = tape?.querySelectorAll('[class*="tradingTapeItem"]')
    expect(items?.length).toBe(DEFAULT_TAPE.length * 2)
    expect(items?.[0]?.textContent).toContain('sh000001')
    // Session cells carry their phase attribute.
    const aShare = statusbar?.querySelector('[class*="tradingStatusbarCell"][data-phase]')
    expect(aShare).not.toBeNull()
    expect(statusbar?.textContent).toContain('A股')
    // Longbridge index cells and the workspace-count cell exist.
    const lbCells = statusbar?.querySelectorAll('[class*="tradingStatusbarCell"]')
    expect(lbCells?.length).toBeGreaterThanOrEqual(3 + DEFAULT_INDEX_CELLS.length + 3 + 1)
    expect(statusbar?.textContent).toContain('工作区')
    expect(document.title).toBe('交易终端 · DeepSeek 在线')
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull()
  })

  it('retracts everything on fiber dispose', async () => {
    document.title = 'DeepSeek Harness'
    fiber = await mount()
    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshTrading).toBeUndefined()
    expect(document.body.querySelector('[class*="tradingTitlebar"]')).toBeNull()
    expect(document.body.querySelector('[class*="tradingTape"]')).toBeNull()
    expect(document.body.querySelector('[class*="tradingStatusbar"]')).toBeNull()
    expect(document.body.querySelectorAll('[data-skin-chrome]').length).toBe(0)
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('never clobbers a session title projected over the skin title on teardown', async () => {
    fiber = await mount()
    document.title = '我的会话 — 交易终端 · DeepSeek 在线'
    await fiber.dispose()
    fiber = undefined

    expect(document.title).toBe('我的会话 — 交易终端 · DeepSeek 在线')
  })

  it('keeps the chrome alive without network or services (graceful degradation)', async () => {
    fiber = await mount()
    // No fetch, no connection: the chrome still renders with placeholders
    // and the session cells still carry phases. The quote pollers fail
    // silently — nothing may throw out of apply.
    expect(document.body.querySelectorAll('[class*="tradingTapeItem"]').length).toBeGreaterThan(0)
    expect(document.body.querySelector('[class*="tradingStatusbarCell"][data-phase]')).not.toBeNull()
    expect(document.body.textContent).toContain('工作区 --')
  })
})
