// @vitest-environment jsdom
/**
 * aurora skin apply/dispose contract: the body attribute the stylesheet is
 * scoped on, the injected scene layer, and the background-color override are
 * all retracted on fiber dispose.
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
  document.body.style.removeProperty('background-color')
  delete document.body.dataset.dshAuroraNebula
})

describe('aurora skin apply', () => {
  it('mounts the scene: body attribute, scene layer, background override', async () => {
    fiber = await mount()

    expect(document.body.dataset.dshAuroraNebula).toBe('')
    expect(document.getElementById('dsh-bg')).not.toBeNull()
    expect(document.body.style.getPropertyValue('background-color')).not.toBe('')
  })

  it('switches base color with the dark-theme attribute', async () => {
    fiber = await mount()
    const lightBg = document.body.style.getPropertyValue('background-color')
    document.body.setAttribute('data-ds-dark-theme', '')
    await new Promise(resolve => setTimeout(resolve, 0))
    const darkBg = document.body.style.getPropertyValue('background-color')
    expect(darkBg).not.toBe(lightBg)
    document.body.removeAttribute('data-ds-dark-theme')
  })

  it('retracts everything on fiber dispose', async () => {
    const previous = document.body.style.getPropertyValue('background-color') || ''
    fiber = await mount()
    expect(document.body.style.getPropertyValue('background-color')).not.toBe(previous)
    await fiber.dispose()
    fiber = undefined

    expect(document.body.dataset.dshAuroraNebula).toBeUndefined()
    expect(document.getElementById('dsh-bg')).toBeNull()
    expect(document.body.style.getPropertyValue('background-color')).toBe(previous)
  })
})
