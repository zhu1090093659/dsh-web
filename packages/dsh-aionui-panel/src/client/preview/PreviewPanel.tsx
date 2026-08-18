/**
 * The preview panel root: tab strip + toolbar + content router, the tab
 * context menu (close left/right/others/all), the dirty-close confirmation
 * (the single entry for every batch close — middle-click included), and the
 * panel collapse button. View mode and split live here so the toolbar and the
 * content share one source; both reset when the displayed file changes.
 * @module dsh-aionui-panel/client/preview/PreviewPanel
 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { isEditableType } from '../fileType.ts'
import { t, format } from '../locales.ts'
import { useStore } from '../hooks/useStore.ts'
import type { PanelStores, PreviewTabState } from '../store.ts'
import { ConfirmDialog, ContextMenu, type MenuState } from '../components/overlay.tsx'
import { PreviewTabs } from './PreviewTabs.tsx'
import { PreviewToolbar, downloadTab } from './PreviewToolbar.tsx'
import { TabContent } from './content.tsx'
import previewCss from '../styles/preview.module.css'

/** The preview panel (mounted in the preview grid column). */
export function PreviewPanel({ stores }: { stores: PanelStores }): JSX.Element {
  const preview = stores.preview
  const state = useStore(preview)
  const layoutState = useStore(stores.layout)
  const maximizedPreview = layoutState.maximized === 'preview'
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [closingIds, setClosingIds] = useState<string[] | null>(null)
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview')
  const [split, setSplit] = useState(false)
  const lastDirtyCheck = useRef<Set<string>>(new Set())

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null

  // View mode resets to preview when the displayed FILE changes (path+type).
  const identity = activeTab === null ? '' : `${activeTab.path}\u0000${activeTab.contentType}`
  useEffect(() => {
    setViewMode('preview')
    setSplit(false)
  }, [identity])

  /** Close a batch; dirty tabs route through the confirmation first. */
  const requestClose = (ids: string[]): void => {
    const dirty = state.tabs.filter((tab) => ids.includes(tab.id) && tab.dirty)
    if (dirty.length === 0) {
      preview.closeTabs(ids)
      return
    }
    lastDirtyCheck.current = new Set(dirty.map((tab) => tab.id))
    setClosingIds(ids)
  }

  const closeMenuFor = (event: React.MouseEvent, tab: PreviewTabState): void => {
    event.preventDefault()
    event.stopPropagation()
    const index = state.tabs.findIndex((item) => item.id === tab.id)
    setMenu({
      x: event.clientX,
      y: event.clientY,
      entries: [
        {
          key: 'close-left',
          label: t('preview.closeLeft'),
          disabled: index <= 0,
          onSelect: () => requestClose(state.tabs.slice(0, index).map((item) => item.id)),
        },
        {
          key: 'close-right',
          label: t('preview.closeRight'),
          disabled: index >= state.tabs.length - 1,
          onSelect: () => requestClose(state.tabs.slice(index + 1).map((item) => item.id)),
        },
        { key: 'sep-1', label: '---', onSelect: () => {} },
        {
          key: 'close-others',
          label: t('preview.closeOthers'),
          disabled: state.tabs.length <= 1,
          onSelect: () => requestClose(state.tabs.filter((item) => item.id !== tab.id).map((item) => item.id)),
        },
        {
          key: 'close-all',
          label: t('preview.closeAll'),
          onSelect: () => requestClose(state.tabs.map((item) => item.id)),
        },
      ],
    })
  }

  /** A fresh url tab (empty address; the viewer owns the input). */
  const newUrlTab = (): void => {
    const stamp = Date.now()
    const tab: PreviewTabState = {
      id: `url:${stamp}`,
      title: 'new tab',
      root: state.root,
      path: `url:${stamp}`,
      contentType: 'url',
      content: '',
      dirty: false,
      updated: false,
      loading: false,
      truncated: false,
      error: null,
      savedAt: Date.now(),
    }
    preview.update((prev) => ({ ...prev, open: true, tabs: [...prev.tabs, tab], activeTabId: tab.id }))
  }

  return (
    <div className={`aionui-root ${previewCss.panel}`}>
      <PreviewTabs
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSwitch={(id) => preview.switchTab(id)}
        onClose={(id) => requestClose([id])}
        onContextMenu={closeMenuFor}
        onNewUrlTab={newUrlTab}
        onClosePanel={() => preview.setOpen(false)}
        maximized={maximizedPreview}
        onMaximize={() => {
          stores.layout.update((prev) => ({ ...prev, maximized: maximizedPreview ? null : 'preview' }))
        }}
      />
      {activeTab !== null && (
        <>
          <PreviewToolbar
            contentType={activeTab.contentType}
            hasContent={activeTab.content !== null}
            loading={activeTab.loading}
            dirty={activeTab.dirty}
            updated={activeTab.updated}
            viewMode={viewMode}
            canToggleView={activeTab.contentType === 'markdown' || activeTab.contentType === 'html'}
            split={split}
            canSplit={isEditableType(activeTab.contentType) && activeTab.content !== null}
            onViewModeChange={setViewMode}
            onSplitChange={setSplit}
            onRefresh={() => void preview.reloadTab(activeTab.id)}
            onSave={() => void preview.saveTab(activeTab.id)}
            onDownload={() => downloadTab(activeTab)}
          />
          <TabContent
            tab={activeTab}
            viewMode={viewMode}
            split={split}
            onContentChange={(content) => preview.updateContent(activeTab.id, content)}
            onSave={() => void preview.saveTab(activeTab.id)}
          />
        </>
      )}
      {menu !== null && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {closingIds !== null && (
        <ConfirmDialog
          title={t('preview.closeConfirmTitle')}
          body={format(t('preview.closeConfirmBody'), { count: lastDirtyCheck.current.size })}
          confirmLabel={t('common.close')}
          danger
          onConfirm={() => {
            preview.closeTabs(closingIds)
            setClosingIds(null)
          }}
          onCancel={() => setClosingIds(null)}
        />
      )}
    </div>
  )
}
