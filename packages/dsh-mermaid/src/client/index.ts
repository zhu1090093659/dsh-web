/**
 * Browser half of the mermaid plugin: renders mermaid diagram fences in
 * assistant messages as SVG figures, and seats the plugin's settings card in
 * the Web UI plugins group.
 *
 * The shell's markdown pipeline has no fence-render slot, so the enhancer
 * observes the transcript DOM (see enhancer.ts for the interop rules) and
 * swaps `mermaid` fences for figures rendered by the bundled mermaid runtime.
 * The lifecycle follows the `mermaid` settings namespace: toggling the card
 * off reverts every figure to the plain code block, and a theme change
 * re-renders them.
 *
 * Failure policy: every wiring failure is logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws.
 * @module @linxin666/dsh-client-ui-mermaid/client
 */

import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { dictionaries, setLanguage, t, type MermaidClientKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { installMermaidEnhancer, type MermaidEnhancerHandle } from './enhancer.ts'
import { renderMermaidDiagram } from './mermaid-runtime.ts'
import { normalizeTheme, type MermaidThemeSetting } from '../core/themes.ts'
import { MermaidSettingsCard, MermaidSettingsCardController, type MermaidSettings } from './MermaidSettingsCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The mermaid figure chrome and settings card copy. */
    'mermaid': MermaidClientKey
  }

  interface SlotMap {
    /**
     * One family plugin card inside the Web UI plugins group. Spelled here
     * with the same shape so this package can register without depending on
     * the sibling web-ui-settings package.
     */
    'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the group card supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
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

/** Locale namespace of the browser half (matches the host settings section). */
export const NS = 'mermaid' as const

/** Required services: locale for copy, settings scope for the card and the
 * enhancer lifecycle (scope binding additionally wants connection + remote),
 * slots for the card seat. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Apply the browser half.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-mermaid: dictionaries')
  ctx.effect(() => {
    // Mirror the shell language into the module-level dictionary switch.
    const sync = (): void => {
      const lang = document.documentElement.lang
      setLanguage(lang === 'zh' || lang.startsWith('zh-') ? 'zh' : 'en')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, 'dsh-mermaid: language mirror')

  const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
  const settingsScope = binder.bind<MermaidSettings>({ namespace: NS })

  // The settings card: the enable toggle and the diagram theme, staged over
  // the mermaid namespace.
  const settingsCard = new MermaidSettingsCardController(settingsScope)
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({
    name: 'web-ui.plugin.item',
    id: 'mermaid',
    order: 150,
    locale: NS,
    inject: () => settingsCard.inject(),
  }, MermaidSettingsCard))

  // The enhancer follows the section: enabled mounts it (rendering every
  // mermaid fence found), disabled reverts every figure to the plain code
  // block, and a theme change re-renders with the new palette.
  const readSection = (): { enabled: boolean; theme: MermaidThemeSetting } => {
    const snapshot = settingsScope.getSnapshot()
    // The namespace ships with this plugin's own host half, so `unavailable`
    // means a degraded deployment — keep rendering with defaults rather than
    // hiding the feature (the enhancer itself needs no host service).
    const value = snapshot.status === 'ready' ? snapshot.value : undefined
    return { enabled: value?.enabled ?? true, theme: normalizeTheme(value?.theme) }
  }

  let handle: MermaidEnhancerHandle | undefined
  let lastTheme: MermaidThemeSetting | undefined
  const syncEnhancer = (): void => {
    const { enabled, theme } = readSection()
    if (!enabled) {
      handle?.dispose()
      handle = undefined
      lastTheme = undefined
      return
    }
    if (handle === undefined) {
      lastTheme = theme
      handle = installMermaidEnhancer(document, {
        render: (id, source) => renderMermaidDiagram(id, source, lastTheme ?? 'auto'),
        labels: {
          source: () => t('figure.source'),
          hide: () => t('figure.hide'),
          error: (message) => t('figure.error', { error: message }),
        },
      })
    } else if (theme !== lastTheme) {
      lastTheme = theme
      handle.rerenderAll()
    }
  }
  settingsScope.subscribe(syncEnhancer)
  syncEnhancer()
  ctx.effect(() => () => {
    handle?.dispose()
    handle = undefined
  }, 'dsh-mermaid: enhancer teardown')
}
