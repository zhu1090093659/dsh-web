/**
 * Browser half of the dsh-agents plugin: registers the zh/en dictionaries, the
 * two shell seats (sidebar row + center page), and the settings card that
 * exposes the agent announcement switch.
 *
 * The Host half owns the routes and the protocol; this entry needs the slot
 * and locale services and bridges the two optional faces its session entry
 * points read - the workspace opener and the shared session catalog - per
 * instance, so a provider that mounts after this row still enables them.
 *
 * @module @linxin666/dsh-agents/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface types (ConfigForm / ConfigForms) this
// card binds against without shipping any of that package.
import type { ConfigForm, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import { AgentsSettingsCard, AgentsSettingsCardController } from './AgentsSettingsCard.tsx'
import type { AgentsSettings } from './AgentsSettingsCard.tsx'
import { createAgentsTransport } from './host-api.ts'
import { AGENTS_LOCALE_NAMESPACE, registerAgentLocales } from './locales.ts'
import type { AgentsKey, LocaleRegistrar } from './locales.ts'
import { registerAgentsPanel } from './panel.tsx'
import { installPluginCard } from './plugin-card-seat.ts'
import type { PluginCardContext, SettingsPluginItemOwnerProps } from './plugin-card-seat.ts'
import { createServedEntryForm } from './settings-entry-form.ts'
import { bridgeSessionFaces, createSessionFaces } from './session-faces.ts'

/**
 * Services cordis waits for before it runs apply. The locale seat is required,
 * not optional: dictionaries registered after the first paint leave the page
 * rendering raw keys, so a load-order race must pend the apply instead of
 * being absorbed. The registration helper keeps its own guard for a deployment
 * that genuinely serves no locale seat.
 */
export const inject = ['slots', 'locale']

/**
 * Settings namespace this card edits: the family identity of this plugin's own
 * settings form, and the row id a standalone bundle install carries (this
 * package's patch row id is exactly its namespace).
 */
export const SETTINGS_NAMESPACE = 'dsh-agents'

/**
 * Profile entry id the family aggregate's generated row carries
 * (`familyIds` in packages/dsh-web-all/aggregate.yml).
 */
const AGGREGATE_ENTRY_ID = 'web-ui-agents'

/** Profile entry ids this package's rows carry, most likely first. */
const AGENTS_ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, SETTINGS_NAMESPACE]

/** Family settings binder published by dsh-web-settings while that group is loaded. */
interface FamilySettingsBinder {
  /**
   * Bind one namespace onto the profile entry id this page serves it under.
   * @param spec - the namespace to bind.
   */
  bind<T>(spec: { namespace: string }): ConfigForm<T>
}

/**
 * Read one optional service by name, outside the inject contract.
 *
 * The entry waits for the two seats its page needs and nothing else, so a
 * deployment that serves no settings surface still renders the squad page; the
 * services that surface publishes are probed here instead of being injected.
 * @param ctx - the browser plugin context.
 * @param name - the service name to resolve.
 * @returns the service, or undefined when this deployment serves none.
 */
function optionalService(ctx: ClientContext, name: string): unknown {
  try {
    const get = (ctx as unknown as { get?: (name: string) => unknown }).get
    return get === undefined ? undefined : get.call(ctx, name)
  } catch {
    return undefined
  }
}

/**
 * Bind the settings form the card stages over.
 *
 * The family binder comes first: it resolves this package's namespace onto the
 * profile entry id the Host serves the form under. A page without that group
 * binds through the shared forms service on the entry id its describe mirror
 * justifies — see {@link createServedEntryForm} for why a one-shot guess cannot
 * be right for both an aggregate and a standalone install.
 * @param ctx - the browser plugin context.
 * @returns the form the settings card reads and writes.
 */
export function bindSettingsForm(ctx: ClientContext): ConfigForm<AgentsSettings> {
  const binder = optionalService(ctx, 'webUiSettings') as FamilySettingsBinder | undefined
  if (binder !== undefined && typeof binder.bind === 'function') {
    return binder.bind<AgentsSettings>({ namespace: SETTINGS_NAMESPACE })
  }
  const forms = optionalService(ctx, 'configForms') as ConfigForms | undefined
  // No settings surface at all: the caller leaves the card out and keeps the page.
  if (forms === undefined) throw new Error('dsh-agents: this deployment serves no settings surface')
  return createServedEntryForm<AgentsSettings>({ forms, entryIds: AGENTS_ENTRY_IDS })
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The child slot the Web UI plugin group declares; this card registers into
     * the group's list seat rather than the official bundle-configuration seat.
     * Declared here so this package needs no dependency on the sibling UI
     * package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }

  interface LocaleNamespaceMap {
    /** The squad page and settings card copy. */
    'dsh-agents': AgentsKey
  }
}

/**
 * Mount the agents plugin.
 *
 * The session opener and the live-team surface are OPTIONAL faces of other
 * plugins, so they are bridged per instance (`session-faces.ts`) instead of
 * being probed while this row applies: on a deployment where the workspace or
 * session plugin loads later, a probe would read `undefined` once and leave the
 * page without a session entry point for the life of the process.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => registerAgentLocales(ctx as unknown as { locale?: LocaleRegistrar }), 'dsh-agents: dictionaries')

  const transport = createAgentsTransport()
  const faces = createSessionFaces()
  bridgeSessionFaces(ctx, faces)
  ctx.effect(() => registerAgentsPanel(ctx, transport, faces), 'dsh-agents: sidebar row and page')

  // Plugin configuration card: one staged form over the `dsh-agents` settings
  // namespace, contributed to the Web UI plugin group beside the other family
  // cards. A deployment without a settings surface keeps the page and loses
  // only the card.
  try {
    const settingsCard = new AgentsSettingsCardController(bindSettingsForm(ctx))
    installPluginCard(ctx as unknown as PluginCardContext, {
      bundle: '@linxin666/dsh-agents',
      id: SETTINGS_NAMESPACE,
      order: 130,
      locale: AGENTS_LOCALE_NAMESPACE,
      inject: () => settingsCard.inject(),
      component: AgentsSettingsCard,
    })
    ctx.effect(() => () => { settingsCard.dispose() }, 'dsh-agents: settings card')
  } catch {
    // A missing settings surface or a seat that refuses the contribution: the
    // page still renders, and no card appears.
  }
}
