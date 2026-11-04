/**
 * Host half of the diagrams plugin: mounts the vendor route that serves the
 * mermaid runtime to the browser half. No other host surface — the enhancement
 * itself runs in the page.
 * @module @linxin666/dsh-client-ui-diagrams
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeRoutes } from './routes.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name (equals the row name the loader mounts). */
export const name = 'diagrams'

/** Only the host webserver is required; the page half needs no service. */
export const inject = ['webServer']

/** Route path, re-exported so tests and the browser half share one literal. */
export { RUNTIME_ROUTE } from './core/contract.ts'

/**
 * Mount the vendor route.
 * @param ctx - Host context carrying the webserver service.
 */
function applyImpl(ctx: Context): void {
  const routes = makeRoutes(ctx)
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'diagrams: vendor route')
}

/**
 * Single-instance guard shared by the plugin family: the aggregate bundle and a
 * standalone install of this package can coexist in one profile, so the second
 * host apply must be a no-op instead of registering the route twice.
 */
export const apply = mountOnce('@linxin666/dsh-client-ui-diagrams', applyImpl)
