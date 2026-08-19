/**
 * Host half of the page-annotate plugin — runs in the DSH host process.
 *
 * Registers the /page-annotate screenshot + health + attach routes. The
 * screenshot service picks the best capture engine at runtime: an offscreen
 * Electron BrowserWindow when the plugin runs inside the DSH Desktop shell
 * (a real Chromium engine), headless Playwright Chromium otherwise. Routes
 * are loopback-fenced like the rest of the family; the attach seam is the
 * plugin's own image persistence fallback (the client prefers the
 * describe-image attach route when present).
 * @module @linxin666/dsh-page-annotate
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context member from the host SDK.
import type {} from '@deepseek-ai/dsh-host-webserver'
import Schema from 'schemastery'
import type { AttachmentStoreFace } from './attach-routes.ts'
import { makeAttachRoutes } from './attach-routes.ts'
import { mountOnce } from './mount-once.ts'
import { makeInteractiveBrowserRoutes, makeScreenshotRoutes, type WebRoute } from './routes.ts'
import { createInteractiveBrowserService } from './screenshot/interactive-browser.ts'
import { createCaptureService } from './screenshot/service.ts'

export const name = 'page-annotate'
export const inject = ['webServer']

/** Host configuration (Settings → 插件配置, namespace page-annotate). */
export const Config = Schema.object({
  /** Per-capture timeout in milliseconds. */
  screenshotTimeoutMs: Schema.number().min(1_000).max(120_000).default(25_000),
})

export interface PageAnnotateConfig {
  screenshotTimeoutMs: number
}

/** Register the host routes (single instance guard for aggregate coexistence). */
function applyImpl(ctx: Context, config: PageAnnotateConfig): void {
  const service = createCaptureService({ timeoutMs: config.screenshotTimeoutMs })
  const browser = createInteractiveBrowserService()
  const routes: WebRoute[] = [
    ...makeScreenshotRoutes(service),
    ...makeInteractiveBrowserRoutes(browser),
    ...makeAttachRoutes(() => ctx.get('attachments') as unknown as AttachmentStoreFace | undefined),
  ]
  const disposers = routes.map((route) => ctx.webServer.register(route))
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
    browser.dispose()
  }, 'page-annotate: routes')
}

/** Apply the host half (mount-once keeps aggregate + standalone coexistence safe). */
export const apply = mountOnce('@linxin666/dsh-page-annotate', applyImpl)
