/**
 * The preview toolbar: 32px bar (padding 0 10). Left: source/preview toggle
 * (markdown/html), split-screen toggle (editable types), download. Right: the
 * refresh button (4-state: hidden/disabled/idle/updated — never a dead
 * button) and save (editable + dirty, Cmd/Ctrl+S too).
 * @module dsh-aionui-panel/client/preview/PreviewToolbar
 */

import type { JSX } from 'react'
import type { PreviewContentType } from '../../core/types.ts'
import { isEditableType } from '../fileType.ts'
import { t } from '../locales.ts'
import { CodeIcon, DownloadIcon, EyeIcon, RefreshIcon, SaveIcon, SplitIcon } from '../components/icons.tsx'
import previewCss from '../styles/preview.module.css'

/** Refresh button states (AionUi's 4-state machine). */
export type RefreshState = 'hidden' | 'disabled' | 'idle' | 'updated'

/** Derive the refresh state for one tab. */
export function refreshStateFor(
  contentType: PreviewContentType,
  hasContent: boolean,
  loading: boolean,
  updated: boolean,
): RefreshState {
  // URL tabs reload their frame (cross-origin documents can only be
  // re-navigated to the tab's address, never reloaded in place).
  if (contentType === 'url') return 'idle'
  if (contentType === 'word' || contentType === 'excel'
    || contentType === 'ppt' || contentType === 'unsupported' || contentType === 'image') {
    return 'hidden'
  }
  if (!hasContent || loading) return 'disabled'
  return updated ? 'updated' : 'idle'
}

/** Download the current tab's content as a file. */
export function downloadTab(tab: { title: string; content: string | null; contentType: PreviewContentType }): void {
  if (tab.content === null) return
  const isDataUrl = tab.content.startsWith('data:')
  // Pdf tabs hold a same-origin raw-route URL: anchor it directly (the
  // download attribute forces a save), no blob copy needed.
  const isRouteUrl = tab.content.startsWith('/aionui-panel/raw')
  const href = isDataUrl || isRouteUrl
    ? tab.content
    : URL.createObjectURL(new Blob([tab.content], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = tab.title
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  if (!isDataUrl && !isRouteUrl) setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

/** The toolbar. */
export function PreviewToolbar({
  contentType,
  hasContent,
  loading,
  dirty,
  updated,
  viewMode,
  canToggleView,
  split,
  canSplit,
  onViewModeChange,
  onSplitChange,
  onRefresh,
  onSave,
  onDownload,
}: {
  contentType: PreviewContentType
  hasContent: boolean
  loading: boolean
  dirty: boolean
  updated: boolean
  viewMode: 'source' | 'preview'
  canToggleView: boolean
  split: boolean
  canSplit: boolean
  onViewModeChange: (mode: 'source' | 'preview') => void
  onSplitChange: (split: boolean) => void
  onRefresh: () => void
  onSave: () => void
  onDownload: () => void
}): JSX.Element {
  const refreshState = refreshStateFor(contentType, hasContent, loading, updated)
  const editable = isEditableType(contentType)

  return (
    <div className={previewCss.toolbar}>
      {canToggleView && (
        <>
          <button
            type="button"
            className={`${previewCss.toolbarBtn}${viewMode === 'source' ? ` ${previewCss.toolbarBtnActive}` : ''}`}
            onClick={() => onViewModeChange('source')}
          >
            <CodeIcon size={13} />
            {t('preview.source')}
          </button>
          <button
            type="button"
            className={`${previewCss.toolbarBtn}${viewMode === 'preview' ? ` ${previewCss.toolbarBtnActive}` : ''}`}
            onClick={() => onViewModeChange('preview')}
          >
            <EyeIcon size={13} />
            {t('preview.preview')}
          </button>
        </>
      )}
      {canSplit && (
        <button
          type="button"
          className={`${previewCss.toolbarBtn}${split ? ` ${previewCss.toolbarBtnActive}` : ''}`}
          title={t('preview.split')}
          onClick={() => onSplitChange(!split)}
        >
          <SplitIcon size={13} />
          {t('preview.split')}
        </button>
      )}
      <button
        type="button"
        className={previewCss.toolbarBtn}
        title={t('preview.download')}
        disabled={!hasContent}
        onClick={onDownload}
      >
        <DownloadIcon size={13} />
      </button>
      <span className={previewCss.toolbarSpacer} />
      {refreshState !== 'hidden' && (
        <button
          type="button"
          className={`${previewCss.toolbarBtn}${refreshState === 'updated' ? ` ${previewCss.toolbarBtnWarn}` : ''}`}
          title={refreshState === 'updated' ? t('preview.refresh.updated') : t('preview.refresh')}
          disabled={refreshState === 'disabled'}
          onClick={onRefresh}
        >
          <RefreshIcon size={13} />
          {t('preview.refresh')}
        </button>
      )}
      {editable && dirty && (
        <button
          type="button"
          className={previewCss.toolbarBtn}
          onClick={onSave}
          disabled={loading}
        >
          <SaveIcon size={13} />
          {t('preview.save')}
        </button>
      )}
    </div>
  )
}
