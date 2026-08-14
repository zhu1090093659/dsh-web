/**
 * The floating round-jump surface component: renders nothing in the dock
 * while portaling the right-edge hover popup onto document.body. Reads the
 * conversation snapshot through the framework's injected `useSession`
 * selector; older history loads through the injected `loadOlder` verb.
 * @module @linxin666/dsh-round-jump/client/surface
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Right-edge hot zone width in px (the trigger column). */
const HOT_ZONE_PX = 16
/** Hover dwell before the popup opens, ms. */
const OPEN_DELAY_MS = 180
/** Text preview truncation length. */
const PREVIEW_MAX = 120
/** Load-all page ceiling (200 pages × 50 messages = 10k messages). */
const MAX_PAGES = 200

/** A user round entry: stable anchor key + one-line preview. */
export interface RoundEntry {
  key: string
  preview: string
}

/** The business verbs the apply body injects (beyond the framework kit). */
export interface RoundJumpInjected {
  /** One older-history page pull (scoped to the current session). */
  loadOlder: () => Promise<void>
}

/** Full composed props: the composer-dock runtime share + our injected verb. */
export type RoundJumpProps =
  PropsRuntime<'conversation.composer.dock'>
  & RoundJumpInjected
  & PropsLocale<'round-jump'>

function previewOf(node: ChatConversationViewNode): string {
  const content = (node.data as { content?: readonly { type?: string; text?: string }[] }).content
  const text = (content ?? [])
    .map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text
}

/** Collect user-round entries in chat order. */
export function roundsOf(
  order: readonly string[],
  nodes: { get(key: string): ChatConversationViewNode | undefined },
): RoundEntry[] {
  const rounds: RoundEntry[] = []
  for (const key of order) {
    const node = nodes.get(key)
    if (node !== undefined && node.kind === 'user') {
      rounds.push({ key, preview: previewOf(node) })
    }
  }
  return rounds
}

/**
 * The floating surface: an invisible dock anchor that portals the popup.
 * @param props - composed slot props (framework kit + injected verb).
 */
