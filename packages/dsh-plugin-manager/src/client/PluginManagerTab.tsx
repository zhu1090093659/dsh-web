/**
 * The shadowed "All" tab inside the Plugins settings section: a searchable
 * list of every loaded plugin entry with an enable/disable switch per row.
 * Pure presentation — every mutation goes through the injected controller
 * face; the tab holds no business state of its own.
 * @module @linxin666/dsh-plugin-manager/client/PluginManagerTab
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginManagerTabInjected, PluginManagerState } from './controller.ts'
import type { PluginManagerKey } from './locales.ts'
import type { PluginRow } from '../protocol.ts'
import css from './plugin-manager.module.css'

/** Full component props. */
export type PluginManagerTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'plugin-manager'>
  & InjectFace<PluginManagerTabInjected>

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Localized fiber phase label. */
function phaseLabel(phase: PluginRow['fiberPhase'], t: (key: PluginManagerKey) => string): string {
  switch (phase) {
    case 'pending': return t('pending')
    case 'loading': return t('loadingPhase')
    case 'active': return t('active')
    case 'failed': return t('failed')
    case 'unloading': return t('unloading')
    default: return t('unobserved')
  }
}

/** Whether an inventory row matches the local search query. */
function matches(entry: PluginRow, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** One plugin row. */
function PluginRowView(props: {
  entry: PluginRow
  t: (key: PluginManagerKey, params?: Record<string, string | number>) => string
  toggling: boolean
  notice?: string
  onToggle: (enabled: boolean) => void
}) {
  const { entry, t, toggling, notice, onToggle } = props
  const title = moduleShortName(entry.moduleName)
  return (
    <li className={css.row} data-entry={entry.entryId}>
      <div className={css.rowMain}>
        <span className={css.name} title={entry.moduleName}>{title}</span>
        <span className={css.entryId} title={entry.entryId}>{t('entryId')}: {entry.entryId}</span>
        <span className={css.badges}>
          {entry.official ? <span className={css.officialBadge} title={t('officialNote')}>{t('official')}</span> : null}
          {entry.protected ? <span className={css.protectedBadge}>{t('protected')}</span> : null}
        </span>
      </div>
      <div className={css.rowActions}>
        {notice !== undefined ? <span className={css.notice} role="status">{t(notice as PluginManagerKey, { name: title })}</span> : null}
        <span className={css.status}>
          {entry.enabled ? <span className={css.statusDot} data-phase={entry.fiberPhase ?? 'unobserved'} role="img" aria-label={phaseLabel(entry.fiberPhase, t)} title={phaseLabel(entry.fiberPhase, t)} /> : null}
          {t(entry.enabled ? 'enabled' : 'disabled')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={entry.enabled}
          aria-label={t(entry.enabled ? 'toggleDisable' : 'toggleEnable', { name: title })}
          className={entry.enabled ? `${css.switch} ${css.switchOn}` : css.switch}
          disabled={entry.protected || toggling}
          onClick={() => { onToggle(!entry.enabled) }}
        >
          <span className={css.knob} />
        </button>
        {toggling ? <span className={css.hint} role="status">{t('toggling')}</span> : null}
      </div>
    </li>
  )
}

/**
 * Render the plugin enable/disable tab.
 * @param props - locale copy, the tab snapshot, and its actions.
 * @returns the tab.
 */
export function PluginManagerTab(props: PluginManagerTabProps): ReactNode {
  const { t } = props
  const state = props.usePluginManager((snapshot: PluginManagerState) => snapshot)
  const [query, setQuery] = useState('')
  useEffect(() => {
    void props.load()
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(
    () => state.entries.filter(entry => matches(entry, normalizedQuery)),
    [normalizedQuery, state.entries],
  )

  return (
    <div className={css.section} aria-busy={state.phase === 'loading'}>
      <p className={css.lead}>{t('description')}</p>
      {state.phase === 'loading' ? <p className={css.message} role="status">{t('loading')}</p> : null}
      {state.phase === 'error' ? (
        <div className={css.failure}>
          <p className={css.error} role="status">{t('loadFailed')}: {state.error}</p>
          <button type="button" className={css.button} onClick={() => { void props.load() }}>{t('retry')}</button>
        </div>
      ) : null}
      {state.phase === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
          <div className={css.catalogHeading}>
            <h3>{t('title')}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {state.entries.length === 0 ? <p className={css.message}>{t('empty')}</p> : null}
          {state.entries.length > 0 && filteredEntries.length === 0
            ? <p className={css.message}>{t('emptySearch')}</p>
            : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.list}>
              {filteredEntries.map(entry => (
                <PluginRowView
                  key={entry.entryId}
                  entry={entry}
                  t={t}
                  toggling={state.toggling[entry.entryId] === true}
                  notice={state.rowNotices[entry.entryId]}
                  onToggle={(enabled) => { void props.toggle(entry.entryId, enabled) }}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
