/**
 * The panel system's single drag engine hook — a thin React wrapper over the
 * framework-free machinery in drag.ts (AionUi's useResizableSplit
 * architecture, re-implemented): px or ratio units, range-validated
 * localStorage persistence, double-click reset to the default width.
 * @module dsh-aionui-panel/client/hooks/useResizableSplit
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { handlePointerDragStart } from '../drag.ts'
import { readStoredNumber, writeStoredNumber } from '../persist.ts'

export interface UseResizableSplitOptions {
  /** Default width (px or percent). */
  defaultWidth?: number
  /** Minimum (same unit). */
  minWidth?: number
  /** Maximum (same unit). */
  maxWidth?: number
  /** localStorage key (preference persistence). */
  storageKey?: string
  /** 'px' for fixed pixel widths, 'ratio' for percents (default 'ratio'). */
  unit?: 'px' | 'ratio'
}

export interface DragHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}

/**
 * Convert a drag's pixel delta into the next width in ratio (percentage) mode.
 * The raw deltaX is pixels; a percentage width must scale that delta by the
 * container width, otherwise a 30px drag moves a 50% width straight to the
 * 80% maximum instead of ~4%.
 */
export function ratioWidthFromDelta(startWidth: number, deltaX: number, containerWidth: number): number {
  if (containerWidth <= 0) return startWidth
  return startWidth + (deltaX / containerWidth) * 100
}

/**
 * Resizable-split engine.
 * @param options - width contract + persistence key.
 * @returns current width, the committed setter, handle props, and the clamp.
 */
export function useResizableSplit(options: UseResizableSplitOptions = {}) {
  const {
    defaultWidth = 50,
    minWidth = 20,
    maxWidth = 80,
    storageKey,
    unit = 'ratio',
  } = options
  const isPx = unit === 'px'

  const [width, setWidthState] = useState(() =>
    storageKey === undefined
      ? defaultWidth
      : readStoredNumber(storageKey, minWidth, maxWidth, defaultWidth))

  // The pointer-down closure reads the width at drag START without rebinding.
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])

  /** The committed setter: state + storage (validated) + resize event. */
  const setWidth = useCallback((value: number) => {
    setWidthState(value)
    if (storageKey !== undefined) writeStoredNumber(storageKey, value)
    try {
      window.dispatchEvent(new CustomEvent('preview-panel-resize', { detail: { width: value } }))
    } catch {
      // event dispatch is best-effort
    }
  }, [storageKey])

  const clamp = useCallback((value: number): number => {
    return Math.min(maxWidth, Math.max(minWidth, value))
  }, [minWidth, maxWidth])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const el = event.currentTarget as HTMLDivElement
    handlePointerDragStart(event.nativeEvent, el, {
      reverse: el.dataset.reverse === 'true',
      getStartWidth: () => widthRef.current,
      compute: (startWidth, deltaX) => {
        if (isPx) return clamp(startWidth + deltaX)
        // ratio mode: deltaX is a pixel delta, startWidth is a percentage.
        // Scale the pixel delta by the split container width (the handle is
        // its direct child) so the pane tracks the pointer instead of jumping
        // to the min/max clamp on a small drag.
        const containerWidth = el.parentElement?.clientWidth ?? 0
        return clamp(ratioWidthFromDelta(startWidth, deltaX, containerWidth))
      },
      onFrame: (value) => setWidthState(value),
      onEnd: (value) => setWidth(value),
    })
  }, [clamp, setWidth, isPx])

  const handleDoubleClick = useCallback(() => {
    setWidth(defaultWidth)
  }, [defaultWidth, setWidth])

  const handleProps: DragHandleProps = { onPointerDown: handlePointerDown, onDoubleClick: handleDoubleClick }

  return { width, setWidth, handleProps, clamp, isPx }
}
