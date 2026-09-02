/**
 * Dialog surfaces for the session-archive section: the physical-delete
 * confirmation (with family cascade accounting and a strong second
 * confirmation for large deletes), the live batch progress, and the
 * session preview. All dialogs are keyboard-accessible (Esc closes, focus
 * moves in on open and back on close) and render with role=dialog.
 * @module @linxin666/dsh-session-archive/client/dialogs
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConfirmDeleteState, BatchProgress } from './archive-store.ts'
import { t } from './locales.ts'
import styles from './archive.module.css'

/** Human-readable byte size. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return t('arch.time.unknown')
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  danger?: boolean
  /** Extra width for content-heavy surfaces (session preview). */
  wide?: boolean
}

/** Shared modal shell: focus on open, Esc to close, restore focus after. */
export function Modal({ title, onClose, children, danger, wide }: ModalProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`${styles.modal} ${danger === true ? styles.modalDanger : ''} ${wide === true ? styles.modalWide : ''}`}
        data-dsh-part="dialog"
      >
        <div className={styles.modalTitle}>{title}</div>
        {children}
      </div>
    </div>
  )
}

/** Delete confirmation with full cascade accounting. */
export function DeleteConfirmDialog(props: {
  state: ConfirmDeleteState
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const [acknowledged, setAcknowledged] = useState(false)
  const needCheck = props.state.strong
  return (
    <Modal title={t('arch.confirm.deleteTitle')} onClose={props.onCancel} danger>
      <div className={styles.confirmBody}>
        <div className={styles.confirmLine}>{t('arch.confirm.direct', { n: props.state.ids.length })}</div>
        <div className={styles.confirmLine}>{t('arch.confirm.descendants', { n: props.state.descendants })}</div>
        <div className={styles.confirmTotal}>{t('arch.confirm.total', { n: props.state.total })}</div>
        {props.state.skippedProtected > 0 && (
          <div className={styles.muted}>{t('arch.confirm.skipped', { n: props.state.skippedProtected })}</div>
        )}
        {props.state.totalBytes > 0 && (
          <div className={styles.muted}>{t('arch.confirm.freed', { size: formatBytes(props.state.totalBytes) })}</div>
        )}
        <div className={styles.dangerCallout}>{t('arch.confirm.irrecoverable')}</div>
        {needCheck && (
          <label className={styles.ackRow}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => { setAcknowledged(event.target.checked) }}
            />
            <span>{t('arch.confirm.strongCheck')}</span>
          </label>
        )}
      </div>
      <div className={styles.modalActions}>
        <button type="button" className={styles.button} onClick={props.onCancel}>{t('arch.confirm.cancel')}</button>
        <button
          type="button"
          className={styles.dangerButton}
          disabled={needCheck && !acknowledged}
          onClick={props.onConfirm}
        >
          {t('arch.confirm.confirm')}
        </button>
      </div>
    </Modal>
  )
}

