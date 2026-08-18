import { describe, expect, it } from 'vitest'

import {
  BASE_PET_STAGE_HEIGHT,
  BASE_PET_STAGE_WIDTH,
  DRAWER_WIDTH,
  interactionPanelPlacement,
  petWindowContentSize,
} from './window-layout.ts'

describe('pet window layout', () => {
  it('keeps the hover settings panel footprint at the minimum supported scale', () => {
    expect(petWindowContentSize(1, false)).toEqual({
      width: BASE_PET_STAGE_WIDTH,
      height: BASE_PET_STAGE_HEIGHT,
    })
  })

  it('grows the stage for large pets and adds a fixed drawer width', () => {
    expect(petWindowContentSize(1.5, false)).toEqual({ width: 336, height: 450 })
    expect(petWindowContentSize(1.5, true)).toEqual({ width: 336 + DRAWER_WIDTH, height: 450 })
  })

  it('opens controls below near the top edge and above near the bottom edge', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(interactionPanelPlacement({ x: 1600, y: 0, width: 224, height: 300 }, workArea)).toBe('below')
    expect(interactionPanelPlacement({ x: 1600, y: 780, width: 224, height: 300 }, workArea)).toBe('above')
  })
})
