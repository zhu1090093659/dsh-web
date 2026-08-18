import { describe, expect, it } from 'vitest'

import { clampWindowPosition, nearestWorkArea, resizedContentBounds, type WorkArea } from './window-bounds.ts'

const displays: WorkArea[] = [
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: 1920, y: -120, width: 1280, height: 1024 },
]

describe('desktop window bounds', () => {
  it('keeps a valid saved position unchanged', () => {
    expect(clampWindowPosition({ x: 1600, y: 760 }, { width: 220, height: 240 }, displays))
      .toEqual({ x: 1600, y: 760 })
  })

  it('clamps a restored window after its display is removed', () => {
    expect(clampWindowPosition({ x: 2520, y: 700 }, { width: 220, height: 240 }, displays.slice(0, 1)))
      .toEqual({ x: 1700, y: 700 })
  })

  it('uses the nearest display for a window in a negative coordinate space', () => {
    expect(nearestWorkArea({ x: 2100, y: -80 }, displays)).toEqual(displays[1])
  })

  it('normalizes invalid coordinates without throwing', () => {
    expect(clampWindowPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { width: 220, height: 240 }, displays))
      .toEqual({ x: 0, y: 0 })
  })

  it('resizes content in one operation without moving its right edge', () => {
    const resized = resizedContentBounds(
      { x: 1674, y: 730, width: 228, height: 304 },
      { x: 1676, y: 732, width: 224, height: 300 },
      528,
      300,
      displays,
    )

    expect(resized).toEqual({ x: 1372, y: 732, width: 528, height: 300 })
    expect(resized.x + resized.width).toBe(1900)
  })
})
