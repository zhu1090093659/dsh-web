/**
 * The Git graph panel: a read-only commit list with lane topology, ref
 * labels, and paging (git log --branches --tags --remotes --topo-order).
 * @module dsh-git-graph/client/graph/GraphDialog
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { computeLanes, type LaneGlyph } from '../../core/types.ts'
import type { GraphView } from '../../core/types.ts'
import type { GitGraphKey } from '../locales.ts'
import { Backdrop, cx } from '../chips/Chip.tsx'
import css from '../chips/context.module.css'

/** Initial page size of the graph fetch. */
const INITIAL_LIMIT = 200
/** Page size of one "load more" step. */
const PAGE_STEP = 100

/** Lane glyph → the rendered monospace character. */
function glyphChar(glyph: LaneGlyph): string {
  switch (glyph) {
    case 'node': return '●'
    case 'merge': return '◆'
    case 'pass': return '│'
    case 'gap': return ' '
  }
}

/** Seconds per time bucket (relative timestamps). */
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * A compact relative timestamp (GitHub-style): "just now", "5 分钟前",
 * falling back to a plain date past 30 days.
 * @param epochSeconds - commit author time in seconds.
 * @param t - the dictionary.
 * @returns the display string.
 */
function formatTime(epochSeconds: number, t: Translate<GitGraphKey>): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds)
  if (elapsed < MINUTE) return t('graph.time.justNow')
  if (elapsed < HOUR) return t('graph.time.minutesAgo', { count: Math.floor(elapsed / MINUTE) })
  if (elapsed < DAY) return t('graph.time.hoursAgo', { count: Math.floor(elapsed / HOUR) })
  if (elapsed < 30 * DAY) return t('graph.time.daysAgo', { count: Math.floor(elapsed / DAY) })
  const date = new Date(epochSeconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Props of the Git graph dialog. */
export interface GraphDialogProps {
  /** The graph verb (host-side read-only log). */
  graph: (limit?: number) => Promise<GraphView | null>
  onClose: () => void
  t: Translate<GitGraphKey>
}

/**
 * The Git graph panel.
 * @param props - see {@link GraphDialogProps}.
 */
export function GraphDialog({ graph, onClose, t }: GraphDialogProps) {
  const [view, setView] = useState<GraphView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Out-of-order guard: two rapid loads (load-more while a fetch is in
  // flight) must never let the older, smaller page overwrite the newer one.
  const requestSeq = useRef(0)
  const load = useCallback((limit: number): void => {
    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setLoading(true)
    void graph(limit).then((next) => {
      if (seq !== requestSeq.current) return
      setView(next)
      setError(next === null ? t('error.internal') : null)
    }).catch(() => {
      if (seq !== requestSeq.current) return
      setError(t('error.internal'))
    }).finally(() => {
      if (seq === requestSeq.current) setLoading(false)
    })
  }, [graph, t])

  // Initial load exactly once on mount. The parent passes a fresh inline
  // `graph` arrow on every BranchChip render, which changes `load`'s identity
  // and would re-run the initial fetch (resetting any loaded pages) if it
  // were a dependency — so read the latest `load` through a ref instead.
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => { loadRef.current(INITIAL_LIMIT) }, [])

  const lanes = useMemo(() => {
    if (view === null) return []
    return computeLanes(view.commits)
  }, [view])

  const laneCount = useMemo(() => {
    let count = 0
    for (const row of lanes) count = Math.max(count, row.columns.length)
    return count
  }, [lanes])

  return (
    <>
      <Backdrop onClose={onClose} />
      <div className={css.dialog} role="dialog" aria-label={t('graph.title')} data-gitgraph-dialog data-dsh-plugin="git-graph" data-dsh-part="dialog">
        <div className={css.dialogHeader}>
          <div className={css.dialogHeading}>
            <h3 className={css.dialogTitle}>{t('graph.title')}</h3>
            <div className={css.graphSubtitle}>
              {t('graph.subtitle', {
                count: view === null ? 0 : view.commits.length,
                lanes: laneCount,
              })}
            </div>
          </div>
          <button
            type="button"
            className={css.dialogClose}
            onClick={onClose}
            aria-label={t('graph.close')}
          >
            <IconCloseOutline16 size={16} />
          </button>
        </div>
        <div className={css.graphBody}>
          {loading && view === null
            ? <div className={css.graphEmpty}>{t('graph.loading')}</div>
            : error !== null
              ? <div className={css.graphEmpty}>{error}</div>
              : view === null || view.commits.length === 0
                ? <div className={css.graphEmpty}>{t('graph.empty')}</div>
                : view.commits.map((commit, index) => {
                  const row = lanes[index]
                  if (row === undefined) return null
                  return (
                    <div className={css.graphRow} key={commit.oid}>
                      <span className={css.graphLanes} aria-hidden="true" data-gitgraph-lanes>
                        {row.columns.map((glyph, column) => (
                          <span
                            key={column}
                            data-gitgraph-glyph={glyph}
                            className={cx(
                              css.graphLaneCell,
                              glyph === 'node' && css.graphLaneNode,
                              glyph === 'merge' && css.graphLaneMerge,
                              glyph === 'pass' && css.graphLanePass,
                            )}
                          >
                            {glyphChar(glyph)}
                          </span>
                        ))}
                      </span>
                      <span className={css.graphOid} title={commit.oid}>{commit.oid.slice(0, 7)}</span>
                      <span className={css.graphMain}>
                        <span className={css.graphSubject} title={commit.subject}>{commit.subject}</span>
                        <span className={css.graphMeta}>
                          {commit.refs.map(ref => (
                            <span
                              key={ref}
                              title={ref}
                              data-gitgraph-ref
                              data-gitgraph-ref-current={ref === view.branch || undefined}
                              className={cx(css.graphRef, ref === view.branch && css.graphRefCurrent)}
                            >
                              {ref}
                            </span>
                          ))}
                          <span>{commit.author}</span>
                          <span className={css.graphMetaSep}>·</span>
                          <span>{formatTime(commit.authorTime, t)}</span>
                        </span>
                      </span>
                    </div>
                  )
                })}
        </div>
        {view !== null && view.hasMore && (
          <button
            type="button"
            className={css.graphMore}
            onClick={() => { load(view.commits.length + PAGE_STEP) }}
          >
            {t('graph.loadMore')}
          </button>
        )}
      </div>
    </>
  )
}
