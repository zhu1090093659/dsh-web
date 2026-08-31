/**
 * Host half of the dsh-market card: registers the market settings namespace
 * (the card's enable switch) and mounts the loopback install gateway. The
 * catalog data itself is served by dsh-market.com and ingested by the
 * browser half — this half only owns the durable setting and the asset
 * writer.
 * @module @linxin666/dsh-client-ui-market
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'
import { makeMarketRoutes } from './routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-market'

/** Services the routes need; the gateway requires the host webserver. */
export const inject = ['webServer']

/** Settings namespace of the card's enable switch. */
export const MARKET_SETTINGS_NAMESPACE = 'dsh-web-ui-market' as SettingsNamespace

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the market card. */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/** Register the namespace and mount the install gateway (once). */
export const apply = mountOnce('@linxin666/dsh-client-ui-market', applyImpl)

function applyImpl(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, MARKET_SETTINGS_NAMESPACE, Config, {}, {
      setSource: () => { /* application is browser-side; value is read from the scope */ },
      onChange: () => { /* browser half re-reads on scope publish */ },
    })
  })
  const routes = makeMarketRoutes()
  for (const route of routes) {
    try {
      ctx.effect(() => {
        const dispose = ctx.webServer.register(route)
        return () => { dispose() }
      }, 'dsh-web-ui-market: routes')
    } catch {
      /* settings-only install: keep the card usable without the gateway */
    }
  }
}

export { installAsset, planDownload, isSafeRel, MARKET_ORIGIN, PROVENANCE_FILENAME } from './core/installer.ts'
export type { DownloadPlanEntry, InstallProvenance, InstallResult, MarketKind } from './core/installer.ts'
export { makeMarketRoutes, MARKET_API_PREFIX } from './routes.ts'
