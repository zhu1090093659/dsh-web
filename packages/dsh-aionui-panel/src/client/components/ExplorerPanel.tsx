/**
 * The Explorer column: Files/Changes tab bar (37px), the persistent filename
 * search at the top of the Files tab (150ms debounced; a hit click REVEALS
 * the file in the tree — expand ancestors + select — never opens preview),
 * the lazy file tree (34px rows, full-row expand/collapse, 16px icons), and
 * the in-column collapse chevron.
 *
 * AionUi Explorer behavior (Apache-2.0, re-implemented): row click toggles
 * folders (no need to hit the arrow), search results are reveal-only, and
 * clicking a file opens it in the preview panel (dedup focuses the tab).
 * @module dsh-aionui-panel/client/components/ExplorerPanel
 */

import { memo, useEffect, useRef, useState } from 'react'
import type { DragEvent, JSX, MouseEvent } from 'react'
import { IconCheckOutline16, IconCopyOutline16, IconLinkOutline16, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FsEntry } from '../../core/types.ts'
import { absolutePathOf, parentRel } from '../fileType.ts'
import { t } from '../locales.ts'
import { useStore } from '../hooks/useStore.ts'
import type { PanelStores } from '../store.ts'
import { FileTypeIcon } from './FileIcon.tsx'
import { ChevronRightIcon, CloseIcon, ExpandRightIcon, SearchIcon } from './icons.tsx'
import { ScmPanel } from './ScmPanel.tsx'
import { activateOnKey } from './a11y.ts'
import { FILE_DRAG_MIME } from '../drag/file-drag.ts'
import explorerCss from '../styles/explorer.module.css'
import '../styles/tokens.module.css'

/** Row indent step per tree depth (px). */
const INDENT_STEP = 16

/**
 * The whole explorer column content.
 * @param stores - the panel store bundle.
 * @param onToggleCollapse - collapse the column (host chrome).
 */
export function ExplorerPanel({
  stores,
  onToggleCollapse,
}: {
  stores: PanelStores
  onToggleCollapse: () => void
}): JSX.Element {
  const state = useStore(stores.explorer)
  const [searchFocus, setSearchFocus] = useState(false)

  return (
    <div className="aionui-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* The Files/Changes tab bar. */}
      <div className={explorerCss.tabBar}>
        <button
          type="button"
          className={state.activeTab === 'files' ? explorerCss.tabBtnActive : explorerCss.tabBtn}
          onClick={() => stores.explorer.setActiveTab('files')}
        >
          {t('explorer.tabs.files')}
        </button>
        <button
          type="button"
          className={state.activeTab === 'changes' ? explorerCss.tabBtnActive : explorerCss.tabBtn}
          onClick={() => stores.explorer.setActiveTab('changes')}
        >
          {t('explorer.tabs.changes')}
        </button>
        <button
          type="button"
          className="aionui-collapse-chevron"
          style={{ marginLeft: 'auto' }}
          onClick={onToggleCollapse}
          title={t('explorer.collapse')}
          aria-label={t('explorer.collapse')}
        >
          <ExpandRightIcon size={16} />
        </button>
      </div>

      {/* Files tab: search + tree (kept mounted; hidden when changes is active). */}
      <div style={{ display: state.activeTab === 'files' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <SearchArea
          stores={stores}
          searchFocus={searchFocus}
          onFocusChange={setSearchFocus}
        />
        <FileTree stores={stores} />
      </div>

      {/* Changes tab: SCM (mounted on demand; its store outlives the tab). */}
      {state.activeTab === 'changes' && <ScmPanel stores={stores} />}
    </div>
  )
}

/** The search box + results (the tree stays mounted underneath). */
function SearchArea({
  stores,
  searchFocus,
  onFocusChange,
}: {
  stores: PanelStores
  searchFocus: boolean
  onFocusChange: (focused: boolean) => void
}): JSX.Element {
  const explorer = stores.explorer
  const state = useStore(explorer)
  const search = state.search
  const active = search.query !== ''
  const inputRef = useRef<HTMLInputElement>(null)

  const placeholder = search.mode === 'content'
    ? t('explorer.search.contentPlaceholder')
    : t('explorer.search.placeholder')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: active ? 1 : undefined }}>
      <div className={explorerCss.searchArea}>
        <div className={explorerCss.searchModes}>
          <button
            type="button"
            className={search.mode === 'name' ? explorerCss.searchModeActive : explorerCss.searchMode}
            onClick={() => explorer.setSearchMode('name')}
          >
            {t('explorer.search.modeName')}
          </button>
          <button
            type="button"
            className={search.mode === 'content' ? explorerCss.searchModeActive : explorerCss.searchMode}
            onClick={() => explorer.setSearchMode('content')}
          >
            {t('explorer.search.modeContent')}
          </button>
        </div>
        <div
          className={`${explorerCss.searchBox}${searchFocus ? ` ${explorerCss.searchAreaFocus}` : ''}`}
          style={{ borderColor: searchFocus ? 'var(--aion-primary)' : undefined }}
        >
          <span className={explorerCss.searchIcon}><SearchIcon size={14} /></span>
          <input
            ref={inputRef}
            className={explorerCss.searchInput}
            value={search.query}
            placeholder={placeholder}
            aria-label={placeholder}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            onChange={(event) => explorer.setSearchQuery(event.target.value)}
          />
          {search.query !== '' && (
            <button
              type="button"
              className={explorerCss.searchClear}
              onClick={() => { explorer.cancelSearch(); inputRef.current?.focus() }}
              aria-label={t('common.close')}
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Result list replaces the tree while the query is active (the tree
          underneath stays mounted — subscriptions never thrash). */}
      {active ? (
        <SearchResults stores={stores} />
      ) : null}
    </div>
  )
}

