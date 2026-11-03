/**
 * Browser-half entry for the dsh-i18n family dictionary pack. DSH owns the
 * Russian language definition and the shell dictionaries; this plugin adds only
 * the family-owned Russian namespaces.
 *
 * `register(ns, 'ru', dict)` throws on a duplicate (ns, locale), so another
 * owner keeps its namespace while the remaining family registrations proceed.
 * Every disposer is idempotent and teardown releases only successful entries.
 * @module @linxin666/dsh-i18n/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ruDictionaries } from './ru/index.ts'

/** The locale contributed by this dictionary pack. */
export const RU_LOCALE = 'ru' as const

/** Services required by the browser half. */
export const inject = ['locale']

/**
 * Register every covered family namespace's ru dictionary.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    for (const [ns, dict] of Object.entries(ruDictionaries)) {
      try {
        disposers.push(ctx.locale.register(ns, RU_LOCALE, dict))
      } catch {
        // Duplicate (ns, locale): the current owner keeps the namespace.
      }
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-i18n: family ru dictionaries')
}
