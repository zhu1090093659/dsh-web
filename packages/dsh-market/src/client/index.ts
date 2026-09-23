/**
 * Workshop store, browser half. Registers the dsh-market dictionaries and
 * the single first-level Workshop settings section (settings.section id
 * `dsh-web-ui-market`) that renders the store card: browsing dsh-market.com
 * manifests (skins / pets / plugins) with one-click install into the DSH
 * home directories, and bridging the optional pluginManager service for
 * one-click plugin installs.
 * @module @linxin666/dsh-client-ui-market/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  MarketCardController,
  MarketSection,
  type MarketSettings,
  type WorkshopPanelKeyProps,
  type WorkshopPanelOwnerProps,
} from './MarketCard.tsx'
import { createExternalLinkOpener } from './external-link.ts'
import { en, zh, type MarketKey } from './locales.ts'
import { bridgePluginManager } from './plugin-manager-bridge.ts'
import { reportDailyHeartbeat } from './telemetry.ts'

export type {
  MarketCardProps,
  MarketSectionProps,
  WorkshopPanelKeyProps,
  WorkshopPanelOwnerProps,
  WorkshopPresetRecord,
} from './MarketCard.tsx'
export type { InstalledPluginItem, InstallProgressItem, PluginManagerService } from './plugin-manager-bridge.ts'

const MARKET_NS = 'dsh-web-ui-market'
const SECTION_ID = 'dsh-workshop'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Market card copy. */
    'dsh-web-ui-market': MarketKey
  }

  interface SlotMap {
    /**
     * Asset-kind panels contributed by their owning plugin; the store card
     * declares the slot and renders one cell per contributed kind. Shape
     * mirrors the contributor's declaration (both sides declare it
     * identically, the same way the family plugin cards share
     * `web-ui.plugin.item`).
     */
    'dsh-workshop.panel': {
      kind: 'keyed'
      scope: 'root'
      owner: WorkshopPanelOwnerProps
      keyProps: { preset: WorkshopPanelKeyProps }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional family settings binder provided by dsh-web-settings. */
    webUiSettings?: { bind<T>(spec: MarketFormSpec<T>): ConfigForm<T> }
  }
}

/**
 * Domain-owned description of one family settings namespace a card binds. The
 * 0.1.7 client keeps this shape private (`ConfigFormSpec` is not exported), so
 * the optional binder seat is declared structurally instead.
 */
interface MarketFormSpec<T> {
  /** Settings namespace the card edits. */
  namespace: string
  /** Narrow one wire section; undefined keeps the last accepted value. */
  decode?: (section: unknown) => T | undefined
}

export const inject = ['slots', 'locale', 'connection', 'configForms', 'remote']

/** Register the market section and the plugin-manager bridge. */
export function apply(ctx: ClientContext): void {
  // Anonymous install heartbeat (docs/telemetry.md): one beat per browser per
  // UTC day, package name only, silent failure.
  reportDailyHeartbeat([{ name: '@linxin666/dsh-client-ui-market' }])

  ctx.effect(() => {
    try {
      return ctx.locale.register(MARKET_NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-web-ui-market: dictionaries')

  bridgePluginManager(ctx)

  // The family binder resolves the family namespace to the profile entry id
  // the Host serves the store card's configuration under; without it the
  // namespace is itself the entry id the shared forms service is keyed by.
  const binder = ctx.get('webUiSettings')
  const form = binder !== undefined
    ? binder.bind<MarketSettings>({ namespace: MARKET_NS })
    : ctx.configForms.get<MarketSettings>(MARKET_NS)
  const controller = new MarketCardController(form)

  // The Workshop: one first-level settings section rendering the store
  // card. Clients install skins / pets / plugins here; management of
  // installed items lives in their own first-level sections (Skin Center,
  // Pet) and in the official Plugins settings section (plugin manager).
  // The section entry owns the controller: unregistering it (fiber
  // disposal, hot reload) releases the scope subscription through dispose.
  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: 150,
        label: () => ctx.locale.bind(MARKET_NS)('settings.title'),
        locale: MARKET_NS,
        children: { 'dsh-workshop.panel': { kind: 'keyed', scope: 'root' } },
        inject: () => controller.inject(createExternalLinkOpener(ctx)),
      }, MarketSection)
      return () => {
        unregister()
        controller.dispose()
      }
    } catch {
      return () => {}
    }
  })
}
