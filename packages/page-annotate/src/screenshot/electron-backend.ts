/**
 * Electron capture backend: an offscreen BrowserWindow in the DSH Desktop
 * shell. The shell runs cordis plugins inside the Electron main process, so
 * `import('electron')` resolves there and gives us a real Chromium engine
 * (the "chrome kernel") whose webContents.capturePage() yields pixel-perfect
 * page screenshots. The electron module is deliberately NOT declared as a
 * dependency — it exists only inside the desktop shell; everywhere else this
 * backend reports unavailable and the service falls back to Playwright.
 *
 * Structural types only (no electron type package): the module is cast at
 * the boundary and every used face is spelled out here.
 * @module @linxin666/dsh-page-annotate/screenshot/electron-backend
 */

/** The minimal webContents face we touch. */
export interface ElectronWebContentsLike {
  once(event: string, listener: (...args: unknown[]) => void): unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
  capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<{ toPNG(): Buffer }>
}

/** The minimal BrowserWindow face we touch. */
export interface ElectronBrowserWindowLike {
  loadURL(url: string): Promise<void>
  destroy(): void
  close(): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  webContents: ElectronWebContentsLike
}

/** The electron module face (BrowserWindow constructor + app). */
export interface ElectronModuleLike {
  BrowserWindow: new (options: Record<string, unknown>) => ElectronBrowserWindowLike
}

/** Resolve the electron module, or undefined when unavailable. */
export async function loadElectronModule(): Promise<ElectronModuleLike | undefined> {
  try {
    const mod = await import('electron')
    if (typeof (mod as { BrowserWindow?: unknown }).BrowserWindow !== 'function') return undefined
    return mod as unknown as ElectronModuleLike
  } catch {
    return undefined
  }
}

/** Capture options for the electron backend. */
export interface ElectronCaptureOptions {
  url: string
  width: number
  height: number
  timeoutMs: number
}

/** Settle delay after did-finish-load before capturing (fonts/images). */
const SETTLE_MS = 350

/**
 * Capture a page with an offscreen BrowserWindow. Throws a coded error on
 * navigation failure or timeout; the window is always destroyed.
 */
export async function captureWithElectron(electron: ElectronModuleLike, options: ElectronCaptureOptions): Promise<Buffer> {
  const window = new electron.BrowserWindow({
    show: false,
    width: options.width,
    height: options.height,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  let settled = false
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) reject(Object.assign(new Error('electron capture timeout'), { code: 'timeout' }))
      }, options.timeoutMs)
      window.webContents.once('did-finish-load', () => {
        settled = true
        clearTimeout(timer)
        setTimeout(resolve, SETTLE_MS)
      })
      window.webContents.once('did-fail-load', (_event: unknown, errorCode: unknown, errorDescription: unknown) => {
        settled = true
        clearTimeout(timer)
        reject(Object.assign(new Error(`navigation failed: ${String(errorDescription)} (${Number(errorCode)})`), { code: 'navigation-failed' }))
      })
      void window.loadURL(options.url).catch((error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: options.width, height: options.height })
    return image.toPNG()
  } finally {
    try {
      window.destroy()
    } catch {
      // the window may already be gone
    }
  }
}
