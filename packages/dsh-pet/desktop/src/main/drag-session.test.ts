import { describe, expect, it } from 'vitest'

import { createDragSession, cursorChanged, dragTargetAt } from './drag-session.ts'

describe('desktop drag session', () => {
  it('uses one immutable screen-space origin for the whole drag', () => {
    const session = createDragSession(
      { x: 1000, y: 700 },
      { x: 1500, y: 760, width: 224, height: 300 },
    )

    expect(dragTargetAt(session, { x: 970, y: 680 })).toEqual({
      moved: true,
      target: { x: 1470, y: 740 },
    })
    session.moved = true
    expect(dragTargetAt(session, { x: 940, y: 660 })).toEqual({
      moved: true,
      target: { x: 1440, y: 720 },
    })
  })

  it('does not turn a small click wobble into a drag', () => {
    const session = createDragSession(
      { x: 100, y: 100 },
      { x: 400, y: 500, width: 224, height: 300 },
    )

    expect(dragTargetAt(session, { x: 102, y: 102 })).toEqual({
      moved: false,
      target: { x: 400, y: 500 },
    })
  })

  it('ignores stationary feedback and one-pixel DPI jitter', () => {
    expect(cursorChanged({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
    expect(cursorChanged({ x: 100, y: 100 }, { x: 101, y: 100 })).toBe(false)
    expect(cursorChanged({ x: 100, y: 100 }, { x: 102, y: 100 })).toBe(true)
  })
})
