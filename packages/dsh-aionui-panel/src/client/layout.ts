/**
 * The DOM layout controller: extends the web shell's three-column frame
 * (`[data-dsh-frame]`, a grid) with two trailing grid tracks — the preview
 * region and the explorer column — by mirroring the shell's own inline
 * grid-template-columns string and re-appending the two panel tracks on every
 * shell update (MutationObserver, same frame before paint). Also owns the
 * absolute drag handles (12px explorer / 20px preview hit zones), the
 * floating expand button, and the collapse-as-width-0 keep-mounted behavior.
 *
 * The shell's inline style is the source of truth for the sidebar and details
 * tracks; this controller never guesses their widths. Handles are out-of-flow
 * (absolute), so appending tracks never disturbs the shell's own children.
 *
 * AionUi Layout architecture (Apache-2.0, re-implemented): the explorer
 * column collapses to width 0 while staying mounted; the preview region keeps
 * a 1px left border only (no outer margins — gaps would expose the window
 * background, jarring in dark mode).
 * @module dsh-aionui-panel/client/layout
 */

import { handlePointerDragStart } from './drag.ts'
import {
  DEFAULT_PREVIEW_REGION_PX, DEFAULT_WORKSPACE_PANEL_PX,
  MAX_PREVIEW_REGION_PX, MAX_WORKSPACE_PANEL_PX,
  MIN_PREVIEW_PANEL_PX, MIN_WORKSPACE_PANEL_PX,
  KEY_EXPLORER_WIDTH, KEY_PREVIEW_WIDTH,
  clampExplorerWidth, clampPreviewWidth,
} from './store.ts'
import { writeStoredNumber } from './persist.ts'
import type { LayoutStore } from './store.ts'

/** The frame grid element (portals target it). */
let frameElement: HTMLElement | null = null

/** Read the current frame element (undefined while the shell is not mounted). */
export function getFrameElement(): HTMLElement | null {
  return frameElement
}

/**
 * Locate the frame grid element the two panel columns append into. The web-ui
 * aggregate's compat shim stamps `data-dsh-frame` onto the grid, but a
 * STANDALONE install of this package has no shim (the attribute never
 * appears), so the panel would wait forever and never mount (issue #56). Fall
 * back to the rc.6-native structure: the frame grid is the parent of the
 * sidebar column, exactly the element the shim would stamp.
 */
function findFrame(): HTMLElement | null {
  const stamped = document.querySelector<HTMLElement>('[data-dsh-frame]')
  if (stamped !== null) return stamped
  return document.querySelector<HTMLElement>('[class*="sidebarCol"]')?.parentElement ?? null
}

/**
 * Parse an inline grid-template-columns string into its tracks. Handles
 * "minmax(0, 1fr)" (spaces inside parens must not split). Empty on failure.
 */
export function parseGridTracks(input: string): string[] {
  const tracks: string[] = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ' ' && depth === 0) {
      if (current !== '') {
        tracks.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current !== '') tracks.push(current)
  return tracks
}

/** Extract a px width from one track (0 for fr/minmax/non-px tracks). */
export function trackPx(track: string): number {
  const match = /^(-?[\d.]+)px$/.exec(track.trim())
  return match === null ? 0 : Number(match[1])
}

/** One drag handle's geometry (hit zone + visual line) — pure CSS in the module. */
export const EXPLORER_HANDLE_WIDTH = 12
export const PREVIEW_HANDLE_WIDTH = 20

/** The layout controller: frame sync, handles, floating button, width math. */
export class PanelLayoutController {
  private frame: HTMLElement | null = null
  private previewCol: HTMLDivElement | null = null
  private explorerCol: HTMLDivElement | null = null
  private explorerHandle: HTMLDivElement | null = null
  private previewHandle: HTMLDivElement | null = null
  private floatingButton: HTMLButtonElement | null = null
  private styleObserver: MutationObserver | null = null
  private sizeObserver: ResizeObserver | null = null
  private waitObserver: MutationObserver | null = null
  private frameWidth = 0
  /** The shell's own 3 tracks (sidebar, center, details) — mirror of its inline style. */
  private shellTracks: string[] = []
  private instantTimer: ReturnType<typeof setTimeout> | undefined
  private disposers: Array<() => void> = []

