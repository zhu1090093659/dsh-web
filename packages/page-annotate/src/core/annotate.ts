/**
 * Annotation model for the page-annotate panel. Pure state machine: shapes
 * are stored normalized (0..1 relative to the captured image) so they stay
 * valid across canvas resizes and export DPR scaling. No DOM, no canvas.
 * @module @linxin666/dsh-page-annotate/core/annotate
 */

/** The four annotation shapes the toolbar offers. */
export type ShapeKind = 'rect' | 'arrow' | 'text' | 'number'

/** One committed annotation. Coordinates are normalized 0..1 of the image. */
export interface Annotation {
  id: string
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  color: string
  /** Stroke width in CSS pixels at 1x scale (scaled with the export factor). */
  strokeWidth: number
  /** Text payload for `kind === 'text'`. */
  text?: string
  /** Auto-incremented label for `kind === 'number'`. */
  number?: number
}

/** A shape under construction (dragging) before it commits. */
export interface PendingAnnotation {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Normalize two drag points into a rect (any drag direction). */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    // Round to 1e-6 so normalized drags survive deep equality (0.8 - 0.2).
    w: Math.round(Math.abs(x2 - x1) * 1e6) / 1e6,
    h: Math.round(Math.abs(y2 - y1) * 1e6) / 1e6,
  }
}

/** Clamp a normalized rect into the 0..1 unit square. */
export function clampUnitRect(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const x = Math.min(1, Math.max(0, rect.x))
  const y = Math.min(1, Math.max(0, rect.y))
  const w = Math.min(1 - x, Math.max(0, rect.w))
  const h = Math.min(1 - y, Math.max(0, rect.h))
  return { x, y, w, h }
}

let idCounter = 0

/** Mint a monotonic annotation id. */
export function nextAnnotationId(): string {
  idCounter += 1
  return 'a' + idCounter.toString(36) + '-' + Date.now().toString(36)
}

/** A draft of the annotation under construction. */
export interface DraftAnnotation {
  kind: ShapeKind
  color: string
  strokeWidth: number
  rect: { x: number; y: number; w: number; h: number }
  text?: string
  number?: number
}

/** The annotation store surface the React panel binds to. */
export interface AnnotationStore {
  getSnapshot(): readonly Annotation[]
  subscribe(listener: () => void): () => void
  add(draft: DraftAnnotation): string
  remove(id: string): void
  undo(): void
  clear(): void
  getNextNumber(): number
}

/** Create a bounded undo-capable annotation store. */
export function createAnnotationStore(capacity = 50): AnnotationStore {
  const listeners = new Set<() => void>()
  const undoStack: Array<readonly Annotation[]> = []
  let items: readonly Annotation[] = []
  let nextNumber = 1
  const emit = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    add(draft) {
      const annotation: Annotation = {
        id: nextAnnotationId(),
        kind: draft.kind,
        x: draft.rect.x,
        y: draft.rect.y,
        w: draft.rect.w,
        h: draft.rect.h,
        color: draft.color,
        strokeWidth: draft.strokeWidth,
        text: draft.text,
        number: draft.kind === 'number' ? nextNumber : undefined,
      }
      if (annotation.kind === 'number') nextNumber += 1
      undoStack.push(items)
      if (undoStack.length > capacity) undoStack.shift()
      items = [...items, annotation]
      emit()
      return annotation.id
    },
    remove(id) {
      const target = items.find((item) => item.id === id)
      if (target === undefined) return
      undoStack.push(items)
      items = items.filter((item) => item.id !== id)
      emit()
    },
    undo() {
      const previous = undoStack.pop()
      if (previous === undefined) return
      items = previous
      emit()
    },
    clear() {
      if (items.length === 0) return
      undoStack.push(items)
      items = []
      emit()
    },
    getNextNumber: () => nextNumber,
  }
}

/** Whether a click at normalized (x, y) hits an annotation's rect (for erase). */
export function hitTest(annotations: readonly Annotation[], x: number, y: number, padding = 0.01): string | undefined {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const a = annotations[i]
    const px = padding / 2
    if (x >= a.x - px && x <= a.x + a.w + px && y >= a.y - px && y <= a.y + a.h + px) return a.id
  }
  return undefined
}
