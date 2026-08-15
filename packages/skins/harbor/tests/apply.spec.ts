// @vitest-environment jsdom
/**
 * apply() owns the whole dusk surface and retracts it on fiber dispose:
 * the body attribute the stylesheet is scoped on, the harbor-art backdrop
 * inline styles (with the live theme-scrim swap), and the injected favicon.
 * Assert the writes and the teardown both ways — including that a backdrop
 * present before apply is restored verbatim. Backdrop assertions go through
 * the hyphenated CSSOM API (the same setProperty/getPropertyValue channel
 * the skin uses), which jsdom round-trips faithfully.
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

/** MutationObserver delivers asynchronously; flush its microtask queue. */
async function tick(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.innerHTML = ''
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => { link.remove() })
  delete document.body.dataset.dshHarbor
  delete document.body.dataset.dsDarkTheme
  document.body.style.cssText = ''
  document.title = ''
})

describe('harbor skin apply', () => {
  it('mounts the dusk surface: attribute, backdrop, favicon', async () => {
    fiber = await mount()

    expect(document.body.dataset.dshHarbor).toBe('')
    expect(document.body.style.getPropertyValue('background-image')).toContain('data:image/webp;base64')
    expect(document.body.style.getPropertyValue('background-size')).toBe('cover')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('fixed')
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull()
  })

  it('uses the dark scrim while data-ds-dark-theme is set and swaps live', async () => {
    document.body.dataset.dsDarkTheme = ''
    fiber = await mount()

    // Dark scrim: the first background layer is the deeper dusk veil.
    const darkImage = document.body.style.getPropertyValue('background-image')
    expect(darkImage).toContain('rgba(11, 14, 26')
    expect(darkImage).toContain('url(data:image/webp;base64')

    // Flip to light: the scrim swaps without remounting (MutationObserver).
    delete document.body.dataset.dsDarkTheme
    await tick()
    const lightImage = document.body.style.getPropertyValue('background-image')
    expect(lightImage).toContain('rgba(20, 26, 46')
  })

  it('retracts everything on fiber dispose and restores the prior backdrop', async () => {
    document.body.style.setProperty('background-image', 'url("https://example.test/prior.png")')
    document.body.style.setProperty('background-attachment', 'scroll')
    fiber = await mount()
    expect(document.body.style.getPropertyValue('background-image')).not.toContain('prior.png')

    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshHarbor).toBeUndefined()
    expect(document.body.style.getPropertyValue('background-image')).toContain('prior.png')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('scroll')
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })
})
