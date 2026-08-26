/**
 * AionUI right-panel system — browser half. The panel itself is retired: the
 * provider choice was removed and the right panel is always the external
 * dsh-better-sidebar side card, so the explorer/preview columns never mount.
 * What remains active here: the composer drop target and transcript mermaid
 * sentinels (both inert without the panel columns), and the side-card
 * settings card in the Web Plugins group, which embeds the side card's
 * own settings section inline.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 *
 * AionUi right-panel design (Apache-2.0, iOfficeAI/AionUi) — re-implemented
 * from measured behavior and architecture, not copied code.
 * @module dsh-aionui-panel/client
 */

import type { ClientContext, SessionId, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the official settings-scope service onto the client
// Context, and the 'settings.section' SlotMap merge the card renders.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AionUiSettingsCard, AionUiSettingsCardController, type AionUiPanelSettings } from './AionUiSettingsCard.tsx'
import type { SideCardRegistry } from './SideCardPrefs.tsx'
import { NS, dictionaries, type AionUiPanelKey } from './locales.ts'
import { DragFileInlay, type DragFileInjected } from './drag/DragFileInlay.tsx'
import { insertPathIntoDraft } from './drag/file-drag.ts'
import { MermaidChatEnhancer } from './chat/mermaid-chat.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Panel surface copy. */
    'aionui-panel': AionUiPanelKey
  }

  interface SlotMap {
    /**
     * One family plugin card inside the Web Plugins group. Spelled here
     * with the same shape so this package can register without depending on
     * the sibling web-ui-settings package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
    /**
     * The external dsh-better-sidebar plugin's registry service, published
     * while that plugin is loaded; the settings card enumerates its tab and
     * viewer descriptors for the enable switches.
     */
    betterSidebar?: SideCardRegistry
  }
}

/** Required services: sessions for the project root, locale for the copy, and the settings scope for the provider choice. */
export const inject = ['sessions', 'locale', 'settingsScope']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, dictionaries)
    } catch {
      return () => {}
    }
  }, 'dsh-aionui-panel: dictionaries')

  // The composer drop target for explorer file drags: mounted in the
  // official `conversation.input.dock` band (declared by the shipped
  // ui-conversation rc.6 shell), session-routed through the conversation
  // input facade. A missing session scope or conversation service degrades
  // to no-op — the panels themselves never depend on the dock entry.
  ctx.inject(['slots', 'conversation', 'sessions'], (scope: ClientContext) => {
    const sessions = scope.sessions
    const conversation = scope.conversation
    scope.slots.inject('conversation.input.dock', () => {
      try {
        return scope.slots.register({
          name: 'conversation.input.dock',
          id: 'aionui-drag-file',
          order: 90,
          locale: NS,
          inject: (sessionId: SessionId | undefined): DragFileInjected => ({
            insertPath: (path: string): boolean => {
              if (sessionId === undefined) return false
              const actx = sessions.scope(sessionId)
              if (actx === undefined) return false
              const input = conversation.input
              if (input === undefined) return false
              const shell = input.for(actx)
              const draft = shell.state.getSnapshot().draft
              shell.setDraft(insertPathIntoDraft(draft, path))
              return true
            },
          }),
        }, DragFileInlay)
      } catch {
        return () => {}
      }
    })
  })

  // Transcript mermaid enhancement rides the same dock as a zero-render
  // sentinel: the shell has no message-body slot, so the sentinel observes
  // the document for the chat renderer's mermaid blocks (shell shape:
  // div.md-code-block with the language in its banner infostring).
  ctx.inject(['slots'], (scope: ClientContext) => {
    scope.slots.inject('conversation.input.dock', () => {
      try {
        return scope.slots.register({
          name: 'conversation.input.dock',
          id: 'aionui-mermaid-chat',
          order: 91,
        }, MermaidChatEnhancer)
      } catch {
        return () => {}
      }
    })
  })

  // The side-card settings card in the Web Plugins group: it declares
  // the side card's origin and edits its everyday preferences inline through
  // the external plugin's own settings transport. The 'aionui-panel'
  // namespace binding is only the card's availability anchor — no editable
  // fields remain. The registry face (tab/viewer enumeration) comes from the
  // external plugin's cordis service when it is loaded.
  ctx.inject(['slots', 'settingsScope'], (settingsCtx: ClientContext) => {
    const binder = settingsCtx.get('webUiSettings') ?? settingsCtx.settingsScope
    const panelScope = binder.bind<AionUiPanelSettings>({ namespace: NS })
    const settingsCard = new AionUiSettingsCardController(panelScope)
    settingsCtx.slots.inject('web-ui.plugin.item', () => {
      try {
        const unregister = settingsCtx.slots.register({
          name: 'web-ui.plugin.item',
          id: 'aionui-panel',
          order: 110,
          locale: NS,
          inject: () => ({
            ...settingsCard.inject(),
            sidebar: settingsCtx.get('betterSidebar'),
          }),
        }, AionUiSettingsCard)
        return () => {
          settingsCard.dispose()
          unregister()
        }
      } catch {
        return () => {}
      }
    })
  })
}