  constructor(private readonly layout: LayoutStore) {}

  /** Start watching for the frame and attach once it appears. */
  mount(): void {
    const tryAttach = (): void => {
      if (this.frame !== null) return
      const frame = findFrame()
      if (frame === null) return
      this.attach(frame)
    }
    this.waitObserver = new MutationObserver(() => { tryAttach() })
    this.waitObserver.observe(document.body, { childList: true, subtree: true })
    tryAttach()
  }

  /** Attach to the frame: columns, handles, observers, store subscription. */
  private attach(frame: HTMLElement): void {
    this.frame = frame
    frameElement = frame

    // The two panel columns: trailing grid items (tracks 4 and 5).
    const previewCol = document.createElement('div')
    previewCol.dataset.aionuiPreviewCol = ''
    previewCol.className = 'aionui-preview-col'
    previewCol.style.minWidth = '0'
    previewCol.style.overflow = 'hidden'
    previewCol.style.display = 'flex'
    previewCol.style.flexDirection = 'column'
    previewCol.style.borderLeft = '1px solid var(--aion-bg-3, #e5e6eb)'

    const explorerCol = document.createElement('div')
    explorerCol.dataset.aionuiExplorerCol = ''
    explorerCol.className = 'aionui-explorer-col'
    explorerCol.style.minWidth = '0'
    explorerCol.style.overflow = 'hidden'
    explorerCol.style.display = 'flex'
    explorerCol.style.flexDirection = 'column'
    explorerCol.style.borderLeft = '1px solid var(--aion-bg-3, #e5e6eb)'

    frame.appendChild(previewCol)
    frame.appendChild(explorerCol)
    this.previewCol = previewCol
    this.explorerCol = explorerCol

    // The absolute drag handles (out of the grid flow). Both sit on the left
    // edge of their panel: dragging left widens (reverse).
    this.explorerHandle = this.createHandle('aionui-explorer-handle', EXPLORER_HANDLE_WIDTH, true, 'explorer')
    this.previewHandle = this.createHandle('aionui-preview-handle', PREVIEW_HANDLE_WIDTH, true, 'preview')
    frame.appendChild(this.explorerHandle)
    frame.appendChild(this.previewHandle)

    // The floating expand button (fixed, right edge) — DOM-level, no React.
    this.floatingButton = document.createElement('button')
    this.floatingButton.type = 'button'
    this.floatingButton.className = 'aionui-floating-expand'
    this.floatingButton.setAttribute('aria-label', 'Expand explorer')
    this.floatingButton.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'
    this.floatingButton.addEventListener('click', () => { this.toggleExplorer() })
    document.body.appendChild(this.floatingButton)

    // Sync the shell's inline grid: any shell write re-appends our tracks.
    const syncGrid = (): void => {
      const el = this.frame
      if (el === null) return
      const inline = el.style.gridTemplateColumns
      if (inline === '') return
      const tracks = parseGridTracks(inline)
      if (tracks.length >= 2 && tracks.length <= 3) {
        // The shell's own write (3 tracks) — remember it and re-append ours.
        this.shellTracks = tracks
        this.applyGrid()
        return
      }
      if (tracks.length === 5 && this.shellTracks.length === 3) {
        // Our own write — keep it (the shell tracks are already mirrored).
        return
      }
    }
    this.styleObserver = new MutationObserver(syncGrid)
    this.styleObserver.observe(frame, { attributes: true, attributeFilter: ['style'] })

    // Measure the row width: frame minus the shell's sidebar + details tracks.
    const measure = (): void => {
      if (this.frame === null) return
      this.frameWidth = this.frame.getBoundingClientRect().width
      const sidebar = this.shellTracks.length >= 1 ? trackPx(this.shellTracks[0]) : 0
      const details = this.shellTracks.length >= 3 ? trackPx(this.shellTracks[2]) : 0
      const available = Math.max(0, this.frameWidth - sidebar - details)
      const state = this.layout.getSnapshot()
      if (Math.abs(state.availableWidth - available) > 0.5) {
        this.layout.update((prev) => ({ ...prev, availableWidth: available }))
      }
      this.layout.shrinkToFit(this.layout.getSnapshot())
    }
    this.sizeObserver = new ResizeObserver(() => {
      measure()
      this.applyGrid()
    })
    this.sizeObserver.observe(frame)

    // Store -> DOM: grid, handles, floating button.
    this.disposers.push(this.layout.subscribe(() => this.applyGrid()))

    // Initial sync: read the shell's inline style (it is already applied).
    const initial = frame.style.gridTemplateColumns
    if (initial !== '') {
      const tracks = parseGridTracks(initial)
      if (tracks.length >= 2 && tracks.length <= 3) {
        this.shellTracks = tracks
      } else if (tracks.length === 5 && trackPx(tracks[0]) > 0) {
        // The frame may already carry our own previous 5-track write: the
        // plugin hot-reloads in place (client HMR re-materializes the fiber),
        // and the shell's grid is then the first three tracks. A zero-width
        // first track is never a shell write (the shell collapses to the 56px
        // rail, drags clamp at 280px) — treat it as untrusted and wait for
        // the next shell write instead of mirroring the damage.
        this.shellTracks = tracks.slice(0, 3)
      }
    }
    measure()
    this.applyGrid()
  }

