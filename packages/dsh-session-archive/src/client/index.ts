/**
 * dsh-session-archive browser half — takes over the official
 * `archived-sessions` settings section instead of seating a parallel
 * first-level entry. The official
 * `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions` page owns that
 * section id at order 25, and `dsh-web-all` retires its row, so exactly one
 * 「已归档会话」 nav entry remains and it carries both the native restore
 * behaviour (the section opens on the archived view) and this plugin's batch,
 * delete and retention surfaces. All session enumeration and mutation happens
 * in the host half over loopback-fenced routes; this bundle renders the
 * inventory document and drives the batch pipelines.
 * @module @linxin666/dsh-session-archive/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the shared-forms Context merge (ctx.configForms).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.slots merge (the renderer owns the slot registry since 0.1.2).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the client sessions face merge (ctx.sessions) for the
// current-selection id and the post-batch feed refresh. Deliberately NOT
// imported: the api-session-controller client merge declares `sessions` on
// Context and would collide with the host dsh-session merge inside this
// package's single tsc program. The face is read via a duck-typed cast.
import { createElement } from 'react'
import { ArchiveController } from './archive-controller.ts'
import { mainViewSessionId } from './main-session.ts'
import { SessionArchiveCard, type SessionArchiveFace } from './SessionArchiveCard.tsx'
import { NS, en, zh } from './locales.ts'
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
 * group plugin addresses the entry id directly, which is the bundle patch row
 * id this package installs under.
 */
const ARCHIVE_SETTINGS_NS = 'session-archive'

/**
 * Nav position (and id) of the official archived-sessions entry this plugin
 * supersedes: the native page seats `settings.section` id
 * `archived-sessions` at order 25, so taking over the id and the order keeps
 * the single entry exactly where users already look for it.
 */
const SECTION_ID = 'archived-sessions'
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

  // The family binder resolves the family namespace onto this row's profile
  // entry id and binds the native shared form; a deployment without the group
  // plugin addresses the entry id directly (the bundle row id is the entry id).
  const binder = ctx.get('webUiSettings')
  const settingsForm = binder !== undefined
    ? binder.bind<SessionArchiveConfig>({ namespace: ARCHIVE_SETTINGS_NS })
    : ctx.configForms.get<SessionArchiveConfig>(ARCHIVE_SETTINGS_NS)

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
