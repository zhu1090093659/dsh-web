/**
 * The embedded side-card preferences editor. The external dsh-better-sidebar
 * plugin keeps its user preferences behind its own fenced /sidebar/api
 * settings routes (its settings namespace is not allowlisted on the official
 * settings RPC), so this editor reads and writes through the same transport
 * its own settings section uses: POST /sidebar/api/settings.get for the
 * initial document and revision, POST /sidebar/api/settings.update with a
 * revision-guarded merge patch per change. Changes apply immediately, the
 * same optimistic-then-settle behavior as the plugin's own section.
 *
 * Coverage is the everyday surface of the section page: the general group
 * (open by default, width, chat file opens, position compat) plus the
 * sidebar tab and file viewer enable switches, enumerated live from the
 * plugin's registry service. Niche per-feature settings (terminal font,
 * sandbox switches, strip height) stay in the 'dsh-better-sidebar'
 * namespace of ~/.dsh/settings.yaml.
 * @module @linxin666/dsh-client-ui-aionui-panel/client/SideCardPrefs
 */

import { useEffect, useRef, useState } from 'react'
import css from './settings-card.module.css'
import cardCss from './AionUiSettingsCard.module.css'

/** The registry slice this editor reads from the external plugin's service. */
export interface SideCardRegistry {
  getTabs(): readonly { id: string; title: string | (() => string); hidden?: boolean }[]
  getFileViewers(): readonly { id: string; title?: string | (() => string); exts: readonly string[] }[]
  subscribe(listener: () => void): () => void
}

/** The preference fields this editor renders (a subset of the plugin's SidebarPrefs). */
interface SideCardPrefsValue {
  openByDefault: boolean
  defaultWidthPercent: number
  interceptOpenPath: boolean
  titleBarCompat: boolean
  tabsEnabled: Record<string, boolean>
  viewersEnabled: Record<string, boolean>
}

/** Display fallbacks while a field is absent from the settings document (mirrors the plugin's schema defaults). */
const PREFS_DEFAULTS: SideCardPrefsValue = {
  openByDefault: false,
  defaultWidthPercent: 35,
  interceptOpenPath: true,
  titleBarCompat: false,
  tabsEnabled: {},
  viewersEnabled: {},
}

const WIDTH_MIN = 20
const WIDTH_MAX = 60

/** Validate one raw resolved document into the fields this editor renders; malformed fields fall back to defaults. */
function parsePrefs(value: unknown): SideCardPrefsValue {
  if (value === null || typeof value !== 'object') return { ...PREFS_DEFAULTS }
  const record = value as Record<string, unknown>
  const bool = (key: 'openByDefault' | 'interceptOpenPath' | 'titleBarCompat'): boolean =>
    typeof record[key] === 'boolean' ? (record[key] as boolean) : PREFS_DEFAULTS[key]
  const map = (key: 'tabsEnabled' | 'viewersEnabled'): Record<string, boolean> => {
    const raw = record[key]
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, boolean> = {}
    for (const [id, flag] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof flag === 'boolean') out[id] = flag
    }
    return out
  }
  const width = typeof record.defaultWidthPercent === 'number' && Number.isFinite(record.defaultWidthPercent)
    ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(record.defaultWidthPercent)))
    : PREFS_DEFAULTS.defaultWidthPercent
  return {
    openByDefault: bool('openByDefault'),
    defaultWidthPercent: width,
    interceptOpenPath: bool('interceptOpenPath'),
    titleBarCompat: bool('titleBarCompat'),
    tabsEnabled: map('tabsEnabled'),
    viewersEnabled: map('viewersEnabled'),
  }
}

/** The settings wire view (the envelope's value): the raw document plus its revision. */
interface SettingsView {
  value?: unknown
  revision?: number
}

/** POST one settings wire call and unwrap the envelope, mirroring the plugin's own api.call. */
async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/sidebar/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const parsed: { ok?: boolean; value?: unknown; error?: { message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new Error(parsed?.error?.message ?? 'HTTP ' + response.status)
  }
  return parsed.value as T
}

/** One immediate-apply boolean row. */
function ToggleRow(props: { label: string; hint?: string; value: boolean; onLabel: string; offLabel: string; onFlip: (next: boolean) => void }) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.label}>{props.label}</span>
      </div>
      <select
        className={css.select}
        aria-label={props.label}
        value={props.value ? 'true' : 'false'}
        onChange={event => { props.onFlip(event.target.value === 'true') }}
      >
        <option value="true">{props.onLabel}</option>
        <option value="false">{props.offLabel}</option>
      </select>
      {props.hint !== undefined ? <p className={css.hint}>{props.hint}</p> : null}
    </div>
  )
}

/** The width row: a number input committing on blur or Enter, clamped to the contract range. */
function WidthRow(props: { label: string; hint: string; value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(String(props.value))
  useEffect(() => { setDraft(String(props.value)) }, [props.value])
  const commit = (): void => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(props.value))
      return
    }
    const clamped = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(parsed)))
    setDraft(String(clamped))
    if (clamped !== props.value) props.onCommit(clamped)
  }
  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.label}>{props.label}</span>
      </div>
      <input
        className={css.input}
        type="text"
        inputMode="numeric"
        aria-label={props.label}
        value={draft}
        onChange={event => { setDraft(event.target.value) }}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') commit() }}
      />
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}

/** A descriptor's display title (a plain string or its localized thunk), id as the fallback. */
function descriptorTitle(descriptor: { id: string; title?: string | (() => string) }): string {
  const title = typeof descriptor.title === 'function' ? descriptor.title() : descriptor.title
  return title !== undefined && title !== '' ? title : descriptor.id
}

