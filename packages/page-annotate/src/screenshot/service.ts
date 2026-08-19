/**
 * Capture service: selects a working engine (Electron offscreen in the
 * desktop shell, Playwright headless Chromium otherwise) and captures a
 * viewport-sized PNG of a URL. Engine selection and the electron/playwright
 * factories are injectable so tests can exercise the routing without real
 * browsers.
 * @module @linxin666/dsh-page-annotate/screenshot/service
 */

import { captureWithElectron, loadElectronModule, type ElectronModuleLike } from './electron-backend.ts'
import { captureWithPlaywright, loadPlaywrightCore, type PlaywrightCoreLike } from './playwright-backend.ts'
import { resolveChromiumExecutable } from './resolve-chromium.ts'

/** One capture request (already validated/clamped by the route). */
export interface ScreenshotRequest {
  url: string
  width: number
  height: number
  timeoutMs?: number
}

/** A successful capture result. */
export interface ScreenshotResult {
  data: Buffer
  mimeType: 'image/png'
  width: number
  height: number
  engine: 'electron' | 'playwright'
}

/** Coded capture failure (message is user-safe). */
export interface CaptureError {
  code: 'no-engine' | 'launch-failed' | 'navigation-failed' | 'timeout' | 'capture-failed'
  message: string
}

/** Default capture timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 25_000

/** The capture service face routes consume. */
export interface CaptureService {
  capture(request: ScreenshotRequest): Promise<ScreenshotResult>
  health(): Promise<{ engines: Array<'electron' | 'playwright'>; chromiumPath: string | undefined }>
}

/** Injectable wiring for the service. */
export interface CaptureServiceOptions {
  electronModule?: Promise<ElectronModuleLike | undefined>
  playwrightCore?: Promise<PlaywrightCoreLike | undefined>
  chromiumPath?: string | undefined
  timeoutMs?: number
}

/** Wrap any thrown error into a coded CaptureError. */
function asCaptureError(error: unknown): CaptureError {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code
    if (code === 'timeout') return { code: 'timeout', message: 'capture timed out' }
    if (code === 'navigation-failed') return { code: 'navigation-failed', message: error.message }
  }
  return { code: 'capture-failed', message: error instanceof Error ? error.message : String(error) }
}

/**
 * Create the capture service. Engine order: electron (desktop shell) first,
 * playwright fallback. When neither can run, `capture` rejects with
 * 'no-engine'.
 */
export function createCaptureService(options: CaptureServiceOptions = {}): CaptureService {
  const electronModule = options.electronModule ?? loadElectronModule()
  const playwrightCore = options.playwrightCore ?? loadPlaywrightCore()
  const chromiumPath = options.chromiumPath === undefined ? resolveChromiumExecutable() : options.chromiumPath
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const engines = async (): Promise<Array<'electron' | 'playwright'>> => {
    const engines: Array<'electron' | 'playwright'> = []
    if ((await electronModule) !== undefined) engines.push('electron')
    if ((await playwrightCore) !== undefined && chromiumPath !== undefined) engines.push('playwright')
    return engines
  }

  return {
    async capture(request) {
      const electron = await electronModule
      if (electron !== undefined) {
        try {
          const data = await captureWithElectron(electron, {
            url: request.url,
            width: request.width,
            height: request.height,
            timeoutMs: request.timeoutMs ?? timeoutMs,
          })
          return { data, mimeType: 'image/png', width: request.width, height: request.height, engine: 'electron' }
        } catch (error) {
          // Fall through to playwright rather than failing the whole request:
          // offscreen capture can fail on odd window configurations.
          const code = (error as Error & { code?: string }).code
          if (code === 'no-engine') throw asCaptureError(error)
        }
      }
      const core = await playwrightCore
      if (core !== undefined && chromiumPath !== undefined) {
        try {
          const data = await captureWithPlaywright(core, {
            url: request.url,
            width: request.width,
            height: request.height,
            timeoutMs: request.timeoutMs ?? timeoutMs,
            executablePath: chromiumPath,
          })
          return { data, mimeType: 'image/png', width: request.width, height: request.height, engine: 'playwright' }
        } catch (error) {
          throw asCaptureError(error)
        }
      }
      throw { code: 'no-engine', message: 'no capture engine available (needs the DSH Desktop shell or a Playwright Chromium binary; set DSH_PAGE_ANNOTATE_CHROMIUM to point at one)' } as CaptureError
    },
    async health() {
      return { engines: await engines(), chromiumPath }
    },
  }
}
