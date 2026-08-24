/**
 * Host half of the dsh-web-settings group. Mounts the rc.6 compatibility
 * settings bridge: a loopback-default HTTP pair that serves the family
 * plugins' settings namespaces through the host settings seam, gated by the
 * user's web_settings_namespaces allowlist from settings.yaml (with the
 * built-in family fallback list). An explicit authenticated-proxy config may
 * admit exact same-origin Hosts without changing the default. The browser
 * half uses it only when the official settings scope reports the namespace
 * unavailable, so hosts whose apiproxy already exposes the namespaces never
 * touch the bridge.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDshHome } from './dsh-home.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { makeBridgeRoutes } from './bridge.ts'
import { mountOnce } from './mount-once.ts'

/** Default environment variable holding the reverse-proxy shared token. */
export const DEFAULT_PROXY_TOKEN_ENV = 'DSH_WEB_UI_SETTINGS_PROXY_TOKEN'

/** Host-side compatibility bridge config. */
export interface Config {
  /** Canonical Host authorities admitted only from the local authenticated proxy. */
  trustedProxyHosts?: string[]
  /** Environment variable whose non-empty value the proxy injects upstream. */
  proxyTokenEnv?: string
}

export const Config: z<Config> = z.object({
  trustedProxyHosts: z.array(String).default([]),
  proxyTokenEnv: z.string().min(1).default(DEFAULT_PROXY_TOKEN_ENV),
})

/** Resolve the opt-in proxy token without putting its value in plugin config. */
export function resolveProxyAccess(config?: Config, env: NodeJS.ProcessEnv = process.env): { trustedProxyHosts: string[]; proxyToken?: string } {
  const trustedProxyHosts = config?.trustedProxyHosts ?? []
  if (trustedProxyHosts.length === 0) return { trustedProxyHosts }
  const proxyTokenEnv = config?.proxyTokenEnv ?? DEFAULT_PROXY_TOKEN_ENV
  if (proxyTokenEnv.trim() === '') throw new Error('web-ui-settings: proxyTokenEnv must not be empty')
  const proxyToken = env[proxyTokenEnv]
  if (proxyToken === undefined || proxyToken === '') {
    throw new Error('web-ui-settings: trustedProxyHosts requires a non-empty ' + proxyTokenEnv + ' environment variable')
  }
  return { trustedProxyHosts, proxyToken }
}

/** Required services before the bridge routes can mount. */
export const inject = ['webServer'] as const

/**
 * Mount the settings bridge when a settings seam exists (the seam is what the
 * bridge serves, so without one there is nothing to expose).
 * @param ctx - host plugin context.
 * @param config - loopback-default bridge and authenticated-proxy config.
 */
/**
 * Resolve the settings YAML fallback path when the host settings seam does
 * not report a documentPath: $DSH_HOME/settings.yaml (defaulting to
 * ~/.dsh/settings.yaml). Test seam: env and home are injectable.
 */
export function settingsYamlFallbackPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(resolveDshHome(env, home), 'settings.yaml')
}

export const apply = mountOnce('@linxin666/dsh-client-ui-web-ui-settings', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const access = resolveProxyAccess(config)
  ctx.inject(['settings'], (sctx) => {
    const settingsYamlPath = sctx.settings.documentPath ?? settingsYamlFallbackPath()
    sctx.effect(() => {
      const disposers = makeBridgeRoutes({
        settings: sctx.settings,
        readSettingsYaml: () => {
          try {
            return readFileSync(settingsYamlPath, 'utf8')
          } catch {
            return ''
          }
        },
      }, access).map(route => sctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'web-ui-settings: settings bridge')
  })
}
