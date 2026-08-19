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
import { TAB_ICON } from './tab-icon.tsx'
import { dictionaries, NS, setLanguage, t, type PageAnnotateKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The page-annotate panel copy. */
    'page-annotate': PageAnnotateKey
  }
}

/** Required services: locale for the dictionary registration. */
export const inject = ['locale']

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

  // Register the right-side tab through dsh-better-sidebar. The service is
  // awaited via ctx.inject instead of a direct get: loader entries boot
  // concurrently, so the provider may not have started when this apply
  // runs, and a synchronous get would silently lose the tab. The injected
  // fiber stays pending until the service appears, then registers; without
  // the provider the rest of the surface keeps working and only the tab
  // is absent.
  ctx.inject(['betterSidebar'], (betterCtx) => {
    const service = resolveBetterSidebar(betterCtx)
    if (service === undefined) {
      console.warn('[page-annotate] dsh-better-sidebar not loaded; right-panel tab unavailable')
      return
    }
    const dispose = service.registerTab({
      id: 'page-annotate',
      title: () => t('tab.title'),
      icon: TAB_ICON,
      order: 95,
      single: true,
      urlTarget: (url: URL) => url.protocol === 'http:' || url.protocol === 'https:',
      component: createTabComponent,
    })
    return () => dispose()
  })
}
