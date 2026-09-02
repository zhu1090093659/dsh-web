/**
 * HUD alert reason formatting. The alert line used to concatenate Chinese
 * fragments in the renderer; the copy now lives in the dsh-perf dictionaries
 * ({count}/{max} placeholders) so every registered locale renders it.
 * @module dsh-perf/client/perf-alert
 */

import type { PerfKey } from './perf-locales.ts'

/** Translate seat for the dsh-perf namespace. */
export type PerfTranslate = (key: PerfKey, params?: Record<string, string | number>) => string

/** Alert block of the host stats wire (loose on purpose: host version drift). */
export interface HudAlertShape {
  kind?: string
  activeSessions?: number
  eventsPerSec?: number
  maxSessions?: number
  maxEventsPerSec?: number
}

/**
 * One readable alert reason line for the HUD, or undefined when there is
 * no alert. Undefined numbers degrade to '?' exactly like the other HUD fields.
 * @param alert - the stats wire alert block.
 * @param t - the dsh-perf translate seat (reads the active locale at call time).
 * @returns the formatted reason, or undefined without an alert.
 */
export function hudAlertReason(alert: HudAlertShape | null | undefined, t: PerfTranslate): string | undefined {
  if (alert === null || alert === undefined) return undefined
  if (alert.kind === 'sessions') {
    return t('hud.alert.sessions', { count: alert.activeSessions ?? '?', max: alert.maxSessions ?? '?' })
  }
  if (alert.kind === 'events') {
    return t('hud.alert.events', { count: alert.eventsPerSec ?? '?', max: alert.maxEventsPerSec ?? '?' })
  }
  return t('hud.alert.both')
}
