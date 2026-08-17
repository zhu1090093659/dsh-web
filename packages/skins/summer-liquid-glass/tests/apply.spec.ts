// @vitest-environment jsdom
/**
 * apply() owns the whole ambient surface and retracts it on fiber dispose:
 * the body attribute the stylesheet is scoped on, the night-art backdrop
 * inline styles (with the deep-navy readability mask and the upper-center
 * position), and the injected favicon. Assert the writes and the teardown
 * both ways — including that a backdrop present before apply is restored
 * verbatim.
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
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => { link.remove() })
  delete document.body.dataset.dshSummerLiquidGlass
  delete document.body.dataset.dsDarkTheme
  document.body.style.cssText = ''
  document.title = ''
})

describe('summer-liquid-glass skin apply', () => {
  it('mounts the ambient surface: attribute, backdrop, favicon', async () => {
    fiber = await mount()

    expect(document.body.dataset.dshSummerLiquidGlass).toBe('')
    expect(document.body.style.getPropertyValue('background-image')).toContain('data:image/jpeg')
    expect(document.body.style.getPropertyValue('background-size')).toBe('cover')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('fixed')
    expect(document.body.style.getPropertyValue('background-position')).toBe('center 30%')
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull()
  })

  it('lays the readability mask over the art', async () => {
    fiber = await mount()
    const image = document.body.style.getPropertyValue('background-image')
    expect(image).toContain('rgba(7, 19, 33')
    expect(image).toContain('url(data:image/jpeg')
    expect(image).toContain('var(--dsw-glass-mask')
  })

  it('retracts everything on fiber dispose and restores the prior backdrop', async () => {
    document.body.style.setProperty('background-image', 'url("https://example.test/prior.png")')
    document.body.style.setProperty('background-attachment', 'scroll')
    fiber = await mount()
    expect(document.body.style.getPropertyValue('background-image')).not.toContain('prior.png')

    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshSummerLiquidGlass).toBeUndefined()
    expect(document.body.style.getPropertyValue('background-image')).toContain('prior.png')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('scroll')
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })
})
