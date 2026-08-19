/**
 * Browser-half entry for the dsh-ssh plugin — runs inside the dsh web GUI.
 *
 * Registers the dsh-ssh locale dictionaries and mounts the two DOM surfaces:
 * the sidebar entry row (toggles the panel) and the SSH operations panel in
 * the center column. Failure policy: DOM mounting problems are logged, never
 * thrown — the web shell fails the whole boot when a plugin apply throws, and
 * an external plugin must not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SshApi } from './api.ts'
import { en, zh, type SshKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { PanelController } from './panel/controller.ts'
import type { TerminalFontSource } from './panel/helpers.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-ssh'

/** Settings namespace the terminal-font preference lives in (issue #577). */
const SETTINGS_NS = 'dsh-ssh'

/** The dsh-ssh settings surface the browser half reads. */
interface SshClientSettings {
  /** User-configured xterm fontFamily; empty/undefined means the CSS chain. */
  terminalFontFamily?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional rc.6 compatibility binder provided by dsh-web-ui-settings;
     * absent when that group plugin is not installed, so callers fall back to
     * the official settings scope.
     */
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-ssh surface copy. */
    'dsh-ssh': SshKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale', 'settingsScope']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { PanelControllerSnapshot } from './panel/controller.ts'
export type { SshPanelProps } from './panel/SshPanel.tsx'
export type { HostsTabProps } from './panel/HostsTab.tsx'
export type { HostFormDialogProps } from './panel/HostFormDialog.tsx'
export type { TerminalTabProps } from './panel/TerminalTab.tsx'
export type { TransferTabProps } from './panel/TransferTab.tsx'
export type { TunnelsTabProps } from './panel/TunnelsTab.tsx'
export type { ClusterTabProps } from './panel/ClusterTab.tsx'
export type { SshKey } from './locales.ts'

/**
 * Mount the SSH panel.
 * @param ctx - client root context (locale service).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ssh: dictionaries')

  const controller = new PanelController()
  const api = new SshApi()
  // Live terminal-font preference (issue #577): the settings namespace is
  // edited by the host-registered GUI section; the panel re-applies changes
  // to open terminals without a reconnect.
  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const scope = binder.bind<SshClientSettings>({ namespace: SETTINGS_NS })
  const terminalFont: TerminalFontSource = {
    get: () => {
      const snapshot = scope.getSnapshot()
      return snapshot.status === 'ready' ? snapshot.value?.terminalFontFamily : undefined
    },
    subscribe: (listener) => scope.subscribe(listener),
  }
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountPanel(controller, api, terminalFont))
  } catch (error) {
    // DOM failures degrade the panel, never the GUI.
    console.warn('[dsh-ssh] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-ssh: ui mounts')
}
