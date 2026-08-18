// @vitest-environment jsdom
/**
 * apply() owns the whole ambient surface and retracts it on fiber dispose:
 * the body attribute the stylesheet is scoped on, the painting backdrop
 * inline styles (with the live theme-scrim swap), and the injected
 * whale-mark favicon. Assert the writes and the teardown both ways —
 * including that a backdrop present before apply is restored verbatim.
 * Backdrop assertions go through the hyphenated CSSOM API (the same
 * setProperty/getPropertyValue channel the skin uses), which jsdom
 * round-trips faithfully.
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
  delete document.body.dataset.dshWhaleMom
  delete document.body.dataset.dsDarkTheme
  document.body.style.cssText = ''
  document.title = ''
})

describe('whale-mom skin apply', () => {
  it('mounts the ambient surface: attribute, backdrop, favicon', async () => {
    fiber = await mount()

    expect(document.body.dataset.dshWhaleMom).toBe('')
    expect(document.body.style.getPropertyValue('background-image')).toContain('data:image/jpeg;base64')
    expect(document.body.style.getPropertyValue('background-size')).toBe('cover')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('fixed')
    const favicon = document.head.querySelector('link[rel="icon"]')
    expect(favicon).not.toBeNull()
    expect((favicon as HTMLLinkElement).href).toContain('data:image/svg+xml')
  })

  it('uses the dark scrim while data-ds-dark-theme is set and swaps live', async () => {
    document.body.dataset.dsDarkTheme = ''
    fiber = await mount()

    // Dark scrim: the first background layer is the occlusion veil driven
    // by --dsw-skin-scrim, then the deep navy theme scrim.
    const darkImage = document.body.style.getPropertyValue('background-image')
    expect(darkImage).toContain('var(--dsw-skin-scrim, 0)')
    expect(darkImage).toContain('rgba(6, 10, 22, 0.42')
    expect(darkImage).toContain('url(data:image/jpeg;base64')

    // Flip to light: the scrim swaps without remounting (MutationObserver).
    delete document.body.dataset.dsDarkTheme
    await tick()
    const lightImage = document.body.style.getPropertyValue('background-image')
    expect(lightImage).toContain('rgba(18, 28, 56, 0.10')
  })

  it('retracts everything on fiber dispose and restores the prior backdrop', async () => {
    document.body.style.setProperty('background-image', 'url("https://example.test/prior.png")')
    document.body.style.setProperty('background-attachment', 'scroll')
    fiber = await mount()
    expect(document.body.style.getPropertyValue('background-image')).not.toContain('prior.png')

    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshWhaleMom).toBeUndefined()
    expect(document.body.style.getPropertyValue('background-image')).toContain('prior.png')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('scroll')
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })
})