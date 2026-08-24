/**
 * The install plugin's host half.
 *
 * `dsh plugin add` is a shell command on a machine, and a browser has no shell
 * to run it in — so this plugin supplies both faces of the same feature: the
 * `/plugin` command here, and the form in the surface's plugins settings page
 * from its browser half. They are one plugin because they are one feature.
 *
 * The manager itself belongs to the app: it unpacks into the virtual
 * filesystem the host boots from, which is not something a plugin can own.
 * What this row owns is the command surface over it.
 */

import type {} from '@deepseek-ai/dsh-commands'
import type { Context } from '@deepseek-ai/cordis'

/** As much of the app's plugin manager as this command uses. */
interface PluginManager {
  list(): { name: string, version: string, enabled: boolean, hasClient: boolean }[]
  install(spec: string): Promise<{ name: string, version: string, hasClient: boolean, patch?: string }>
  enable(name: string): Promise<void>
  disable(name: string): Promise<void>
  remove(name: string): Promise<void>
}

/** Stable Cordis plugin name. */
export const name = 'web-plugin-install'

/** Services this command needs. */
export const inject = ['commands']

/** The manager, published by `installPluginManager` once the host has settled. */
let manager: PluginManager | undefined

/**
 * Hand the command the live manager.
 *
 * The app calls this once its manager exists, which is after the host has
 * settled — so the command is registered before it has anything to act on and
 * says so rather than being absent.
 * @param value - the manager built over the settled context.
 */
export function setPluginManager(value: PluginManager): void {
  manager = value
}

/** Render the installed roster as a markdown list. */
function renderList(): string {
  const installed = manager?.list() ?? []
  if (installed.length === 0) {
    return 'No plugins installed.\n\nInstall one with `/plugin add <package>` — for example '
      + '`/plugin add @linxin666/dsh-web-all`. Packages carrying the `dsh-plugin` topic on GitHub '
      + 'are published to npm and install the same way they would with `dsh plugin add`.'
  }
  const rows = installed.map((plugin) => {
    const state = plugin.enabled ? 'enabled' : 'disabled'
    const surface = plugin.hasClient ? ', browser surface' : ''
    return `- \`${plugin.name}\` ${plugin.version} — ${state}${surface}`
  })
  return `Installed plugins:\n\n${rows.join('\n')}\n\nReload the page after a change to recompose the plugin tree.`
}

/**
 * Register the command.
 * @param ctx - plugin context carrying `commands`.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'plugin',
    description: 'Install, list, enable, disable, or remove a DSH plugin',
    input: { hint: 'add <package> | list | remove <package> | enable <package> | disable <package>' },
    async handler({ rawInput }) {
      if (manager === undefined) {
        return { kind: 'error', text: 'The plugin manager is not ready yet.' }
      }
      const [verb = 'list', target] = rawInput.trim().split(/\s+/).filter(Boolean)
      try {
        switch (verb) {
          case 'list':
            return { kind: 'success', text: renderList() }

          case 'add':
          case 'install': {
            if (target === undefined) return { kind: 'error', text: 'Usage: `/plugin add <package>`' }
            const entry = await manager.install(target)
            const surface = entry.hasClient ? ' Its browser surface loads on the next page reload.' : ''
            const layer = entry.patch === undefined
              ? ' It declares no bundle patch, so it is installed as a plain dependency and adds no rows.'
              : ''
            return {
              kind: 'success',
              text: `Installed \`${entry.name}\` ${entry.version}.${layer}${surface}\n\nReload the page to compose it.`,
            }
          }

          case 'remove':
          case 'uninstall': {
            if (target === undefined) return { kind: 'error', text: 'Usage: `/plugin remove <package>`' }
            await manager.remove(target)
            return { kind: 'success', text: `Removed \`${target}\`. Reload the page to recompose the plugin tree.` }
          }

          case 'enable':
          case 'disable': {
            if (target === undefined) return { kind: 'error', text: `Usage: \`/plugin ${verb} <package>\`` }
            if (verb === 'enable') await manager.enable(target)
            else await manager.disable(target)
            return { kind: 'success', text: `\`${target}\` is now ${verb}d. Reload the page to recompose the plugin tree.` }
          }

          default:
            return { kind: 'error', text: `Unknown verb \`${verb}\`. Try \`add\`, \`list\`, \`remove\`, \`enable\`, or \`disable\`.` }
        }
      } catch (error) {
        return { kind: 'error', text: `\`/plugin ${verb}\` failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }), 'plugin-command: /plugin')
}

export default { apply, inject, name }
