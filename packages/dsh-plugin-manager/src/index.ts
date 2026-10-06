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
import { findDshBinary, CliGateway, type NativePluginManager } from './host/gateway.ts'
import { launchedInstallAnchor, profileExists, resolveProfile, type LaunchedProfile } from './host/profile.ts'
import { makeGatewayRoutes } from './host/routes.ts'

/**
 * Stable cordis plugin name (matches this package's own cordis.patch.yml
 * insert id). It must not repeat an id another bundle already claims: the
 * loader keeps one entry per id, so a shared id would also give two host
 * halves one cordis plugin name.
 */
export const name = 'ui-plugin-manager-update-check'

/** Services the gateway needs — the web server seam. */
export const inject = ['webServer']

/** Apply the host half (once per process). */
export const apply = mountOnce('@linxin666/dsh-client-ui-plugin-manager', applyImpl)

/**
 * The launched profile the official runtime publishes on the host context
 * (`profileContext`, `{ name, dir, patchPath, ... }`). The packaged Desktop
 * launcher boots "desktop" through `runProfile()` with neither a `--profile`
 * flag nor a DSH_PROFILE variable, so this service is the only launcher fact
 * that names the running profile there; a CLI-booted host keeps resolving from
 * argv and the environment exactly as before. It is an OPTIONAL read, not an
 * injected dependency: hosts without the service simply fall through.
 * @param ctx - host plugin context.
 * @returns the published facts, or undefined when the host publishes none.
 */
function launchedProfile(ctx: Context): LaunchedProfile | undefined {
  const facts = ctx.get('profileContext') as LaunchedProfile | undefined
  return facts === undefined || facts === null ? undefined : facts
}

/**
 * The official in-process plugin manager, when the running host mounts one.
 * `@deepseek-ai/dsh-plugin-manager` registers itself as the `pluginManager`
 * service (a TypertRemoteService, which is an ordinary Cordis Service under
 * that key); this is the same writer the official Plugins page drives, read here
 * as a contract observation rather than an import — the repository builds
 * against the official SDK's public packages, and this package must keep
 * running when a host mounts no manager at all. Only an application-owned
 * profile uses it (see CliGateway), because there the CLI refuses the profile.
 * @param ctx - host plugin context.
 * @returns the manager, or undefined when the host publishes none.
 */
function officialManager(ctx: Context): NativePluginManager | undefined {
  // Called as a method on the context: the service lookup reads the context's
  // own registry, so the receiver must stay intact.
  const manager = (ctx as unknown as { get(name: string): unknown }).get('pluginManager')
  return manager === undefined || manager === null ? undefined : manager as NativePluginManager
}

function applyImpl(ctx: Context): void {
  // Gateway mode needs the boot profile; the launched profile the Host
  // publishes is authoritative when the launcher passed no flag and no
  // environment override (the packaged Desktop client). Without either fact
  // the official installer channels serve the browser half instead.
  let facts
  const launched = launchedProfile(ctx)
  try {
    facts = resolveProfile(process.argv, process.env, launched)
  } catch (error) {
    console.error('[plugin-manager]', error instanceof Error ? error.message : String(error))
    return
  }
  if (!profileExists(facts.profileDir)) return

  const gateway = new CliGateway(facts, process.env, { nativeManager: () => officialManager(ctx) })
  const cliAvailable = (): boolean => findDshBinary() !== null
  // The running installation's own manifest is the version source the
  // compatibility gate prefers: it needs no CLI, which is the only way a
  // packaged Desktop host can answer at all (issue #1819). The anchor is read
  // from the same published profile facts the profile resolution already used.
  const installAnchor = launchedInstallAnchor(launched)

  ctx.effect(() => {
    const disposers = makeGatewayRoutes({ facts, gateway, cliAvailable, installAnchor })
      .map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'plugin-manager: gateway routes')
}
