/**
 * Host half of the dsh-plugin-manager plugin — runs in the DSH host process.
 *
 * Dual-channel design: on runtimes with the official installer services
 * (DSHCode and the 1.0.4 checkout web), the browser half uses the official
 * `/plugin-installer` and `/plugin-control` RPC channels and this half does
 * nothing. On the npm-published web runtime (rc.6/rc.7), those channels do
 * not exist, so this half mounts a loopback-fenced HTTP gateway: the
 * inventory reads the profile files, installs and removals spawn the
 * official CLI (the single writer), and enablement writes bare `disabled`
 * override rows into the profile patch.
 * @module @linxin666/dsh-client-ui-plugin-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { mountOnce } from './mount-once.ts'
import { findDshBinary, CliGateway } from './host/gateway.ts'
import { profileExists, resolveProfile } from './host/profile.ts'
import { makeGatewayRoutes } from './host/routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-plugin-manager'

/** Services the gateway needs — the web server seam. */
export const inject = ['webServer']

/** Apply the host half (once per process). */
export const apply = mountOnce('@linxin666/dsh-client-ui-plugin-manager', applyImpl)

function applyImpl(ctx: Context): void {
  // Gateway mode needs the boot profile. CLI-launched hosts carry
  // --profile / DSH_PROFILE / the web subcommand in argv; the packaged
  // Desktop shell (deepseek-harness-desktop) boots the harness in-process
  // with none of those, so its desktopProfiles service reports the active
  // profile and this half must serve the browser tab there as well.
  let facts
  try {
    const desktop = ctx.get('desktopProfiles') as { current?: { name?: string } } | undefined
    facts = resolveProfile(undefined, undefined, desktop?.current?.name)
  } catch (error) {
    console.error('[plugin-manager]', error instanceof Error ? error.message : String(error))
    return
  }
  if (!profileExists(facts.profileDir)) return

  const gateway = new CliGateway(facts)
  const cliAvailable = (): boolean => findDshBinary() !== null

  ctx.effect(() => {
    const disposers = makeGatewayRoutes({ facts, gateway, cliAvailable })
      .map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'plugin-manager: gateway routes')
}
