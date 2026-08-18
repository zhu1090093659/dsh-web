import type { MoveTarget, WindowBounds } from '../shared/desktop-api.ts'

export interface DragSession {
  cursor: MoveTarget
  lastCursor: MoveTarget
  window: WindowBounds
  moved: boolean
}

export interface DragUpdate {
  moved: boolean
  target: MoveTarget
}

export function createDragSession(cursor: MoveTarget, window: WindowBounds): DragSession {
  return {
    cursor: { ...cursor },
    lastCursor: { ...cursor },
    window: { ...window },
    moved: false,
  }
}

/** Ignore stationary/window-induced pointer churn and sub-pixel DPI jitter. */
export function cursorChanged(previous: MoveTarget, current: MoveTarget, threshold = 1.5): boolean {
  return Math.hypot(current.x - previous.x, current.y - previous.y) >= threshold
}

export function dragTargetAt(
  session: DragSession,
  cursor: MoveTarget,
  threshold = 4,
): DragUpdate {
  const deltaX = cursor.x - session.cursor.x
  const deltaY = cursor.y - session.cursor.y
  const moved = session.moved || Math.hypot(deltaX, deltaY) >= threshold
  return {
    moved,
    target: moved
      ? { x: session.window.x + deltaX, y: session.window.y + deltaY }
      : { x: session.window.x, y: session.window.y },
  }
}
