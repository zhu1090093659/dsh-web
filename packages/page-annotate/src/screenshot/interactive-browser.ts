/** User-triggered persistent Electron browser session for pages that refuse iframe embedding. */

import { loadElectronModule, type ElectronModuleLike } from './electron-backend.ts'

interface InteractiveImageLike {
  toPNG(): Buffer
  getSize(): { width: number; height: number }
}

interface InteractiveWebContentsLike {
  capturePage(): Promise<InteractiveImageLike>
  getURL(): string
  setWindowOpenHandler?(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
}

interface InteractiveWindowLike {
  loadURL(url: string): Promise<void>
  show(): void
  focus(): void
  destroy(): void
  isDestroyed?(): boolean
  setSize?(width: number, height: number): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  webContents: InteractiveWebContentsLike
}

export interface InteractiveCaptureResult {
  data: Buffer
  width: number
  height: number
  url: string
}

export interface InteractiveBrowserService {
  open(url: string): Promise<{ url: string }>
  capture(viewport?: { width: number; height: number }): Promise<InteractiveCaptureResult>
  dispose(): void
}

export interface InteractiveBrowserOptions {
  electron?: ElectronModuleLike
  partition?: string
}

/** Create one lazy, reusable desktop browser window. It is shown only by open(). */
export function createInteractiveBrowserService(options: InteractiveBrowserOptions = {}): InteractiveBrowserService {
  let window: InteractiveWindowLike | undefined
  let electronPromise: Promise<ElectronModuleLike | undefined> | undefined
  const partition = options.partition ?? 'persist:page-annotate'

  const electron = async (): Promise<ElectronModuleLike> => {
    electronPromise ??= Promise.resolve(options.electron ?? loadElectronModule())
    const resolved = await electronPromise
    if (resolved === undefined) throw Object.assign(new Error('interactive Electron browser unavailable'), { code: 'no-engine' })
    return resolved
  }

  const alive = (): InteractiveWindowLike | undefined => {
    if (window === undefined) return undefined
    if (window.isDestroyed?.() === true) window = undefined
    return window
  }

  const ensureWindow = async (): Promise<InteractiveWindowLike> => {
    const existing = alive()
    if (existing !== undefined) return existing
    const mod = await electron()
    const created = new mod.BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      title: 'DSH 网页批注 - 交互浏览器',
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    }) as unknown as InteractiveWindowLike
    created.on('closed', () => {
      if (window === created) window = undefined
    })
    created.webContents.setWindowOpenHandler?.(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void created.loadURL(url).catch(() => undefined)
      }
      return { action: 'deny' }
    })
    window = created
    return created
  }

  return {
    async open(url) {
      const target = await ensureWindow()
      if (target.webContents.getURL() !== url) await target.loadURL(url)
      target.show()
      target.focus()
      return { url: target.webContents.getURL() || url }
    },
    async capture(viewport) {
      const target = alive()
      if (target === undefined) throw Object.assign(new Error('open the interactive browser first'), { code: 'browser-not-open' })
      if (viewport !== undefined) target.setSize?.(viewport.width, viewport.height)
      const image = await target.webContents.capturePage()
      const size = image.getSize()
      return { data: image.toPNG(), width: size.width, height: size.height, url: target.webContents.getURL() }
    },
    dispose() {
      const target = alive()
      window = undefined
      if (target !== undefined) target.destroy()
    },
  }
}
