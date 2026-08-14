// @vitest-environment jsdom
/**
 * apply() owns the whole ambient surface and retracts it on fiber dispose:
 * the body attribute the stylesheet is scoped on, the whale-art backdrop
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
  delete document.body.dataset.dshBlueFantasy
  delete document.body.dataset.dsDarkTheme
  document.body.style.cssText = ''
  document.title = ''
})

describe('blue-fantasy skin apply', () => {
  it('mounts the ambient surface: attribute, backdrop, favicon', async () => {
    fiber = await mount()

    expect(document.body.dataset.dshBlueFantasy).toBe('')
    expect(document.body.style.getPropertyValue('background-image')).toContain('data:image/jpeg;base64')
    expect(document.body.style.getPropertyValue('background-size')).toBe('cover')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('fixed')
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull()
  })

  it('uses the dark scrim while data-ds-dark-theme is set and swaps live', async () => {
    document.body.dataset.dsDarkTheme = ''
    fiber = await mount()

    // Dark scrim: the first background layer is the dark indigo veil.
    const darkImage = document.body.style.getPropertyValue('background-image')
    expect(darkImage).toContain('rgba(10, 14, 28')
    expect(darkImage).toContain('url(data:image/jpeg;base64')

    // Flip to light: the scrim swaps without remounting (MutationObserver).
    delete document.body.dataset.dsDarkTheme
    await tick()
    const lightImage = document.body.style.getPropertyValue('background-image')
    expect(lightImage).toContain('rgba(246, 248, 253')
  })

  it('retracts everything on fiber dispose and restores the prior backdrop', async () => {
    document.body.style.setProperty('background-image', 'url("https://example.test/prior.png")')
    document.body.style.setProperty('background-attachment', 'scroll')
    fiber = await mount()
    expect(document.body.style.getPropertyValue('background-image')).not.toContain('prior.png')

    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshBlueFantasy).toBeUndefined()
    expect(document.body.style.getPropertyValue('background-image')).toContain('prior.png')
    expect(document.body.style.getPropertyValue('background-attachment')).toBe('scroll')
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })

  it('adds a veil layer when the skin-center scrim variable is set, and drops it on dispose', async () => {
    // The skin-center control writes --dsw-skin-scrim (0..1) on body; the
    // veil gradient's alpha rides the CSS variable so the backdrop
    // re-rasters live as the control moves.
    document.body.style.setProperty('--dsw-skin-scrim', '0.65')
    fiber = await mount()

    // The occlusion layer is the FIRST background layer, before the scrim.
    const veiled = document.body.style.getPropertyValue('background-image')
    expect(veiled).toContain('var(--dsw-skin-scrim, 0)')
    expect(veiled.indexOf('var(--dsw-skin-scrim, 0)')).toBeLessThan(veiled.indexOf('rgba(246, 248, 253'))

    // Flip to dark: the theme scrim swaps but the occlusion stays and is
    // always first (living MutationObserver re-reads the variable).
    document.body.dataset.dsDarkTheme = ''
    await tick()
    const veiledDark = document.body.style.getPropertyValue('background-image')
    expect(veiledDark).toContain('var(--dsw-skin-scrim, 0)')
    expect(veiledDark).toContain('rgba(10, 14, 28')

    await fiber.dispose()
    fiber = undefined
    // The veil lives in the background-image the skin owns; on dispose the
    // backdrop restores to nothing (no prior backdrop in this test).
    expect(document.body.style.getPropertyValue('background-image')).toBe('')
  })

  it('keeps the stock scrim when the scrim variable is 0 or unset', async () => {
    document.body.style.setProperty('--dsw-skin-scrim', '0')
    fiber = await mount()
    const image = document.body.style.getPropertyValue('background-image')
    // The veil layer is present but its alpha is variable-driven (0 renders
    // invisible), so no literal 0-alpha color is baked into the string.
    expect(image).toContain('var(--dsw-skin-scrim, 0)')
    expect(image).not.toContain('rgba(16, 22, 42, 0)')
    expect(image).toContain('rgba(246, 248, 253')
  })
})
