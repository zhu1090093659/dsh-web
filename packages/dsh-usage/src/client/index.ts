/**
 * dsh-usage browser half — seats the first-level 使用统计 settings section
 * (below the Workshop entry) and polls the host overview only while the
 * section is open. All provider probing and credential handling happens in
 * the host half; this bundle only renders the overview document.
 * @module @linxin666/dsh-usage/client
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
import { createUsageStore, type UsageStoreInstance } from './usage-store.ts'
import { UsageSectionCard, type UsageSectionFace, type UsageSettings } from './UsageSectionCard.tsx'
import { NS, en, zh } from './locales.ts'
import type { UsageOverviewView } from '../core/types.ts'

/** The host usage API as the browser sees it (same-origin JSON endpoints). */
interface UsageHttpApi {
  overview(): Promise<UsageOverviewView>
  refresh(): Promise<UsageOverviewView>
}

/** Hard ceiling for one usage API call; a stalled host must not pile up requests. */
const USAGE_FETCH_TIMEOUT_MS = 20_000

async function usageFetch<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
  const response = await fetch(path, {
    ...(method === 'POST' ? { method: 'POST' } : {}),
    signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('usage ' + path + ' failed: ' + response.status)
  return (await response.json()) as T
}

const usageApi: UsageHttpApi = {
  overview: () => usageFetch('/api/dsh-usage/overview', 'GET'),
  refresh: () => usageFetch('/api/dsh-usage/refresh', 'POST'),
}

/** Settings namespace the section edits (dsh-web-settings maps it onto this row's profile entry id). */
const USAGE_SETTINGS_NS = 'dsh-usage'

/** First-level nav position: directly below the Workshop section (order 150). */
const SECTION_ORDER = 151

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'configForms', 'remote']

export type { UsageSectionProps, UsageSectionFace } from './UsageSectionCard.tsx'
export type { UsageUiState } from './usage-store.ts'
export type { UsageSettings }

/**
 * One settings namespace a family card binds. The 0.1.7 client exports no spec
 * type (the form controller takes it privately), so the binder's input shape is
 * restated here.
 */
export interface UsageSettingsBindSpec<T> {
  /** Settings namespace registered by the owning host plugin. */
  namespace: string
  /** Narrow one wire section; undefined keeps the last accepted value. */
  decode?: (section: unknown) => T | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional family settings binder provided by dsh-web-settings; absent when
     * that group plugin is not installed, so callers fall back to the native
     * per-entry forms (`ctx.configForms`).
     */
    webUiSettings?: { bind<S>(spec: UsageSettingsBindSpec<S>): ConfigForm<S> }
  }
}

/**
 * Client plugin body: register dictionaries and seat the settings section.
 * The overview poll loop and the store live with the section component's
 * mount cycle, so no background traffic exists while the page is closed.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh, en })
    } catch {
      return () => {}
    }
  }, 'dsh-usage: dictionaries')

  // The family binder is what maps this namespace onto the row's profile entry
  // id and hands back the native form. Without the group plugin the client can
  // only address an entry id it already knows: the namespace itself is one when
  // the profile keeps the family spelling. Any other entry id leaves the form
  // unavailable, which renders the row's controls disabled — the Host's own
  // generated page for the row still edits the same Config.
  const binder = ctx.get('webUiSettings')
  const settingsForm = binder !== undefined
    ? binder.bind<UsageSettings>({ namespace: USAGE_SETTINGS_NS })
    : ctx.configForms.get<UsageSettings>(USAGE_SETTINGS_NS)

  // One store instance per apply body; the section mounts and unmounts with
  // the settings page, and the store survives between visits so the last
  // overview renders instantly on reopen.
  const store: UsageStoreInstance = createUsageStore().create()

  let pollSeq = 0
  const poll = (): void => {
    const seq = pollSeq + 1
    pollSeq = seq
    usageApi.overview().then((snapshot) => {
      if (seq !== pollSeq) return
      store.actions.setSnapshot(snapshot)
    }, (error: unknown) => {
      if (seq !== pollSeq) return
      // Surface the transport's own message: a 404 here means the host has no
      // /api/dsh-usage/overview route (plugin disabled), which the panel must be
      // able to tell apart from a genuine failure.
      store.actions.setState('error', error instanceof Error ? error.message : String(error))
    })
  }
  // The refresh response is authoritative: it reflects the completed probe
  // cycle, so it applies even when a faster section poll already bumped the
  // sequence past it (the poll's pre-cycle snapshot is the stale one).
  const refresh = (): void => {
    const seq = pollSeq + 1
    pollSeq = seq
    usageApi.refresh().then((snapshot) => {
      pollSeq = seq
      store.actions.setSnapshot(snapshot)
    }, (error: unknown) => {
      if (seq !== pollSeq) return
      store.actions.setState('error', error instanceof Error ? error.message : String(error))
    })
  }

  const face = (): UsageSectionFace => ({ store, poll, refresh, settings: settingsForm })

  ctx.slots.inject('settings.section', () => {
    try {
      const unregister = ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-usage',
        order: SECTION_ORDER,
        label: () => ctx.locale.bind(NS)('usage.title'),
        locale: NS,
        inject: face,
      }, UsageSectionCard)
      return () => {
        unregister()
      }
    } catch {
      return () => {}
    }
  })
}
