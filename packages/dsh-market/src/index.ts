/**
 * Host half of the dsh-market card: mounts the loopback install gateway. The
 * card's enable switch is this plugin's own `Config` (the Host auto-generates
 * the settings page for the profile entry from that schema), so this half
 * owns no settings registration: the browser half reads the effective switch
 * off the entry's configuration form. The catalog data itself is served by
 * dsh-market.com and ingested by the browser half — this half only owns the
 * asset writer.
 * @module @linxin666/dsh-client-ui-market
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { mountOnce } from './mount-once.ts'
import { makeMarketRoutes } from './routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-market'

/** Services the routes need; the gateway requires the host webserver. */
export const inject = ['webServer']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the market card. */
  enabled?: boolean
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
})

/** Mount the install gateway (once). */
export const apply = mountOnce('@linxin666/dsh-client-ui-market', applyImpl)

function applyImpl(ctx: Context): void {
  const routes = makeMarketRoutes()
  for (const route of routes) {
    try {
      ctx.effect(() => {
        const dispose = ctx.webServer.register(route)
        return () => { dispose() }
      }, 'dsh-web-ui-market: routes')
    } catch {
      /* keep the browser card mounted without the gateway */
    }
  }
}

export { installAsset, planDownload, isSafeRel, MARKET_ORIGIN, PROVENANCE_FILENAME } from './core/installer.ts'
export type { DownloadPlanEntry, InstallProvenance, InstallResult, MarketKind } from './core/installer.ts'
export { makeMarketRoutes, MARKET_API_PREFIX } from './routes.ts'
