// @vitest-environment jsdom
/** Violet Evergarden skin lifecycle tests. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

let fiber: Fiber | undefined

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

async function mount(): Promise<Fiber> {
  const mounted = new Context().plugin({ apply })
  await mounted.await()
  return mounted
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.removeAttribute('data-dsh-violet')
  document.body.removeAttribute('style')
  document.title = ''
})

describe('Violet Evergarden skin apply', () => {
  it('sets and retracts the scoped body attribute', async () => {
    fiber = await mount()
    expect(document.body.hasAttribute('data-dsh-violet')).toBe(true)
    await fiber.dispose()
    expect(document.body.hasAttribute('data-dsh-violet')).toBe(false)
  })

  it('applies and restores the embedded wallpaper on body', async () => {
    document.body.style.setProperty('background-position', 'left top')
    fiber = await mount()
    expect(document.body.style.backgroundImage).toContain('data:image/jpeg;base64')
    expect(document.body.style.backgroundPosition).toBe('center center, center center')
    await fiber.dispose()
    expect(document.body.style.backgroundPosition).toBe('left top')
  })

  it('owns its title for the mounted lifetime', async () => {
    document.title = 'original'
    fiber = await mount()
    expect(document.title).toBe('Violet Evergarden · DeepSeek')
    await fiber.dispose()
    expect(document.title).toBe('original')
  })
})
