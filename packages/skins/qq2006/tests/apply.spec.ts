// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

let fiber: Fiber | undefined

async function mount(): Promise<Fiber> {
  const mounted = new Context().plugin({ apply })
  await mounted.await()
  return mounted
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  document.body.innerHTML = ''
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => { link.remove() })
  delete document.body.dataset.dshQq2006
  document.title = ''
})

describe('QQ2006 skin apply', () => {
  it('mounts and retracts its complete surface', async () => {
    document.title = 'DeepSeek Harness'
    fiber = await mount()

    expect(document.body.dataset.dshQq2006).toBe('')
    expect(document.body.querySelector('[data-skin-chrome="titlebar"]')?.textContent).toContain('QQ2006')
    expect(document.body.querySelector('[data-skin-chrome="statusbar"]')?.textContent).toContain('Online')
    expect(document.title).toBe('QQ2006 · DeepSeek Online')
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull()

    await fiber.dispose()
    fiber = undefined
    expect(document.body.dataset.dshQq2006).toBeUndefined()
    expect(document.body.querySelector('[data-skin-chrome]')).toBeNull()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('does not overwrite a later session title during teardown', async () => {
    fiber = await mount()
    document.title = 'Session title · DSH'
    await fiber.dispose()
    fiber = undefined
    expect(document.title).toBe('Session title · DSH')
  })
})
