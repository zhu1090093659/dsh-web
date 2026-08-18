// @vitest-environment jsdom
/**
 * Miku skin apply spec — the template contract: the body
 * attribute the stylesheet is scoped on is set on apply and retracted on
 * dispose, and every injected chrome element (marked data-skin-chrome) is
 * removed. Extend with assertions specific to your surface.
 *
 * Node >= 22.4 ships a native global localStorage that Vitest 4's jsdom
 * environment does not replace, so the tests stub a deterministic in-memory
 * implementation instead of relying on the environment's storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

let fiber: Fiber | undefined

/** A deterministic in-memory Storage, safe on every supported Node version. */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  const storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
  } as Storage
  return storage
}

/** The default status-cell count (see STATUS_CELLS in src/client/index.ts). */
const DEFAULT_CELL_COUNT = 5

/** Collect the injected status cells via their stable data marker. */
function cellsOf(): Element[] {
  const statusbar = document.querySelector('[data-skin-chrome="statusbar"]')
  return Array.from(statusbar?.querySelectorAll('[data-skin-cell]') ?? [])
}

async function mount(): Promise<Fiber> {
  const f = new Context().plugin({ apply })
  await f.await()
  return f
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  document.body.removeAttribute('style')
})

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.innerHTML = ''
  document.body.removeAttribute('style')
  document.title = ''
  vi.unstubAllGlobals()
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

  it('injects the custom cursor stylesheet and retracts it on dispose', async () => {
    fiber = await mount()
    const style = document.head.querySelector<HTMLStyleElement>('style[data-skin-chrome="cursor"]')
    expect(style).not.toBeNull()
    // The inline PNG cursor surface maps the default state and the text /
    // pointer states, all as base64 data URIs.
    expect(style?.textContent).toContain('data:image/png;base64,')
    expect(style?.textContent).toContain('cursor: url(')
    expect(style?.textContent).toContain('cursor: url("data:image/png;base64,')
    expect(style?.textContent).toContain(', text;')
    await fiber.dispose()
    expect(document.head.querySelector('style[data-skin-chrome="cursor"]')).toBeNull()
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
    // Light theme wears the JPEG seaside-girl art, dark theme the PNG Miku art.
    expect(document.body.style.backgroundImage).toContain('image/jpeg')
    expect(document.body.style.backgroundAttachment).toBe('fixed')
    await fiber.dispose()
    expect(document.body.style.backgroundImage).toBe('linear-gradient(rgb(17, 17, 17), rgb(34, 34, 34))')
    expect(document.body.style.backgroundAttachment).toBe('')
  })

  it('swaps to the dark-theme Miku art when the theme flips', async () => {
    fiber = await mount()
    expect(document.body.style.backgroundImage).toContain('image/jpeg')
    // The scrim swap runs in a MutationObserver callback, so let a tick pass.
    document.body.setAttribute('data-ds-dark-theme', '')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.body.style.backgroundImage).toContain('image/png')
    document.body.removeAttribute('data-ds-dark-theme')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.body.style.backgroundImage).toContain('image/jpeg')
  })

  it('honours the localStorage title override', async () => {
    window.localStorage.setItem('dsh.miku.title', 'Miku 定制标题')
    fiber = await mount()
    expect(document.title).toBe('Miku 定制标题')
    expect(document.querySelector('[data-skin-chrome="titlebar"]')?.textContent).toContain('Miku 定制标题')
  })

  it('falls back to the default title when the override is over-long', async () => {
    window.localStorage.setItem('dsh.miku.title', 'x'.repeat(201))
    fiber = await mount()
    expect(document.title).toContain('DeepSeek')
  })

  it('honours the localStorage status-cell override', async () => {
    window.localStorage.setItem('dsh.miku.cells', JSON.stringify(['LIVE 01', 'TURBO']))
    fiber = await mount()
    const cells = cellsOf()
    expect(cells.length).toBe(2)
    expect(cells[0]?.textContent).toBe('LIVE 01')
    expect(cells[1]?.textContent).toBe('TURBO')
  })

  it('ignores a malformed status-cell override', async () => {
    window.localStorage.setItem('dsh.miku.cells', 'not-json')
    fiber = await mount()
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
  })

  it('ignores a non-array status-cell override', async () => {
    window.localStorage.setItem('dsh.miku.cells', JSON.stringify({ live: '01' }))
    fiber = await mount()
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
  })

  it('ignores an empty status-cell array', async () => {
    window.localStorage.setItem('dsh.miku.cells', '[]')
    fiber = await mount()
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
  })

  it('rejects a status-cell override containing blank cells', async () => {
    window.localStorage.setItem('dsh.miku.cells', JSON.stringify(['   ', 'x']))
    fiber = await mount()
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
  })

  it('rejects an oversized status-cell override', async () => {
    window.localStorage.setItem(
      'dsh.miku.cells',
      JSON.stringify(Array.from({ length: 21 }, (_, i) => `cell ${i}`)),
    )
    fiber = await mount()
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
  })

  it('rejects an over-long status cell', async () => {
    window.localStorage.setItem('dsh.miku.cells', JSON.stringify(['x'.repeat(65)]))
    fiber = await mount()
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
  })

  it('trims whitespace from status cells', async () => {
    window.localStorage.setItem('dsh.miku.cells', JSON.stringify(['  LIVE 01  ', 'TURBO']))
    fiber = await mount()
    const cells = cellsOf()
    expect(cells.length).toBe(2)
    expect(cells[0]?.textContent).toBe('LIVE 01')
  })

  it('degrades to the defaults when localStorage access throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage blocked')
      },
    } as unknown as Storage)
    fiber = await mount()
    expect(document.title).toContain('DeepSeek')
    expect(cellsOf().length).toBe(DEFAULT_CELL_COUNT)
    expect(document.body.hasAttribute('data-dsh-miku')).toBe(true)
  })
})
