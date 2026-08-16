/**
 * Host half of Community Plugins: persists the section switch, exposes the
 * local plugin lifecycle routes, and registers the live Store conversation
 * tools plus their bundled skill. Catalog metadata always comes from the
 * public Store API; executable mutations are revalidated in this process.
 * @module @linxin666/dsh-client-ui-community-plugins
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type {} from '@deepseek-ai/dsh-skill'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { createStoreRoutes, installCatalogProject, listInstalledPlugins, removeInstalledPlugin } from './store-manager.ts'
import { loadBundledStoreSkill } from './store-skill.ts'
import { createStoreApprovalGate, createStoreTools } from './store-tools.ts'
import type { InstallMode } from './core/store-catalog.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-community-plugins'

/** Host services required by the lifecycle API and conversation integration. */
export const inject = ['webServer', 'tools', 'skills']

/**
 * Settings namespace of the card's enable switch — the section the web
 * settings surface edits. Spelled here rather than imported: the browser half
 * spells the same value and must not depend on a Host package.
 */
export const COMMUNITY_PLUGINS_SETTINGS_NAMESPACE = settingsNamespace('community-plugins')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the community plugin manager card. */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Register the community-plugins settings namespace. The application of the
 * value is browser-side (the card hides its list while off), so the hooks
 * only keep the source reachable; installSettingsSection is a no-op when no
 * settings service is mounted (pure community-card installs skip it).
 * @param ctx - cordis context.
 */
export function apply(ctx: Context): void {
  installSettingsSection(ctx, COMMUNITY_PLUGINS_SETTINGS_NAMESPACE, Config, {}, {
    setSource: () => { /* application is browser-side; value is read from the scope */ },
    onChange: () => { /* browser half re-reads on scope publish */ },
  })

  const runnerOptions = (signal: AbortSignal) => ({
    runner: runNativeCommand,
    execPath: process.execPath,
    cliPath: process.argv[1],
    signal,
  })
  const listInstalled = (signal: AbortSignal) => listInstalledPlugins(runnerOptions(signal))
  const install = (repositoryId: string, mode: InstallMode | undefined, signal: AbortSignal) => installCatalogProject(repositoryId, mode, {
    ...runnerOptions(signal),
    fetcher: globalThis.fetch,
    listInstalled,
  })
  const remove = async (packageName: string, signal: AbortSignal) => removeInstalledPlugin(packageName, {
    ...runnerOptions(signal),
    installed: await listInstalled(signal),
  })

  for (const route of createStoreRoutes({
    fetcher: globalThis.fetch,
    runner: runNativeCommand,
    execPath: process.execPath,
    cliPath: process.argv[1],
    logger: ctx.logger,
  })) ctx.webServer.register(route)

  for (const tool of createStoreTools({ fetcher: globalThis.fetch, listInstalled, install, remove })) {
    ctx.tools.register(tool)
  }
  ctx.on('tools/pre-execute', createStoreApprovalGate())
  ctx.skills.register(loadBundledStoreSkill())
}
