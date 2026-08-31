/**
 * Browser-half entry for the dsh-i18n language pack — runs inside the dsh web
 * GUI. Registers the Русский language into the shared locale catalog and then
 * registers one ru dictionary per family plugin namespace (single-locale
 * untyped overload — language-pack contributions; no LocaleNamespaceMap merge
 * is declared, so nothing collides with the packages' own zh/en typed
 * registrations).
 *
 * Ordering and failure semantics (verified against
 * @deepseek-ai/dsh-client-locale 0.1.2-alpha.2):
 *   - `addLanguage` throws when the id is occupied (e.g. the user installed
 *     another ru provider) or the fallback chain is broken. A throw only means
 *     the DEFINITION was not added; dictionary registration is independent —
 *     lookup resolves the fallback chain at call time. So a failed
 *     addLanguage does not abort the dictionary loop: if another pack already
 *     defined ru, our dictionaries still feed it; if none ever defines ru,
 *     the extra dictionaries are inert.
 *   - `register(ns, 'ru', dict)` throws on a duplicate (ns, locale) — another
 *     owner already contributes that ns — and the existing owner's dictionary
 *     must keep working, so a failed ns registration skips just that ns.
 *   - Every disposer is idempotent; the combined teardown releases only what
 *     actually registered.
 * @module @linxin666/dsh-i18n/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale service's Context merge (ctx.locale) and the
// LanguageRegistration / register(ns, locale, dict) shapes. Value imports of
// @deepseek-ai/* are banned in browser bundles (packages/AGENTS.md).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ruDictionaries } from './ru/index.ts'

/** The language this pack adds: id, self-described label, English fallback. */
export const RU_LANGUAGE = { id: 'ru', label: 'Русский', fallback: 'en' } as const

/** Services required by the browser half. */
export const inject = ['locale']

/**
 * Register the ru language and every covered namespace's ru dictionary.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(ctx.locale.addLanguage(RU_LANGUAGE))
    } catch {
      // Id occupied or chain rejected: keep going — dictionaries do not
      // depend on the definition existing (see module doc).
    }
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      try {
        disposers.push(ctx.locale.register(ns, RU_LANGUAGE.id, dict))
      } catch {
        // Duplicate (ns, locale): the current owner keeps the namespace.
      }
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-i18n: ru language pack')
}
