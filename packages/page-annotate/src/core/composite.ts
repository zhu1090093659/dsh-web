/**
 * Pure geometry helpers for compositing annotations onto a captured page.
 * The canvas drawing itself stays in the client (it needs a 2D context);
 * everything that can be reasoned about without one lives here.
 * @module @linxin666/dsh-page-annotate/core/composite
 */

import type { Annotation } from './annotate.ts'

/** A pixel-space rect for one annotation at a given export size. */
export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

/** Scale a normalized annotation rect to pixel coordinates. */
export function annotationToPixels(annotation: Annotation, pxWidth: number, pxHeight: number): PixelRect {
  return {
    x: annotation.x * pxWidth,
    y: annotation.y * pxHeight,
    w: annotation.w * pxWidth,
    h: annotation.h * pxHeight,
  }
}

/** The stroke width in pixels at a given export scale (1x = CSS px). */
export function strokeToPixels(strokeWidth: number, scale: number): number {
  return Math.max(1, strokeWidth * scale)
}

/** The font size in pixels for a label at the export scale. */
export function fontSizePixels(base: number, scale: number): number {
  return Math.max(8, base * scale)
}

/** Render a number marker label (`1`, `2`, … — capped at 99 for layout sanity). */
export function numberLabel(n: number): string {
  return String(Math.min(99, Math.max(1, Math.round(n))))
}

/** Estimate the pixel width of a text label (measure without a canvas). */
export function estimateTextWidth(text: string, fontSizePx: number): number {
  // A rough monospace-ish estimate: 0.62em average glyph width plus padding.
  return text.length * fontSizePx * 0.62 + fontSizePx
}
