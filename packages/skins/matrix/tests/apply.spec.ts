// @vitest-environment jsdom
/**
 * apply() owns the Matrix skin surface and retracts it on fiber dispose:
 * the `data-dsh-matrix` body attribute the stylesheet is scoped on and the
 * forced dark-theme flag (with its MutationObserver keep-alive). The rain
 * canvas is skipped in jsdom (canvas 2d context unavailable) — attribute
 * semantics are what this suite asserts; the canvas bitmap sizing is
 * covered by the mocked-context test below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

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
  delete document.body.dataset.dshMatrix
  delete document.body.dataset.dsDarkTheme
  vi.restoreAllMocks()
})

describe('Matrix skin apply', () => {
  it('mounts the body marker and forces the dark flag', async () => {
    fiber = await mount()

    expect(document.body.dataset.dshMatrix).toBe('')
    expect(document.body.dataset.dsDarkTheme).toBe('')
  })

  it('keeps the dark flag when the app clears it (MutationObserver keep-alive)', async () => {
    fiber = await mount()

    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(document.body.dataset.dsDarkTheme).toBe('')
  })

  it('keep-alive goes inert while the marker is retracted and re-arms on restore', async () => {
    fiber = await mount()
    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.body.dataset.dsDarkTheme).toBe('')

    // skin-center try-on retracts the scoping marker for the session; the
    // ghost observer must not fight the preview's light/dark flip.
    delete document.body.dataset.dshMatrix
    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.body.dataset.dsDarkTheme).toBeUndefined()

    // Restoring the marker (try-on exit) re-arms the keep-alive. Set the
    // flag to a concrete value first: deleting an already-absent attribute
    // emits no mutation, so the observer would have nothing to react to.
    document.body.dataset.dshMatrix = ''
    document.body.dataset.dsDarkTheme = 'light'
    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.body.dataset.dsDarkTheme).toBe('')
  })

  it('sizes the rain canvas at the display density, capped at 2', async () => {
    const fake = {
      fillRect: vi.fn(),
      fillText: vi.fn(),
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake)
    const originalDpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    try {
      fiber = await mount()
      const canvas = document.querySelector('canvas[data-plugin="dsh-matrix-skin"]') as HTMLCanvasElement | null
      expect(canvas).not.toBeNull()
      // devicePixelRatio 3 exceeds the DPR_CAP of 2, so the bitmap is 2x.
      expect(canvas!.width).toBe(Math.round(window.innerWidth * 2))
      expect(canvas!.height).toBe(Math.round(window.innerHeight * 2))
      // Drawing coordinates stay in CSS pixels via the scale transform.
      expect(fake.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
    } finally {
      if (originalDpr !== undefined) Object.defineProperty(window, 'devicePixelRatio', originalDpr)
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio
      spy.mockRestore()
    }
  })

  it('dispose retracts the marker and restores a previous dark flag', async () => {
    document.body.dataset.dsDarkTheme = ''
    fiber = await mount()

    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshMatrix).toBeUndefined()
    expect(document.body.dataset.dsDarkTheme).toBe('')
  })

  it('dispose restores absence when there was no prior dark flag', async () => {
    fiber = await mount()

    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshMatrix).toBeUndefined()
    expect(document.body.dataset.dsDarkTheme).toBeUndefined()
  })
})