  /** Create one drag handle element with its pointer wiring. */
  private createHandle(
    className: string,
    hitWidth: number,
    reverse: boolean,
    kind: 'explorer' | 'preview',
  ): HTMLDivElement {
    const el = document.createElement('div')
    el.className = className
    el.style.position = 'absolute'
    el.style.top = '0'
    el.style.bottom = '0'
    el.style.zIndex = '30'
    el.style.cursor = 'col-resize'
    el.style.width = `${hitWidth}px`
    if (reverse) {
      // The preview handle extends LEFT of the preview region's left edge.
      el.style.marginLeft = `-${hitWidth}px`
    }
    el.addEventListener('pointerdown', (event: PointerEvent) => {
      const isExplorer = kind === 'explorer'
      handlePointerDragStart(event, el, {
        reverse,
        getStartWidth: () => {
          const state = this.layout.getSnapshot()
          return isExplorer ? state.explorerWidth : state.previewWidth
        },
        compute: (startWidth, deltaX) => {
          if (isExplorer) {
            return Math.min(MAX_WORKSPACE_PANEL_PX, Math.max(MIN_WORKSPACE_PANEL_PX, startWidth + deltaX))
          }
          return Math.min(MAX_PREVIEW_REGION_PX, Math.max(MIN_PREVIEW_PANEL_PX, startWidth + deltaX))
        },
        onFrame: (width) => {
          // layout.update notifies the subscribers (subscribe -> applyGrid),
          // so no explicit applyGrid here — double-writing every frame.
          this.layout.update((prev) => (
            isExplorer ? { ...prev, explorerWidth: width } : { ...prev, previewWidth: width }
          ))
        },
        onEnd: (width) => {
          writeStoredNumber(isExplorer ? KEY_EXPLORER_WIDTH : KEY_PREVIEW_WIDTH, width)
        },
      })
    })
    // Double-click resets THIS panel to its default width (instant, like
    // every panel width change — the shell's grid transition must not lag).
    el.addEventListener('dblclick', () => {
      this.instant(() => {
        const width = kind === 'explorer' ? DEFAULT_WORKSPACE_PANEL_PX : DEFAULT_PREVIEW_REGION_PX
        this.layout.update((prev) => (
          kind === 'explorer' ? { ...prev, explorerWidth: width } : { ...prev, previewWidth: width }
        ))
        writeStoredNumber(kind === 'explorer' ? KEY_EXPLORER_WIDTH : KEY_PREVIEW_WIDTH, width)
        this.applyGrid()
      })
    })
    // The visual line is drawn by CSS (::after) — the hit zone is transparent.
    return el
  }

