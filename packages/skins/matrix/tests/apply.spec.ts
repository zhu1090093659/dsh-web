// @vitest-environment jsdom
/**
 * apply() owns the Matrix skin surface and retracts it on fiber dispose:
 * the `data-dsh-matrix` body attribute the stylesheet is scoped on and the
 * forced dark-theme flag (with its MutationObserver keep-alive). The rain
 * canvas is skipped in jsdom (canvas 2d context unavailable) — attribute
 * semantics are what this suite asserts.
 */
import { afterEach, describe, expect, it } from 'vitest'
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
