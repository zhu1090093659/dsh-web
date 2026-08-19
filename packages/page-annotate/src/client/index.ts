/**
 * Browser-half entry for the page-annotate plugin — runs inside the dsh web
 * GUI. Registers the locale dictionaries and the 'page-annotate' right-side
 * tab through the dsh-better-sidebar registry (ctx.betterSidebar), claiming
 * http(s) external links so a link click opens the panel pre-loaded with
 * that URL. Failure policy: registration problems are logged, never thrown —
 * an external plugin must not take the GUI down.
 *
 * Export discipline: the /client surface carries the cordis apply contract
 * plus types only; all value exports stay internal.
 * @module @linxin666/dsh-page-annotate/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { resolveBetterSidebar } from './better-sidebar.ts'
import { createTabComponent } from './tab-component.tsx'
import { dictionaries, NS, setLanguage, t, type PageAnnotateKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The page-annotate panel copy. */
    'page-annotate': PageAnnotateKey
  }
}

/** Required services: locale for the dictionary registration. */
export const inject = ['locale']

/** Inline tab icon (a pen-over-rectangle glyph, 16px nav-icon look). */
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="9" height="9" rx="1.5"/><path d="M12.5 4.5l1.5 1.5-5.5 5.5H7v-1.5z"/><path d="M11 3.5l1.5 1.5"/></svg>'

/**
 * Apply the browser half.
 * @param ctx - client root context (locale service).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh: dictionaries['zh'], en: dictionaries['en'] }), 'page-annotate: dictionaries')

  // Mirror the shell language into the module-level dictionary switch.
  ctx.effect(() => {
    const sync = (): void => {
      const lang = document.documentElement.lang
      setLanguage(lang === 'zh' || lang.startsWith('zh-') ? 'zh' : 'en')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, 'page-annotate: language mirror')

  // Register the right-side tab through dsh-better-sidebar.
  ctx.effect(() => {
    const service = resolveBetterSidebar(ctx)
    if (service === undefined) {
      console.warn('[page-annotate] dsh-better-sidebar not loaded; right-panel tab unavailable')
      return () => undefined
    }
    const dispose = service.registerTab({
      id: 'page-annotate',
      title: () => t('tab.title'),
      icon: ICON,
      order: 95,
      single: true,
      urlTarget: (url: URL) => url.protocol === 'http:' || url.protocol === 'https:',
      component: createTabComponent,
    })
    return () => dispose()
  }, 'page-annotate: tab registration')
}