/**
 * Render the embedded side-card preferences editor.
 * @param props - the locale reader and the external plugin's registry
 *   (undefined while dsh-better-sidebar is not loaded).
 * @returns the editor, or the unavailable/loading note.
 */
/** The locale keys this editor reads (a subset of the card's dictionary). */
export type SideCardPrefsKey =
  | 'settings.generalTitle'
  | 'settings.openByDefault'
  | 'settings.openByDefaultHint'
  | 'settings.width'
  | 'settings.widthHint'
  | 'settings.openPath'
  | 'settings.openPathHint'
  | 'settings.titleBar'
  | 'settings.titleBarHint'
  | 'settings.tabsTitle'
  | 'settings.viewersTitle'
  | 'settings.prefsLoading'
  | 'settings.prefsUnavailable'
  | 'settings.on'
  | 'settings.off'

export function SideCardPrefs(props: { t: (key: SideCardPrefsKey) => string; sidebar?: SideCardRegistry | undefined }) {
  const { t } = props
  const [prefs, setPrefs] = useState<SideCardPrefsValue | null>(null)
  const [failed, setFailed] = useState(false)
  const revisionRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  const [, setRegistryVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    call<SettingsView>('settings.get', {}).then((view) => {
      if (cancelled) return
      revisionRef.current = view.revision
      setPrefs(parsePrefs(view.value))
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (props.sidebar === undefined) return undefined
    return props.sidebar.subscribe(() => { setRegistryVersion(version => version + 1) })
  }, [props.sidebar])

  /** Optimistically apply one merge patch, then commit; a failed commit refetches the authoritative document. */
  const applyPref = (patch: Partial<SideCardPrefsValue>): void => {
    const run = inFlightRef.current.then(async () => {
      const view = await call<SettingsView>('settings.update', {
        patch: { ...patch },
        ...(revisionRef.current !== undefined ? { expectedRevision: revisionRef.current } : {}),
      })
      revisionRef.current = view.revision
      setPrefs(parsePrefs(view.value))
    }).catch(async () => {
      // Revert to the server's truth: a rejected write never stays on screen.
      const view = await call<SettingsView>('settings.get', {}).catch(() => null)
      if (view !== null) {
        revisionRef.current = view.revision
        setPrefs(parsePrefs(view.value))
      }
    })
    inFlightRef.current = run.then(() => undefined, () => undefined)
    void run.catch(() => undefined)
    setPrefs(previous => previous === null ? previous : { ...previous, ...patch })
  }

  if (failed) return <p className={css.hint} role="status">{t('settings.prefsUnavailable')}</p>
  if (prefs === null) return <p className={css.hint} role="status">{t('settings.prefsLoading')}</p>

  const onLabel = t('settings.on')
  const offLabel = t('settings.off')
  // The settings inventory lists every registered tab type, including the
  // ones hidden from the + menu (editor, diff) — same as the plugin's own page.
  const tabs = props.sidebar?.getTabs() ?? []
  const viewers = props.sidebar?.getFileViewers() ?? []

  return (
    <div>
      <div className={cardCss.groupTitle}>{t('settings.generalTitle')}</div>
      <ToggleRow
        label={t('settings.openByDefault')}
        hint={t('settings.openByDefaultHint')}
        value={prefs.openByDefault}
        onLabel={onLabel}
        offLabel={offLabel}
        onFlip={next => { applyPref({ openByDefault: next }) }}
      />
      <WidthRow
        label={t('settings.width')}
        hint={t('settings.widthHint')}
        value={prefs.defaultWidthPercent}
        onCommit={next => { applyPref({ defaultWidthPercent: next }) }}
      />
      <ToggleRow
        label={t('settings.openPath')}
        hint={t('settings.openPathHint')}
        value={prefs.interceptOpenPath}
        onLabel={onLabel}
        offLabel={offLabel}
        onFlip={next => { applyPref({ interceptOpenPath: next }) }}
      />
      <ToggleRow
        label={t('settings.titleBar')}
        hint={t('settings.titleBarHint')}
        value={prefs.titleBarCompat}
        onLabel={onLabel}
        offLabel={offLabel}
        onFlip={next => { applyPref({ titleBarCompat: next }) }}
      />
      {tabs.length > 0
        ? (
          <div>
            <div className={cardCss.groupTitle}>{t('settings.tabsTitle')}</div>
            {tabs.map(tab => (
              <ToggleRow
                key={tab.id}
                label={descriptorTitle(tab)}
                value={prefs.tabsEnabled[tab.id] !== false}
                onLabel={onLabel}
                offLabel={offLabel}
                onFlip={next => { applyPref({ tabsEnabled: { ...prefs.tabsEnabled, [tab.id]: next } }) }}
              />
            ))}
          </div>
        )
        : null}
      {viewers.length > 0
        ? (
          <div>
            <div className={cardCss.groupTitle}>{t('settings.viewersTitle')}</div>
            {viewers.map(viewer => (
              <ToggleRow
                key={viewer.id}
                label={descriptorTitle(viewer)}
                hint={viewer.exts.length > 0 ? viewer.exts.join(' \u00b7 ') : undefined}
                value={prefs.viewersEnabled[viewer.id] !== false}
                onLabel={onLabel}
                offLabel={offLabel}
                onFlip={next => { applyPref({ viewersEnabled: { ...prefs.viewersEnabled, [viewer.id]: next } }) }}
              />
            ))}
          </div>
        )
        : null}
    </div>
  )
}