export function RoundJumpSurface(props: RoundJumpProps): ReactElement {
  const { useSession, loadOlder } = props
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const hasMore = useSession(s => s.hasMore)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const savedListTop = useRef(0)
  const suppressUntil = useRef(0)
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore

  const rounds = order === undefined ? [] : roundsOf(order, nodeStore)

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
  }, [])

  // Keep the round-list scroll position across close/reopen and re-renders:
  // record it on every list scroll, restore it whenever the list element is
  // (re)created (React re-renders on snapshot changes; the DOM node for the
  // list can be recreated when entries change, which would otherwise reset
  // the user's scroll to the top).
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    list.scrollTop = Math.min(savedListTop.current, list.scrollHeight)
  })

  const onListScroll = (): void => {
    const list = listRef.current
    if (list !== null) savedListTop.current = list.scrollTop
  }

  /** Close and briefly ignore the panel geometry so the pointer (still over
   *  the panel's spot) does not immediately reopen it. */
  const suppressReopen = (): void => {
    setOpen(false)
    suppressUntil.current = Date.now() + 400
  }

  const pointerInside = (x: number, y: number): boolean => {
    if (Date.now() < suppressUntil.current) return false
    if (x >= window.innerWidth - HOT_ZONE_PX) return true
    // The panel is pointer-events:none (so wheel/scroll pass through to the
    // conversation), so hit-test it geometrically instead of via
    // elementFromPoint.
    const panel = panelRef.current
    if (panel === null) return false
    const rect = panel.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      if (pointerInside(event.clientX, event.clientY)) {
        if (timer.current === undefined) {
          timer.current = window.setTimeout(() => {
            timer.current = undefined
            setOpen(true)
          }, OPEN_DELAY_MS)
        }
      } else {
        if (timer.current !== undefined) {
          window.clearTimeout(timer.current)
          timer.current = undefined
        }
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('keydown', onKey, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const loadAll = async (): Promise<void> => {
    if (loading) return
    setLoading(true)
    try {
      // hasMore is a snapshot from the render this closure was created in;
      // re-read the live value through a ref so the loop stops as soon as
      // history is exhausted instead of spinning the 200-page ceiling.
      for (let page = 0; page < MAX_PAGES; page++) {
        if (!hasMoreRef.current) break
        await loadOlder()
        // Give the prepend a frame to land before re-reading hasMore.
        await new Promise(resolve => window.setTimeout(resolve, 120))
      }
    } finally {
      setLoading(false)
    }
  }

  const jumpTo = (key: string): void => {
    const row = document.querySelector<HTMLElement>(`[data-chat-anchor-key="${key}"]`)
    if (row !== null) row.scrollIntoView({ behavior: 'smooth', block: 'start' })
    suppressReopen()
  }

  return createPortal(
    <div data-round-jump-popup="">
      <style>{`
        .rj-wrap { position: fixed; top: 0; right: 0; bottom: 0; width: 0; pointer-events: none; z-index: 2147483000; display: flex; align-items: center; justify-content: flex-end; }
        .rj-panel { pointer-events: none; flex: none; width: 280px; max-height: 70vh; margin-right: 8px; display: flex; flex-direction: column; background: #fff; border: 1px solid #d0d7de; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18); overflow: hidden; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; transform: translateX(calc(100% + 16px)); opacity: 0; transition: transform 160ms ease, opacity 160ms ease; }
        .rj-wrap.rj-open .rj-panel { transform: translateX(0); opacity: 1; }
        .rj-head { padding: 8px 12px; font-size: 12px; font-weight: 600; border-bottom: 1px solid #e4e7ec; display: flex; justify-content: space-between; align-items: center; }
        .rj-count { font-weight: 500; opacity: .65; }
        .rj-list { pointer-events: auto; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; gap: 2px; }
        .rj-item { pointer-events: auto; display: flex; gap: 8px; align-items: baseline; padding: 6px 8px; border-radius: 6px; cursor: pointer; border: none; background: transparent; text-align: left; color: inherit; font: inherit; }
        .rj-item:hover { background: rgba(79,143,247,.12); }
        .rj-num { flex: none; min-width: 22px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: #4f8ff7; }
        .rj-txt { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
        .rj-empty { padding: 14px 12px; text-align: center; opacity: .6; }
        .rj-toolbar { padding: 6px 8px; border-top: 1px solid #e4e7ec; display: flex; justify-content: center; }
        .rj-load-all { pointer-events: auto; width: 100%; padding: 6px 10px; border: 1px solid #d0d7de; border-radius: 6px; background: transparent; color: #4f8ff7; font: 600 12px system-ui, sans-serif; cursor: pointer; }
        .rj-load-all:hover:not(:disabled) { background: rgba(79,143,247,.1); }
        .rj-load-all:disabled { opacity: .6; cursor: wait; }
      `}</style>
      <div className={`rj-wrap${open ? ' rj-open' : ''}`}>
        <div ref={panelRef} className="rj-panel" role="dialog" aria-label="对话轮次跳转">
          <div className="rj-head">
            <span>跳转到我的消息</span>
            <span className="rj-count">{rounds.length > 0 ? `${rounds.length} 轮` : '0 轮'}</span>
          </div>
          <div ref={listRef} onScroll={onListScroll} className="rj-list">
            {rounds.length === 0
              ? <div className="rj-empty">当前会话还没有用户消息</div>
              : rounds.map((round, index) => (
                <button key={round.key} type="button" className="rj-item" onClick={() => jumpTo(round.key)}>
                  <span className="rj-num">{index + 1}</span>
                  <span className="rj-txt">{round.preview}</span>
                </button>
              ))}
          </div>
          <div className="rj-toolbar">
            <button type="button" className="rj-load-all" disabled={loading} onClick={() => void loadAll()}>
              {loading ? '加载中…' : '加载全部历史'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
