import { describe, expect, it } from 'vitest'
import { createInteractiveBrowserService } from '../src/screenshot/interactive-browser.ts'
import type { ElectronModuleLike } from '../src/screenshot/electron-backend.ts'

describe('interactive browser service', () => {
  it('reuses one persistent partition window and captures its current URL', async () => {
    const options: Record<string, unknown>[] = []
    let currentUrl = ''
    let destroyed = false
    let shown = 0
    let focused = 0
    class FakeWindow {
      webContents = {
        once: () => undefined,
        on: () => undefined,
        getURL: () => currentUrl,
        capturePage: async () => ({ toPNG: () => Buffer.from('shot'), getSize: () => ({ width: 900, height: 600 }) }),
      }
      constructor(value: Record<string, unknown>) { options.push(value) }
      async loadURL(url: string): Promise<void> { currentUrl = url }
      show(): void { shown += 1 }
      focus(): void { focused += 1 }
      destroy(): void { destroyed = true }
      close(): void { destroyed = true }
      isDestroyed(): boolean { return destroyed }
      on(): void {}
    }
    const electron = { BrowserWindow: FakeWindow } as unknown as ElectronModuleLike
    const service = createInteractiveBrowserService({ electron })

    await service.open('https://example.com/login')
    currentUrl = 'https://example.com/account'
    await service.open('https://example.com/account')
    const shot = await service.capture({ width: 900, height: 600 })

    expect(options).toHaveLength(1)
    expect((options[0].webPreferences as Record<string, unknown>).partition).toBe('persist:page-annotate')
    expect(shown).toBe(2)
    expect(focused).toBe(2)
    expect(shot).toMatchObject({ data: Buffer.from('shot'), width: 900, height: 600, url: 'https://example.com/account' })
    service.dispose()
    expect(destroyed).toBe(true)
  })

  it('requires an explicit open before capturing', async () => {
    const service = createInteractiveBrowserService({ electron: { BrowserWindow: class {} } as unknown as ElectronModuleLike })
    await expect(service.capture()).rejects.toMatchObject({ code: 'browser-not-open' })
  })
})
