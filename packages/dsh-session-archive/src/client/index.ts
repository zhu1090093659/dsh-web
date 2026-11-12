/**
 * dsh-session-archive browser half — seats this plugin's own
 * `settings.section` (id `dsh-session-archive`, the plugin id) at nav order
 * 25. The id is never the official `archived-sessions` one: the settings shell
 * renders one nav row per registration without merging same-id sections, and
 * its registry refuses a second registration of the same `id` at the same
 * `priority` (default 0), while `order` only sorts the rows. Two archive
 * plugins claiming the same section id therefore collide whatever order they
 * pick — one registration throws, or one of the two entries silently
 * disappears. Distinct ids let an official page and a third-party archive
 * plugin coexist with this one, one entry each, while a single-archive-plugin
 * install still shows exactly one entry. The section carries this plugin's
 * inventory, batch
 * archive/unarchive, cascade physical delete and retention surfaces. All session
 * enumeration and mutation happens in the host half over loopback-fenced
 * routes; this bundle renders the inventory document and drives the batch
 * pipelines.
 * @module @linxin666/dsh-session-archive/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the shared-forms Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the locale Translate signature (the LocaleNamespaceMap merge
// this namespace declares lives in ./locales.ts).
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the client sessions face merge (ctx.sessions) for the
// current-selection id and the post-batch feed refresh. Deliberately NOT
// imported: the api-session-controller client merge declares `sessions` on
// Context and would collide with the host dsh-session merge inside this
// package's single tsc program. The face is read via a duck-typed cast.
import { ArchiveController } from './archive-controller.ts'
import { mainViewSessionId } from './main-session.ts'
import { SessionArchiveCard, type SessionArchiveFace } from './SessionArchiveCard.tsx'
import { NS, en, setRuntimeTranslate, zh } from './locales.ts'
import { createServedEntryForm } from './settings-entry-form.ts'
import type { SessionArchiveConfig } from '../core/config.ts'

/** Minimal duck-typed face of the browser sessions service. */
interface SessionsFace {
  list: { getSnapshot(): { byId?: Record<string, { id: string; retainedBy?: Readonly<Partial<Record<string, number>>> | undefined } | undefined> } }
  refresh?: () => Promise<void>
}

/**
 * Settings this section edits. The family binder (`ctx.get('webUiSettings')`)
 * resolves it onto the row's profile entry id — `web-ui-session-archive` under
 * the aggregate, `session-archive` standalone — while a deployment without the
 * group plugin binds the entry id the describe mirror justifies, rebound as soon
 * as the mirror answers.
 */
const ARCHIVE_SETTINGS_NS = 'session-archive'

/** Profile entry id the family aggregate's generated row carries. */
const AGGREGATE_ENTRY_ID = 'web-ui-session-archive'

/** Profile entry ids this package's patch rows carry, most likely first. */
const ARCHIVE_ENTRY_IDS: readonly string[] = [AGGREGATE_ENTRY_ID, ARCHIVE_SETTINGS_NS]

/**
 * Section id and nav position this plugin seats. The id is the plugin's own
 * namespace, never the official `archived-sessions` id: the settings shell
 * refuses a second registration of the same `id` at the same `priority`
 * (default 0), and `order` only sorts the rows, so an official or third-party
 * archive plugin claiming the same id breaks both surfaces whatever order it
 * picks (one registration throws, or one entry silently vanishes). Order 25
 * seats this entry beside the official archived-sessions row, where users look
 * for archive management.
 */
const SECTION_ID = 'dsh-session-archive'
const SECTION_ORDER = 25

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'configForms', 'remote', 'sessions']

export type { SessionArchiveFace } from './SessionArchiveCard.tsx'
export type { SessionArchiveConfig }

/**
 * One settings namespace a family card binds. The 0.1.7 client exports no spec
 * type (the form controller takes it privately), so the binder's input shape is
 * restated here.
 */
export interface SessionArchiveFormSpec<T> {
  /** Settings namespace registered by the owning host plugin. */
  namespace: string
  /** Narrow one wire section; undefined keeps the last accepted value. */
  decode?: (section: unknown) => T | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional family settings binder provided by dsh-web-settings; absent when
     * that group plugin is not installed, so callers bind the shared forms
     * service (`ctx.configForms`) by profile entry id directly.
     */
    webUiSettings?: { bind<S>(spec: SessionArchiveFormSpec<S>): ConfigForm<S> }
  }
}

/**
 * Client plugin body: register dictionaries and seat the settings section.
 * The controller and store live with the apply body, so the last inventory
 * renders instantly when the section is reopened.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-session-archive: dictionaries')

  // Card copy resolves through the locale service: the bound function reads
  // the ACTIVE language at call time and walks its fallback chain, so a
  // language a pack registers for this namespace (dsh-i18n's ru) reaches the
  // card body instead of the zh branch the document-language pick would pick.
  // The cast widens the bound seat to plain string keys because the card
  // builds dynamic ones (`arch.reason.${reason}`); the service degrades an
  // unknown key to the key itself, which is what `t` already did.
  try {
    setRuntimeTranslate(ctx.locale.bind(NS) as Translate<string>)
  } catch {
    // Locale service absent: locales.ts keeps its document-language fallback.
  }

  // The family binder resolves the family namespace onto this row's profile
  // entry id and binds the native shared form; a deployment without the group
  // plugin binds the entry id the describe mirror justifies, rebound as soon as
  // the mirror answers (the namespace alone is an entry id only on a standalone
  // install, so binding it on the aggregate left the form unavailable).
  const binder = ctx.get('webUiSettings')
  const settingsForm = binder !== undefined
    ? binder.bind<SessionArchiveConfig>({ namespace: ARCHIVE_SETTINGS_NS })
    : createServedEntryForm<SessionArchiveConfig>({ forms: ctx.configForms, entryIds: ARCHIVE_ENTRY_IDS })

  const sessionsFace = (() => {
    try {
      const sessions = (ctx as unknown as { get(name: string): unknown }).get('sessions') as SessionsFace | undefined
      if (sessions === undefined) return undefined
      const refresh = typeof sessions.refresh === 'function' ? sessions.refresh.bind(sessions) : undefined
      const current = (): string | undefined => {
        try {
          return mainViewSessionId(sessions.list?.getSnapshot?.()?.byId)
        } catch {
          return undefined
        }
      }
      return { current, ...(refresh !== undefined ? { refresh: () => refresh() } : {}) }
    } catch {
      return undefined
    }
  })()

  const controller = new ArchiveController({ sessions: sessionsFace })
  const face = (): SessionArchiveFace => ({ controller, settings: settingsForm })

  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: () => ctx.locale.bind(NS)('arch.nav'),
        locale: NS,
        inject: face,
      }, SessionArchiveCard)
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })
}
