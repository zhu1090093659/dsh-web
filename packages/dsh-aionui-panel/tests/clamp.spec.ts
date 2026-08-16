/**
 * Width-clamp contract tests: the ordered explorer->preview clamps must keep
 * the chat area >= 360px whenever the frame is wide enough for the contract
 * floors (220 explorer + 340 preview + 24 chrome + 360 chat), exactly the
 * AionUi math the panel replicates.
 */
import { describe, expect, it } from 'vitest'
import {
  clampExplorerWidth, clampPreviewWidth,
  DEFAULT_WORKSPACE_PANEL_PX, DEFAULT_PREVIEW_REGION_PX,
  MAX_WORKSPACE_PANEL_PX, MAX_PREVIEW_REGION_PX,
  MIN_WORKSPACE_PANEL_PX, MIN_PREVIEW_PANEL_PX, MIN_CHAT_PANEL_PX,
  PREVIEW_REGION_CHROME_PX,
} from '../src/client/store.ts'
import { dragTargetWidth } from '../src/client/layout.ts'

/** Simulate the ordered clamp pair; returns chat width. */
function solve(requestedExplorer: number, requestedPreview: number, available: number, previewOpen: boolean): {
  explorer: number
  preview: number
  chat: number
} {
  const explorer = clampExplorerWidth(requestedExplorer, available, previewOpen)
  const preview = previewOpen ? clampPreviewWidth(requestedPreview, available, explorer) : 0
  return { explorer, preview, chat: available - explorer - preview }
}

describe('clampExplorerWidth', () => {
  it('keeps the requested width when the row fits (the layout clamp only shrinks)', () => {
    expect(clampExplorerWidth(260, 1400, false)).toBe(DEFAULT_WORKSPACE_PANEL_PX)
    // The drag engine guarantees 220..500; the layout clamp preserves any
    // requested value the row can host.
    expect(clampExplorerWidth(50, 1400, false)).toBe(50)
  })

  it('reserves chat + preview (min + chrome) when the preview is open', () => {
    const reserve = MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX + PREVIEW_REGION_CHROME_PX
    // A requested 500 cannot fit with preview open at available = 1000:
    // maxByContainer = 1000 - 724 = 276.
    expect(clampExplorerWidth(500, 1000, true)).toBe(276)
    expect(clampExplorerWidth(260, 1000, true)).toBe(260)
    // Narrow container: floor at the explorer minimum.
    expect(clampExplorerWidth(260, 500, true)).toBe(MIN_WORKSPACE_PANEL_PX)
    void reserve
  })
})

describe('clampPreviewWidth', () => {
  it('shrinks toward the chat reserve and respects the explorer width', () => {
    expect(clampPreviewWidth(480, 1400, 260)).toBe(480)
    // A 500px explorer leaves less room: maxByContainer = 1400-360-500-24,
    // and the requested 480 still fits inside it.
    expect(clampPreviewWidth(480, 1400, 500)).toBe(480)
    expect(clampPreviewWidth(800, 1400, 300)).toBe(1400 - MIN_CHAT_PANEL_PX - 300 - PREVIEW_REGION_CHROME_PX)
    // When the row is generous the full 1200 fits.
    expect(clampPreviewWidth(1200, 1844, 260)).toBe(MAX_PREVIEW_REGION_PX)
  })
})

describe('ordered clamp pair (chat >= 360)', () => {
  it('keeps chat at (or above) 360 when the requested widths fill the row', () => {
    const solved = solve(260, 480, 360 + 260 + 480 + PREVIEW_REGION_CHROME_PX, true)
    expect(solved.chat).toBeGreaterThanOrEqual(MIN_CHAT_PANEL_PX)
    expect(solved.explorer).toBe(260)
    expect(solved.preview).toBe(480)
  })

  it('never lets the pair exceed the available row (chat stays >= 360 when floors fit)', () => {
    for (const available of [1200, 1100, 1000, 944, 950, 1400, 1600]) {
      for (const explorer of [220, 260, 400, 500, 700]) {
        for (const preview of [340, 480, 800, 1200, 1500]) {
          const solved = solve(explorer, preview, available, true)
          expect(solved.preview).toBeGreaterThanOrEqual(MIN_PREVIEW_PANEL_PX)
          expect(solved.explorer).toBeGreaterThanOrEqual(0)
          // The guarantee holds whenever the floors fit (available >= 944).
          if (available >= 944) {
            expect(solved.chat).toBeGreaterThanOrEqual(MIN_CHAT_PANEL_PX)
          }
        }
      }
    }
  })

  it('gives the whole row to chat when the preview is closed', () => {
    const solved = solve(260, 480, 1000, false)
    expect(solved.explorer).toBe(260)
    expect(solved.preview).toBe(0)
    expect(solved.chat).toBe(740)
  })
})

describe('dragTargetWidth', () => {
  it('keeps the hard min/max bounds before the container clamp', () => {
    // Explorer drag bounded to 220..500 even when the container is generous.
    expect(dragTargetWidth('explorer', 260, -500, { availableWidth: 1400, previewOpen: false, explorerWidth: 260 })).toBe(MIN_WORKSPACE_PANEL_PX)
    expect(dragTargetWidth('explorer', 260, 1000, { availableWidth: 1400, previewOpen: false, explorerWidth: 260 })).toBe(MAX_WORKSPACE_PANEL_PX)
    // Preview drag bounded to 340..1200.
    expect(dragTargetWidth('preview', 480, -1000, { availableWidth: 1844, previewOpen: true, explorerWidth: 260 })).toBe(MIN_PREVIEW_PANEL_PX)
    expect(dragTargetWidth('preview', 480, 3000, { availableWidth: 1844, previewOpen: true, explorerWidth: 260 })).toBe(MAX_PREVIEW_REGION_PX)
  })

  it('caps the explorer drag below its hard max when the container is narrow', () => {
    // With preview open the explorer reserve leaves 276 room at available 1000,
    // so a drag toward MAX_WORKSPACE_PANEL_PX is re-bounded by clampExplorerWidth.
    const snapshot = { availableWidth: 1000, previewOpen: true, explorerWidth: 260 }
    const result = dragTargetWidth('explorer', 260, 300, snapshot)
    expect(result).toBeLessThan(MAX_WORKSPACE_PANEL_PX)
    expect(result).toBe(clampExplorerWidth(MAX_WORKSPACE_PANEL_PX, snapshot.availableWidth, snapshot.previewOpen))
  })

  it('caps the preview drag when the explorer + chat reserve eats the container', () => {
    // A 500px explorer leaves maxByContainer = 1400 - 360 - 500 - 24 = 516,
    // so the preview drag toward its hard max is re-bounded by clampPreviewWidth.
    const snapshot = { availableWidth: 1400, previewOpen: true, explorerWidth: 500 }
    const result = dragTargetWidth('preview', 480, 800, snapshot)
    expect(result).toBeLessThan(MAX_PREVIEW_REGION_PX)
    expect(result).toBe(clampPreviewWidth(1200, snapshot.availableWidth, snapshot.explorerWidth))
  })
})
