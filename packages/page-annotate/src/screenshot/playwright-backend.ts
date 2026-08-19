/**
 * Playwright capture backend: headless Chromium launched through
 * playwright-core with an explicitly resolved executable. This is the
 * fallback for plain `dsh web` runs (no Electron shell): the chromium
 * binary comes from the ms-playwright cache or DSH_PAGE_ANNOTATE_CHROMIUM.
 * @module @linxin666/dsh-page-annotate/screenshot/playwright-backend
 */

/** The playwright-core module face we touch. */
export interface PlaywrightCoreLike {
  chromium: {
    launch(options: { executablePath?: string; headless: boolean; args?: string[] }): Promise<PlaywrightBrowserLike>
  }
}

/** Minimal browser/page faces. */
export interface PlaywrightBrowserLike {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PlaywrightPageLike>
  close(): Promise<void>
}

export interface PlaywrightPageLike {
  goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  screenshot(options: { type: 'png' }): Promise<Buffer>
}

/** Resolve the playwright-core module, or undefined when unavailable. */
export async function loadPlaywrightCore(): Promise<PlaywrightCoreLike | undefined> {
  try {
    const mod = await import('playwright-core')
    if (mod === null || typeof mod !== 'object' || (mod as { chromium?: unknown }).chromium === undefined) return undefined
    return mod as unknown as PlaywrightCoreLike
  } catch {
    return undefined
  }
}

/** Capture options for the playwright backend. */
export interface PlaywrightCaptureOptions {
  url: string
  width: number
  height: number
  timeoutMs: number
  executablePath: string
}

/** Settle delay after load before the screenshot (fonts/images). */
const SETTLE_MS = 350

/** Capture a page with headless Chromium; the browser is always closed. */
export async function captureWithPlaywright(core: PlaywrightCoreLike, options: PlaywrightCaptureOptions): Promise<Buffer> {
  const browser = await core.chromium.launch({
    executablePath: options.executablePath,
    headless: true,
    args: ['--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: options.width, height: options.height } })
    await page.goto(options.url, { waitUntil: 'load', timeout: options.timeoutMs })
    await page.waitForTimeout(SETTLE_MS)
    return await page.screenshot({ type: 'png' })
  } finally {
    await browser.close().catch(() => undefined)
  }
}
