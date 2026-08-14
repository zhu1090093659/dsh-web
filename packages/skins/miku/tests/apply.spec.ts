// @vitest-environment jsdom
/**
 * Miku skin apply spec — the template contract: the body
 * attribute the stylesheet is scoped on is set on apply and retracted on
 * dispose, and every injected chrome element (marked data-skin-chrome) is
 * removed. Extend with assertions specific to your surface.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

let fiber: Fiber | undefined

async function mount(): Promise<Fiber> {
  const f = new Context().plugin({ apply })
  await f.await()
  return f
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.innerHTML = ''
  document.title = ''
})

describe('Miku skin apply', () => {
  it('sets the body attribute and retracts it on dispose', async () => {
    fiber = await mount()
    expect(document.body.hasAttribute('data-dsh-miku')).toBe(true)
    await fiber.dispose()
    expect(document.body.hasAttribute('data-dsh-miku')).toBe(false)
  })

  it('injects chrome and retracts every element on dispose', async () => {
    fiber = await mount()
    expect(document.body.querySelectorAll('[data-skin-chrome]').length).toBeGreaterThan(0)
    await fiber.dispose()
    expect(document.body.querySelectorAll('[data-skin-chrome]').length).toBe(0)
  })

  it('pins the skin title and restores the original on dispose', async () => {
    document.title = 'original'
    fiber = await mount()
    expect(document.title).not.toBe('original')
    await fiber.dispose()
    expect(document.title).toBe('original')
  })

  it('paints the backdrop straight onto the body and restores it on dispose', async () => {
    // jsdom normalizes hex colors to rgb() in the computed style, so the
    // sentinel is written and compared in rgb form.
    document.body.style.setProperty('background-image', 'linear-gradient(rgb(17, 17, 17), rgb(34, 34, 34))')
    fiber = await mount()
    // The art + scrim land on the body's inline background (jsdom normalizes
    // the data URI inside url() with quotes, so match on the media type).
    expect(document.body.style.backgroundImage).toContain('image/webp')
    expect(document.body.style.backgroundAttachment).toBe('fixed')
    await fiber.dispose()
    expect(document.body.style.backgroundImage).toBe('linear-gradient(rgb(17, 17, 17), rgb(34, 34, 34))')
    expect(document.body.style.backgroundAttachment).toBe('')
  })

  it('applies the Miku cursor to the body and restores it on dispose', async () => {
    document.body.style.setProperty('cursor', 'pointer')
    fiber = await mount()
    expect(document.body.style.cursor).toContain('data:image/png;base64')
    expect(document.body.style.cursor).toContain('5 7')
    await fiber.dispose()
    expect(document.body.style.cursor).toBe('pointer')
  })

  it('skips the custom cursor when dsh.miku.cursor is off', async () => {
    window.localStorage.setItem('dsh.miku.cursor', 'off')
    document.body.style.setProperty('cursor', 'crosshair')
    fiber = await mount()
    // The skin leaves the pre-existing cursor untouched.
    expect(document.body.style.cursor).toBe('crosshair')
  })

  it('honours the localStorage title override', async () => {
    window.localStorage.setItem('dsh.miku.title', 'Miku 定制标题')
    fiber = await mount()
    expect(document.title).toBe('Miku 定制标题')
    expect(document.querySelector('[data-skin-chrome="titlebar"]')?.textContent).toContain('Miku 定制标题')
  })

  it('honours the localStorage status-cell override', async () => {
    window.localStorage.setItem('dsh.miku.cells', JSON.stringify(['LIVE 01', 'TURBO']))
    fiber = await mount()
    const statusbar = document.querySelector('[data-skin-chrome="statusbar"]')
    const cells = statusbar?.querySelectorAll('[class*="StatusbarCell"]') ?? []
    expect(cells.length).toBe(2)
    expect(cells[0]?.textContent).toBe('LIVE 01')
    expect(cells[1]?.textContent).toBe('TURBO')
  })

  it('ignores a malformed status-cell override', async () => {
    window.localStorage.setItem('dsh.miku.cells', 'not-json')
    fiber = await mount()
    const statusbar = document.querySelector('[data-skin-chrome="statusbar"]')
    const cells = statusbar?.querySelectorAll('[class*="StatusbarCell"]') ?? []
    expect(cells.length).toBeGreaterThan(1)
  })
})
