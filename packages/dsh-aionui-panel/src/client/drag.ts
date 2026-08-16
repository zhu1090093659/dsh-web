/**
 * Framework-free drag machinery shared by the React hook (useResizableSplit)
 * and the DOM layout controller: one pointer-down handler that owns capture,
 * the rAF-flush loop, the e.buttons === 0 fallback, every end path, and the
 * drag styles. Pure DOM — no React, so both callers run the exact same
 * smoothness core (AionUi's useResizableSplit architecture, re-implemented).
 * @module dsh-aionui-panel/client/drag
 */

export interface DragStartOptions {
  /** Drag left = grow (handle on the left edge of its container). */
  reverse: boolean
  /** Width at drag start (read at pointer-down time). */
  getStartWidth: () => number
  /** Clamped width from the raw delta (px mode adds deltaX directly). */
  compute: (startWidth: number, deltaX: number) => number
  /** Per-frame flush (rAF-merged; called at most once per frame). */
  onFrame: (width: number) => void
  /** Final commit (also fired on every end path). */
  onEnd: (width: number) => void
}

/** Whether a pointer event is the primary (left) button or touch. */
function isPrimaryPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch' || event.button === 0
}

/**
 * Handle one pointer-down: wire capture + window listeners, run the rAF
 * loop, and end on any of the five termination paths. Call from a
 * onPointerDown handler (React or plain DOM).
 * @param event - the raw pointerdown event.
 * @param el - the handle element (capture target + reverse marker source).
 * @param opts - drag behavior.
 * @returns a disposer (idempotent; also called internally on end).
 */
export function handlePointerDragStart(event: PointerEvent, el: HTMLElement, opts: DragStartOptions): () => void {
  if (!isPrimaryPointer(event)) return () => {}
  event.preventDefault()

  const startX = event.clientX
  const startWidth = opts.getStartWidth()
  const pointerId = event.pointerId
  const reverse = opts.reverse

  let rafId: number | null = null
  let pendingWidth: number | null = null
  let latestWidth = startWidth
  let isDragging = true
  let cleanup: (() => void) | null = null

  const flushPending = (): void => {
    if (pendingWidth === null) return
    latestWidth = pendingWidth
    opts.onFrame(pendingWidth)
  }

  const addWindowListener = <K extends keyof WindowEventMap>(
    key: K,
    handler: (e: WindowEventMap[K]) => void,
  ): (() => void) => {
    window.addEventListener(key, handler)
    return () => window.removeEventListener(key, handler)
  }

  const computeWidth = (clientX: number): number => {
    const deltaX = reverse ? startX - clientX : clientX - startX
    return opts.compute(startWidth, deltaX)
  }

  const finishDrag = (e?: PointerEvent | MouseEvent | FocusEvent): void => {
    if (!isDragging) return
    isDragging = false
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    flushPending()
    let finalWidth = latestWidth
    if (e !== undefined && 'clientX' in e && typeof e.clientX === 'number') {
      finalWidth = computeWidth(e.clientX)
    }
    opts.onEnd(finalWidth)
    cleanup?.()
  }

  const handlePointerMove = (e: PointerEvent): void => {
    if (!isDragging) return
    if (e.buttons === 0) {
      // Lost pointerup (capture steal / release outside): end now.
      finishDrag(e)
      return
    }
    pendingWidth = computeWidth(e.clientX)
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null
        flushPending()
      })
    }
  }
  const handlePointerUp = (e: PointerEvent): void => finishDrag(e)
  const handlePointerCancel = (e: PointerEvent): void => finishDrag(e)
  const handleMouseUp = (e: MouseEvent): void => finishDrag(e)
  const handleLostCapture = (): void => finishDrag()

  // Drag styles: no text selection, col-resize cursor, disable transitions.
  const previousUserSelect = document.body.style.userSelect
  const previousCursor = document.body.style.cursor
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  const frame = el.closest('[data-dsh-frame]')
  frame?.setAttribute('data-aionui-instant', '')
  // While a panel drag is in flight the columns must not swallow pointer
  // events (the preview column embeds iframes) — tokens.module.css keys off
  // this marker to make the columns pointer-transparent.
  frame?.setAttribute('data-aionui-dragging', '')

  const restore = (): void => {
    document.body.style.userSelect = previousUserSelect
    document.body.style.cursor = previousCursor
    frame?.removeAttribute('data-aionui-instant')
    frame?.removeAttribute('data-aionui-dragging')
  }

  if (el.setPointerCapture) {
    try {
      el.setPointerCapture(pointerId)
      el.addEventListener('lostpointercapture', handleLostCapture)
    } catch {
      // capture failed; the window listeners cover the drag
    }
  }

  const releaseCapture = (): void => {
    try {
      if (el.releasePointerCapture && el.hasPointerCapture?.(pointerId)) {
        el.releasePointerCapture(pointerId)
      }
    } catch {
      // already released
    }
    el.removeEventListener('lostpointercapture', handleLostCapture)
  }

  const listeners = [
    addWindowListener('pointermove', handlePointerMove),
    addWindowListener('pointerup', handlePointerUp),
    addWindowListener('pointercancel', handlePointerCancel),
    addWindowListener('mouseup', handleMouseUp),
    addWindowListener('blur', () => finishDrag()),
  ]
  cleanup = () => {
    restore()
    releaseCapture()
    for (const dispose of listeners) dispose()
  }
  return cleanup
}
