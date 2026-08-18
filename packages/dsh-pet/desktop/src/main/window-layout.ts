import type { InteractionPanelPlacement, WindowBounds } from '../shared/desktop-api.ts'
import type { WindowSize } from './window-bounds.ts'

export const BASE_PET_STAGE_WIDTH = 224
export const BASE_PET_STAGE_HEIGHT = 300
export const DRAWER_WIDTH = 304

/** Put controls on the side with more useful room while the pet hugs an edge. */
export function interactionPanelPlacement(
  bounds: WindowBounds,
  workArea: WindowBounds,
): InteractionPanelPlacement {
  const windowCenter = bounds.y + bounds.height / 2
  const displayCenter = workArea.y + workArea.height / 2
  return windowCenter <= displayCenter ? 'below' : 'above'
}

/** Content size for the current pet scale. The settings panel keeps its base footprint at smaller scales. */
export function petWindowContentSize(scale: number, drawerOpen: boolean): WindowSize {
  const stageWidth = Math.max(BASE_PET_STAGE_WIDTH, Math.round(BASE_PET_STAGE_WIDTH * scale))
  const height = Math.max(BASE_PET_STAGE_HEIGHT, Math.round(BASE_PET_STAGE_HEIGHT * scale))
  return {
    width: stageWidth + (drawerOpen ? DRAWER_WIDTH : 0),
    height,
  }
}
