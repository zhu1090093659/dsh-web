/**
 * The automatic-maintenance settings panel inside the session-archive
 * section: independent auto-archive / auto-delete switches with day
 * thresholds (validated locally before save), candidate previews, manual
 * run-now buttons, and the persisted last-run/next-check status.
 * @module @linxin666/dsh-session-archive/client/AutoSettings
 */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  AUTO_ARCHIVE_DAYS_MAX,
  AUTO_ARCHIVE_DAYS_MIN,
  AUTO_DELETE_DAYS_MAX,
  AUTO_DELETE_DAYS_MIN,
  type SessionArchiveConfig,
} from '../core/config.ts'
import type { AutoStateView } from '../core/types.ts'
import type { ArchiveController } from './archive-controller.ts'
import { formatBytes, formatTime } from './dialogs.tsx'
import { t } from './locales.ts'
import styles from './archive.module.css'

/** One validated day-threshold input; invalid values are never saved. */
function DaysInput(props: {
  value: number | undefined
  min: number
  max: number
  label: string
  onSave: (value: number) => void
}): ReactNode {
  const [text, setText] = useState<string | null>(null)
  const effective = text ?? (props.value === undefined ? '' : String(props.value))
  const parsed = Number(effective)
  const valid = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= props.min && parsed <= props.max
  return (
    <label className={styles.daysRow}>
      <span>{props.label}</span>
      <input
        type="number"
        className={`${styles.daysInput} ${effective !== '' && !valid ? styles.inputInvalid : ''}`}
        value={effective}
        min={props.min}
        max={props.max}
        onChange={(event) => { setText(event.target.value) }}
        onBlur={() => {
          // Save only valid integers; an invalid or out-of-range value stays
          // in the field with its error message and is never saved.
          if (effective === '') {
            setText(null)
            return
          }
          if (valid) {
            props.onSave(parsed)
            setText(null)
          }
        }}
      />
      <span className={styles.muted}>{t('arch.auto.days.unit')}</span>
      {effective !== '' && !valid && (
        <span className={styles.failText}>{t('arch.auto.invalidDays', { min: props.min, max: props.max })}</span>
      )}
    </label>
  )
}

export function AutoSettingsPanel(props: {
  settings: SettingsScope<SessionArchiveConfig>
  controller: ArchiveController
  auto?: AutoStateView
}): ReactNode {
  // Subscribe: the settings mirror replaces the snapshot object after each
  // accepted write; without this subscription the controlled checkboxes never
  // re-render and appear stuck. The scope's subscribe/getSnapshot are
  // prototype methods of the official SettingsScope, and useSyncExternalStore
  // invokes both as bare functions — they must be bound to the scope first or
  // `this.store` reads undefined and the slot crashes.
  const settings = props.settings
  const subscribe = useMemo(() => settings.subscribe.bind(settings), [settings])
  const getSnapshot = useMemo(() => settings.getSnapshot.bind(settings), [settings])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const value: SessionArchiveConfig = snapshot.value ?? {}
  const ui = useSyncExternalStore(props.controller.store.subscribe, props.controller.store.getSnapshot)
  const autoPreview = ui.autoPreview
  const autoPreviewLoading = ui.autoPreviewLoading
  const cycleRunning = props.auto?.cycleRunning === true

  const runStatsLine = (stats: AutoStateView['lastArchiveRun'], key: 'arch.auto.lastArchive' | 'arch.auto.lastDelete'): ReactNode => {
    if (stats === undefined) return <span className={styles.muted}>{t('arch.auto.neverRun')}</span>
    return <span>{t(key, { time: formatTime(stats.at), total: stats.total, ok: stats.ok, skipped: stats.skipped, failed: stats.failed })}</span>
  }

  return (
    <div className={styles.autoPanel} data-dsh-part="settings">
      <div className={styles.autoTitle}>{t('arch.auto.title')}</div>
      <div className={styles.muted}>{t('arch.auto.defaultOff')}</div>

      <div className={styles.autoRow}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={value.autoArchiveEnabled === true}
            onChange={(event) => { void props.settings.set('autoArchiveEnabled', event.target.checked) }}
          />
          <span>{t('arch.auto.archiveToggle')}</span>
        </label>
        <DaysInput
          value={value.autoArchiveDays}
          min={AUTO_ARCHIVE_DAYS_MIN}
          max={AUTO_ARCHIVE_DAYS_MAX}
          label={t('arch.auto.archiveDays')}
          onSave={(value) => { void props.settings.set('autoArchiveDays', value) }}
        />
      </div>

      <div className={styles.autoRow}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={value.autoDeleteEnabled === true}
            onChange={(event) => { void props.settings.set('autoDeleteEnabled', event.target.checked) }}
          />
          <span>{t('arch.auto.deleteToggle')}</span>
        </label>
        <DaysInput
          value={value.autoDeleteDays}
          min={AUTO_DELETE_DAYS_MIN}
          max={AUTO_DELETE_DAYS_MAX}
          label={t('arch.auto.deleteDays')}
          onSave={(value) => { void props.settings.set('autoDeleteDays', value) }}
        />
      </div>

      <div className={styles.autoActions}>
        <button type="button" className={styles.button} disabled={cycleRunning} onClick={() => { void props.controller.refreshAutoPreview() }}>
          {autoPreviewLoading === true ? t('arch.auto.preview.loading') : t('arch.auto.preview')}
        </button>
        <button type="button" className={styles.button} disabled={cycleRunning} onClick={() => { void props.controller.runAuto('archive') }}>
          {t('arch.auto.runArchive')}
        </button>
        <button type="button" className={styles.dangerButton} disabled={cycleRunning} onClick={() => { void props.controller.runAuto('delete') }}>
          {t('arch.auto.runDelete')}
        </button>
      </div>
      {cycleRunning && <div className={styles.muted}>{t('arch.auto.cycleRunning')}</div>}

      {autoPreview !== null && (
        <div className={styles.autoPreviewBox}>
          <div>{t('arch.auto.preview.archive', { n: autoPreview.archiveCandidates.length })}</div>
          <div>{t('arch.auto.preview.delete', { n: autoPreview.deleteCandidates.length, size: formatBytes(autoPreview.deleteBytes) })}</div>
          {autoPreview.archiveCandidates.length === 0 && autoPreview.deleteCandidates.length === 0 && (
            <div className={styles.muted}>{t('arch.auto.preview.none')}</div>
          )}
        </div>
      )}

      <div className={styles.autoStats}>
        {runStatsLine(props.auto?.lastArchiveRun, 'arch.auto.lastArchive')}
        {runStatsLine(props.auto?.lastDeleteRun, 'arch.auto.lastDelete')}
        {props.auto?.nextCheckAt !== undefined && (
          <span className={styles.muted}>{t('arch.auto.nextRun', { time: formatTime(props.auto.nextCheckAt) })}</span>
        )}
      </div>
      <div className={styles.autoBasis}>{t('arch.auto.basis')}</div>
    </div>
  )
}
