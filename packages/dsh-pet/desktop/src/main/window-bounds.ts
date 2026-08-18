import type { MoveTarget, WindowBounds } from '../shared/desktop-api.ts'

export interface WorkArea extends WindowBounds {}

export interface WindowSize {
  width: number
  height: number
}

/** Compute one atomic content-bounds update while keeping the content's right edge anchored. */
export function resizedContentBounds(
  outer: WindowBounds,
  content: WindowBounds,
  contentWidth: number,
  contentHeight: number,
  areas: readonly WorkArea[],
): WindowBounds {
  const leftInset = content.x - outer.x
  const topInset = content.y - outer.y
  const rightInset = outer.x + outer.width - content.x - content.width
  const bottomInset = outer.y + outer.height - content.y - content.height
  const outerSize = {
    width: contentWidth + leftInset + rightInset,
    height: contentHeight + topInset + bottomInset,
  }
  const requestedOuter = {
    x: content.x + content.width - contentWidth - leftInset,
    y: content.y - topInset,
  }
  const position = clampWindowPosition(requestedOuter, outerSize, areas)
  return {
    x: position.x + leftInset,
    y: position.y + topInset,
    width: contentWidth,
    height: contentHeight,
  }
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : fallback
}

function distanceToArea(point: MoveTarget, area: WorkArea): number {
  const maxX = area.x + area.width
  const maxY = area.y + area.height
  const dx = Math.max(area.x - point.x, 0, point.x - maxX)
  const dy = Math.max(area.y - point.y, 0, point.y - maxY)
  return dx * dx + dy * dy
}

export function nearestWorkArea(position: MoveTarget, areas: readonly WorkArea[]): WorkArea | undefined {
  return areas.reduce<WorkArea | undefined>((nearest, area) => {
    if (nearest === undefined) return area
    return distanceToArea(position, area) < distanceToArea(position, nearest) ? area : nearest
  }, undefined)
}

export function clampWindowPosition(
  position: MoveTarget,
  size: WindowSize,
  areas: readonly WorkArea[],
): MoveTarget {
  const fallbackArea = areas[0]
  if (fallbackArea === undefined) {
    return {
      x: finiteInteger(position.x, 0),
      y: finiteInteger(position.y, 0),
    }
  }

  const safePosition = {
    x: finiteInteger(position.x, fallbackArea.x),
    y: finiteInteger(position.y, fallbackArea.y),
  }
  const area = nearestWorkArea(
    {
      x: safePosition.x + size.width / 2,
      y: safePosition.y + size.height / 2,
    },
    areas,
  ) ?? fallbackArea
  const maxX = area.x + Math.max(0, area.width - size.width)
  const maxY = area.y + Math.max(0, area.height - size.height)

  return {
    x: Math.min(Math.max(safePosition.x, area.x), maxX),
    y: Math.min(Math.max(safePosition.y, area.y), maxY),
  }
}