/** The search-result stream: flat rows for filename mode, file+line groups for content mode. */
function SearchResults({ stores }: { stores: PanelStores }): JSX.Element {
  const explorer = stores.explorer
  const state = useStore(explorer)
  const search = state.search
  const contentMode = search.mode === 'content'
  const resultCount = contentMode ? search.contentHits.length : search.hits.length
  const searching = search.status === 'searching' && resultCount === 0
  const empty = search.status === 'done' && resultCount === 0

  if (contentMode) {
    return (
      <div className={explorerCss.scrollArea}>
        {searching && <div className={explorerCss.searchStatus}>{t('explorer.search.searching')}</div>}
        {search.status === 'error' && <div className={explorerCss.searchStatus}>{t('explorer.search.error')}</div>}
        {empty && <div className={explorerCss.searchStatus}>{t('explorer.search.contentEmpty')}</div>}
        {search.contentHits.map((hit) => {
          const open = (): void => {
            explorer.select(hit.path)
            stores.preview.openFile(state.root, hit.path)
          }
          return (
            <div key={hit.path} className={explorerCss.contentResult}>
              <div
                className={explorerCss.contentResultHead}
                role="button"
                tabIndex={0}
                title={hit.path}
                onClick={open}
                onKeyDown={activateOnKey(open)}
              >
                <FileTypeIcon name={hit.name} isDir={false} expanded={false} />
                <span className={explorerCss.resultName}>{hit.name}</span>
                <span className={explorerCss.resultPath}>{parentRel(hit.path)}</span>
                <span className={explorerCss.resultMeta}>{hit.matches.length}</span>
              </div>
              {hit.matches.map((match) => (
                <div
                  key={match.line}
                  className={explorerCss.contentMatch}
                  role="button"
                  tabIndex={0}
                  title={hit.path}
                  onClick={open}
                  onKeyDown={activateOnKey(open)}
                >
                  <span className={explorerCss.contentLine}>{match.line}</span>
                  <span className={explorerCss.contentSnippet}>{match.text}</span>
                </div>
              ))}
            </div>
          )
        })}
        {search.truncated && resultCount > 0 && (
          <div className={explorerCss.searchStatus}>{t('explorer.search.contentTruncated', { count: resultCount })}</div>
        )}
      </div>
    )
  }

  return (
    <div className={explorerCss.scrollArea}>
      {searching && <div className={explorerCss.searchStatus}>{t('explorer.search.searching')}</div>}
      {search.status === 'error' && <div className={explorerCss.searchStatus}>{t('explorer.search.error')}</div>}
      {empty && <div className={explorerCss.searchStatus}>{t('explorer.search.empty')}</div>}
      {search.hits.map((hit) => (
        <div
          key={hit.path}
          className={explorerCss.resultRow}
          role="button"
          tabIndex={0}
          title={hit.path}
          onClick={() => {
            // Reveal: expand the ancestor chain and select — not preview.
            explorer.reveal(hit.path)
          }}
          onKeyDown={activateOnKey(() => { explorer.reveal(hit.path) })}
        >
          <FileTypeIcon name={hit.name} isDir={hit.isDir} expanded={false} />
          <span className={explorerCss.resultName}>{hit.name}</span>
          <span className={explorerCss.resultPath}>{parentRel(hit.path)}</span>
        </div>
      ))}
      {search.truncated && search.hits.length > 0 && (
        <div className={explorerCss.searchStatus}>{t('explorer.search.truncated', { count: search.hits.length })}</div>
      )}
    </div>
  )
}

