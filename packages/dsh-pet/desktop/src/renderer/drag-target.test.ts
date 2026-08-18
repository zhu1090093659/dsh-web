import { describe, expect, it } from 'vitest'
import { pointerDragTarget } from './drag-target.ts'

describe('pointerDragTarget', () => {
  const bounds = { x: 1_740, y: 876, width: 528, height: 304 }

  it('keeps a stationary pointer classified as a click', () => {
    expect(pointerDragTarget({ x: 400, y: 200 }, { x: 400, y: 200 }, bounds)).toBeUndefined()
    expect(pointerDragTarget({ x: 400, y: 200 }, { x: 402, y: 198 }, bounds)).toBeUndefined()
  })

  it('uses the complete pointer delta for a short drag', () => {
    expect(pointerDragTarget({ x: 400, y: 200 }, { x: 300, y: 120 }, bounds)).toEqual({
      x: 1_640,
      y: 796,
    })
  })
})
