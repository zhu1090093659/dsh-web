import type { MoveTarget, WindowBounds } from '../shared/desktop-api.ts'

const CLICK_SLOP = 2

/** Resolve the exact final window position even when native drag startup is asynchronous. */
export function pointerDragTarget(
  start: MoveTarget,
  end: MoveTarget,
  bounds: WindowBounds,
): MoveTarget | undefined {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  if (Math.abs(deltaX) <= CLICK_SLOP && Math.abs(deltaY) <= CLICK_SLOP) return undefined
  return { x: bounds.x + deltaX, y: bounds.y + deltaY }
}