/** The lazy file tree. */
function FileTree({ stores }: { stores: PanelStores }): JSX.Element {
  const explorer = stores.explorer
  const preview = stores.preview
  const state = useStore(explorer)
  const root = state.root

  if (root === '') return <div className={explorerCss.emptyState}>{t('explorer.tree.empty')}</div>
  const entries = state.dirs['']
  if (entries === undefined) {
    return <div className={explorerCss.searchStatus}>{t('scm.loading')}</div>
  }
  if (entries.length === 0) return <div className={explorerCss.emptyState}>{t('explorer.tree.empty')}</div>

  return (
    <div className={`${explorerCss.scrollArea} ${explorerCss.tree}`}>
      {entries.map((entry) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          depth={0}
          expanded={state.expanded}
          selected={state.selected}
          dirs={state.dirs}
          root={state.root}
          stores={stores}
        />
      ))}
    </div>
  )
}

/** One tree row (recursive for children). */
function TreeRowBase({
  entry,
  depth,
  expanded,
  selected,
  dirs,
  root,
  stores,
}: {
  entry: FsEntry
  depth: number
  expanded: string[]
  selected: string | null
  dirs: Record<string, FsEntry[]>
  root: string
  stores: PanelStores
}): JSX.Element {
  const explorer = stores.explorer
  const preview = stores.preview
  const isExpanded = expanded.includes(entry.path)
  const isSelected = selected === entry.path
  const children = entry.isDir ? dirs[entry.path] : undefined
  const [draggingRow, setDraggingRow] = useState(false)
  // Which copy action is showing the success state: relative or absolute.
  const [copied, setCopied] = useState<'rel' | 'abs' | null>(null)
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
  }, [])

  const handleClick = (): void => {
    if (entry.isDir) {
      // Full-row expand/collapse toggle.
      explorer.toggleDir(entry.path)
      return
    }
    // A file: select + open in preview (dedup focuses the open tab).
    explorer.select(entry.path)
    preview.openFile(root, entry.path)
  }

  // Copy the workspace-relative path (same value drag&drop inserts) or the
  // host absolute path (root + relative, separator following the root).
  const handleCopyPath = async (kind: 'rel' | 'abs'): Promise<void> => {
    const text = kind === 'rel' ? entry.path : absolutePathOf(root, entry.path)
    const ok = await writeClipboard(text)
    if (!ok) return
    setCopied(kind)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(null), 1200)
  }
  const onCopyClick = (kind: 'rel' | 'abs') => (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    void handleCopyPath(kind)
  }

  // Files are draggable into the composer (the drag MIME carries the
  // workspace-relative path); directory rows stay click-only.
  const onDragStart = (event: DragEvent): void => {
    if (entry.isDir) return
    event.dataTransfer.setData(FILE_DRAG_MIME, entry.path)
    event.dataTransfer.setData('text/plain', entry.path)
    event.dataTransfer.effectAllowed = 'copy'
    setDraggingRow(true)
  }
  const onDragEnd = (): void => {
    setDraggingRow(false)
  }

  return (
    <>
      <div
        className={`${explorerCss.treeRow}${isSelected ? ` ${explorerCss.treeRowSelected}` : ''}${draggingRow ? ` ${explorerCss.treeRowDragging}` : ''}`}
        style={{ paddingLeft: 12 + 8 + depth * INDENT_STEP }}
        draggable={!entry.isDir}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div
          className={explorerCss.treeRowMain}
          onClick={handleClick}
          onKeyDown={activateOnKey(handleClick)}
          onDoubleClick={(event) => {
            // Double-click on a file: same as click (open). Folders: keep toggle.
            event.stopPropagation()
          }}
          role="button"
          tabIndex={0}
          aria-expanded={entry.isDir ? isExpanded : undefined}
          title={entry.path}
        >
          {entry.isDir ? (
            <span className={`${explorerCss.treeArrow}${isExpanded ? ` ${explorerCss.treeArrowOpen}` : ''}`}>
              <ChevronRightIcon size={13} />
            </span>
          ) : (
            <span className={explorerCss.treeArrowEmpty} />
          )}
          <FileTypeIcon name={entry.name} isDir={entry.isDir} expanded={isExpanded} />
          <span className={explorerCss.treeName}>{entry.name}</span>
        </div>
        <div className={explorerCss.treeActions}>
          <button
            type="button"
            className={`${explorerCss.treeCopy}${copied === 'rel' ? ` ${explorerCss.treeCopyCopied}` : ''}`}
            title={copied === 'rel' ? t('common.copied') : t('explorer.copyCurrentPath')}
            aria-label={t('explorer.copyCurrentPath')}
            onClick={onCopyClick('rel')}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {copied === 'rel' ? <IconCheckOutline16 size={13} /> : <IconCopyOutline16 size={13} />}
          </button>
          <button
            type="button"
            className={`${explorerCss.treeCopy}${copied === 'abs' ? ` ${explorerCss.treeCopyCopied}` : ''}`}
            title={copied === 'abs' ? t('common.copied') : t('explorer.copyGlobalPath')}
            aria-label={t('explorer.copyGlobalPath')}
            onClick={onCopyClick('abs')}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {copied === 'abs' ? <IconCheckOutline16 size={13} /> : <IconLinkOutline16 size={13} />}
          </button>
        </div>
      </div>
      {entry.isDir && isExpanded && children !== undefined && (
        <div>
          {children.map((child) => (
            <TreeRow
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              dirs={dirs}
              root={root}
              stores={stores}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * A memoized tree row so the whole tree does not re-render on every explorer
 * state change (search keystrokes, tab switches, fs version bumps). The row
 * takes the `state` fields it actually reads as individual props — `expanded`,
 * `selected`, `dirs` — whose references only change when the corresponding
 * data changed, so the default shallow comparison skips rows whose own entry,
 * ancestor, expansion or selection are unaffected. A `dirs` re-fetch (an fs
 * event that relists the expanded dirs) still re-renders the rows under those
 * dirs — the unavoidable O(open-dirs) cost — but transient UI state no longer
 * invalidates the tree.
 */
const TreeRow = memo(TreeRowBase)