  /** Toggle explorer collapse (width 0, kept mounted; no transition). */
  toggleExplorer(): void {
    const state = this.layout.getSnapshot()
    const next = !state.explorerCollapsed
    this.instant(() => {
      this.layout.update((prev) => ({ ...prev, explorerCollapsed: next }))
      try {
        localStorage.setItem(`project-panel-collapse:${state.root}`, next ? 'collapsed' : 'expanded')
      } catch {
        // best-effort
      }
      this.applyGrid()
    })
  }

  /** Toggle the preview region (open = tabs exist; close keeps tabs). */
  setPreviewOpen(open: boolean): void {
    this.instant(() => {
      this.layout.update((prev) => ({ ...prev, previewOpen: open }))
      this.applyGrid()
    })
  }

  /** Apply one store update with transitions disabled for exactly one frame. */
  private instant(fn: () => void): void {
    const frame = this.frame
    if (frame === null) {
      fn()
      return
    }
    frame.setAttribute('data-aionui-instant', '')
    if (this.instantTimer !== undefined) clearTimeout(this.instantTimer)
    this.instantTimer = setTimeout(() => {
      this.instantTimer = undefined
      frame.removeAttribute('data-aionui-instant')
    }, 0)
    fn()
  }

  /** Re-write the frame grid and reposition handles + floating button. */
  private applyGrid(): void {
    const frame = this.frame
    if (frame === null) return
    // Never guess the shell tracks: without a mirrored shell write, the old
    // fallback zeroed the sidebar track (the bug where the left sidebar
    // vanished after a hot reload). Skip the write until syncGrid observes
    // the shell's own 3-track grid.
    if (this.shellTracks.length !== 3) return
    const state = this.layout.getSnapshot()
    const explorer = this.layout.explorerWidthPx(state)
    const preview = this.layout.previewWidthPx(state)

    // Five tracks: shell sidebar, center, shell details, preview, explorer.
    frame.style.gridTemplateColumns =
      `${this.shellTracks[0]} minmax(0, 1fr) ${this.shellTracks[2]} ${Math.round(preview)}px ${Math.round(explorer)}px`

    // Column contents follow the tracks (both columns always mounted).
    if (this.explorerCol !== null) {
      this.explorerCol.style.visibility = explorer > 0 ? 'visible' : 'hidden'
    }
    if (this.previewCol !== null) {
      this.previewCol.style.visibility = preview > 0 ? 'visible' : 'hidden'
    }

    // Handles: at the left edge of each panel.
    const width = this.frameWidth > 0 ? this.frameWidth : frame.getBoundingClientRect().width
    if (this.explorerHandle !== null) {
      const left = Math.round(width - explorer)
      this.explorerHandle.style.left = `${left}px`
      this.explorerHandle.style.marginLeft = `${-EXPLORER_HANDLE_WIDTH / 2}px`
      this.explorerHandle.style.display = explorer > 0 && state.root !== '' ? 'block' : 'none'
    }
    if (this.previewHandle !== null) {
      const left = Math.round(width - explorer - preview)
      this.previewHandle.style.left = `${left}px`
      this.previewHandle.style.display = preview > 0 && state.root !== '' ? 'block' : 'none'
    }

    // Floating expand button: visible only when the explorer is collapsed.
    if (this.floatingButton !== null) {
      const show = state.root !== '' && state.explorerCollapsed
      this.floatingButton.style.display = show ? 'flex' : 'none'
    }
  }

  /** Detach everything (plugin unload). */
  dispose(): void {
    this.waitObserver?.disconnect()
    this.styleObserver?.disconnect()
    this.sizeObserver?.disconnect()
    for (const dispose of this.disposers) dispose()
    this.previewCol?.remove()
    this.explorerCol?.remove()
    this.explorerHandle?.remove()
    this.previewHandle?.remove()
    this.floatingButton?.remove()
    if (this.instantTimer !== undefined) clearTimeout(this.instantTimer)
    if (frameElement === this.frame) frameElement = null
    this.frame = null
  }
}