/** Live batch progress with per-session skip/fail reasons. */
export function BatchDialog(props: {
  batch: BatchProgress
  onClose: () => void
  onRetryFailed: () => void
}): ReactNode {
  const { batch } = props
  const failed = batch.results.filter((result) => result.status === 'failed')
  const skipped = batch.results.filter((result) => result.status === 'skipped')
  const ok = batch.results.filter((result) => result.status === 'ok')
  const reasonText = (result: (typeof batch.results)[number]): string => {
    const base = result.reason === undefined ? t('arch.reason.error') : t(`arch.reason.${result.reason}`)
    return result.detail === undefined ? base : `${base} (${result.detail})`
  }
  return (
    <Modal title={t(`arch.batch.title.${batch.kind}`)} onClose={batch.running ? () => {} : props.onClose}>
      <div className={styles.batchBody}>
        <div>{t('arch.batch.progress', { processed: batch.processed, total: batch.total })}</div>
        <div className={styles.progressBar} role="progressbar" aria-valuenow={batch.processed} aria-valuemax={batch.total}>
          <div
            className={`${styles.progressFill} ${batch.kind === 'delete' ? styles.progressFillDanger : ''}`}
            style={{ width: batch.total === 0 ? '100%' : `${Math.min(100, Math.round((batch.processed / batch.total) * 100))}%` }}
          />
        </div>
        <div className={styles.batchStats}>
          <span>{batch.running ? t('arch.batch.running') : batch.error !== null ? t('arch.batch.withError') : t('arch.batch.finished')}</span>
          <span>{t('arch.batch.ok', { n: ok.length })}</span>
          <span>{t('arch.batch.skipped', { n: skipped.length })}</span>
          <span>{t('arch.batch.failed', { n: failed.length })}</span>
          {batch.freedBytes > 0 && <span>{t('arch.batch.freed', { size: formatBytes(batch.freedBytes) })}</span>}
        </div>
        {!batch.running && skipped.length > 0 && (
          <div className={styles.muted}>
            {t('arch.batch.skipSummary', {
              summary: Object.entries(
                skipped.reduce<Record<string, number>>((acc, result) => {
                  const key = result.reason ?? 'error'
                  acc[key] = (acc[key] ?? 0) + 1
                  return acc
                }, {}),
              )
                .map(([reason, n]) => `${t(`arch.reason.${reason}`)} ×${n}`)
                .join(' · '),
            })}
          </div>
        )}
        {!batch.running && failed.length > 0 && (
          <button type="button" className={styles.button} onClick={props.onRetryFailed}>{t('arch.batch.retryFailed')}</button>
        )}
        {(failed.length > 0 || skipped.length > 0) && (
          <ul className={styles.batchList}>
            {[...failed, ...skipped].slice(0, 60).map((result) => (
              <li key={result.id}>
                <code className={styles.rowId}>{result.id}</code>
                <span className={result.status === 'failed' ? styles.failText : styles.muted}>{reasonText(result)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.modalActions}>
        <button type="button" className={styles.button} disabled={batch.running} onClick={props.onClose}>{t('arch.close')}</button>
      </div>
    </Modal>
  )
}

/** Session preview: basic info + a tolerant conversation excerpt. */
export function PreviewDialog(props: {
  preview: { id: string; status: 'loading' | 'ready' | 'error'; data?: { title?: string; createdAt?: number; cwd?: string; sizeBytes?: number; messageCount: number; excerpt: readonly { role: string; text: string }[] }; error?: string }
  onClose: () => void
  onRetry: () => void
}): ReactNode {
  const { preview } = props
  return (
    <Modal title={t('arch.preview.title')} onClose={props.onClose} wide>
      <div className={styles.previewBody}>
        {preview.status === 'loading' && <div className={styles.muted}>{t('arch.loading')}</div>}
        {preview.status === 'error' && (
          <>
            <div className={styles.failText}>{t('arch.preview.loadError', { error: preview.error ?? '' })}</div>
            <button type="button" className={styles.button} onClick={props.onRetry}>{t('arch.retry')}</button>
          </>
        )}
        {preview.status === 'ready' && preview.data !== undefined && (
          <>
            <div className={styles.previewMeta}>
              <div><code className={styles.rowId}>{preview.id}</code></div>
              {preview.data.title !== undefined && <div>{preview.data.title}</div>}
              {preview.data.createdAt !== undefined && <div>{t('arch.row.created', { time: formatTime(preview.data.createdAt) })}</div>}
              {preview.data.cwd !== undefined && <div className={styles.muted}>{preview.data.cwd}</div>}
              {preview.data.sizeBytes !== undefined && <div className={styles.muted}>{t('arch.row.size', { size: formatBytes(preview.data.sizeBytes) })}</div>}
              <div>{t('arch.preview.messages', { n: preview.data.messageCount })}</div>
            </div>
            {preview.data.excerpt.length === 0
              ? <div className={styles.muted}>{t('arch.preview.empty')}</div>
              : (
                <>
                  <div className={styles.previewSection}>{t('arch.preview.excerpt')}</div>
                  <ul className={styles.previewList}>
                    {preview.data.excerpt.map((message, index) => (
                      <li key={index} className={message.role === 'user' ? styles.previewUser : styles.previewAssistant}>
                        <span className={styles.previewRole}>{message.role}</span>
                        <span>{message.text}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </>
        )}
      </div>
      <div className={styles.modalActions}>
        <button type="button" className={styles.button} onClick={props.onClose}>{t('arch.close')}</button>
      </div>
    </Modal>
  )
}
