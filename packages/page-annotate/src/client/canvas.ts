/**
 * Canvas compositing for the annotate stage: draws the captured page image
 * and every annotation (rectangle, arrow, text, number marker) onto a 2D
 * context. Browser-only module (needs CanvasRenderingContext2D).
 * @module @linxin666/dsh-page-annotate/client/canvas
 */

import { annotationToPixels, fontSizePixels, numberLabel, strokeToPixels, estimateTextWidth } from '../core/composite.ts'
import type { Annotation, PendingAnnotation } from '../core/annotate.ts'
import { clampUnitRect, normalizeRect } from '../core/annotate.ts'

/** Arrow head size relative to stroke width. */
const ARROW_HEAD = 3.2

/** Background opacity of text/number markers. */
const MARKER_BG_ALPHA = 0.72

/**
 * Draw the full composite: image + committed annotations + the in-progress
 * draft. `scale` maps CSS-px annotation strokes to canvas pixels.
 */
export function drawComposite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  annotations: readonly Annotation[],
  draft: PendingAnnotation | undefined,
  tool: string,
  color: string,
  strokeWidth: number,
  scale: number,
): void {
  ctx.clearRect(0, 0, imageWidth, imageHeight)
  ctx.drawImage(image, 0, 0, imageWidth, imageHeight)
  for (const annotation of annotations) {
    drawAnnotation(ctx, annotation, imageWidth, imageHeight, scale)
  }
  if (draft !== undefined) {
    const rect = clampUnitRect(normalizeRect(draft.x1, draft.y1, draft.x2, draft.y2))
    const pending: Annotation = {
      id: 'pending',
      kind: tool as Annotation['kind'],
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      color,
      strokeWidth,
    }
    drawAnnotation(ctx, pending, imageWidth, imageHeight, scale)
  }
}

/** Draw one annotation in pixel space. */
export function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation, imageWidth: number, imageHeight: number, scale: number): void {
  const rect = annotationToPixels(annotation, imageWidth, imageHeight)
  const stroke = strokeToPixels(annotation.strokeWidth, scale)
  ctx.save()
  switch (annotation.kind) {
    case 'rect': {
      ctx.strokeStyle = annotation.color
      ctx.lineWidth = stroke
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
      ctx.globalAlpha = 0.12
      ctx.fillStyle = annotation.color
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      break
    }
    case 'arrow': {
      drawArrow(ctx, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h, annotation.color, stroke)
      break
    }
    case 'text': {
      drawTextMarker(ctx, rect.x, rect.y, annotation.text ?? '', annotation.color, stroke, fontSizePixels(16, scale), scale)
      break
    }
    case 'number': {
      drawNumberMarker(ctx, rect.x, rect.y, annotation.number ?? 1, annotation.color, stroke, scale)
      break
    }
  }
  ctx.restore()
}

/** Draw an arrow from (x1,y1) to (x2,y2) with a filled head. */
export function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, stroke: number): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  if (length > 0) {
    const angle = Math.atan2(dy, dx)
    const size = Math.max(stroke * ARROW_HEAD, 8)
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  }
}

/** Draw a text marker: rounded background + label. */
export function drawTextMarker(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, stroke: number, fontSize: number, scale: number): void {
  ctx.font = `${fontSize}px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`
  const textWidth = Math.max(estimateTextWidth(text, fontSize), ctx.measureText(text).width)
  const pad = fontSize * 0.5
  const height = fontSize + pad * 2
  ctx.globalAlpha = MARKER_BG_ALPHA
  ctx.fillStyle = color
  roundRect(ctx, x - pad, y - height / 2, textWidth + pad * 2, height, height / 4)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

/** Draw a numbered circle marker. */
export function drawNumberMarker(ctx: CanvasRenderingContext2D, x: number, y: number, number: number, color: string, stroke: number, scale: number): void {
  const radius = Math.max(14, stroke * 4)
  ctx.globalAlpha = MARKER_BG_ALPHA
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(2, stroke / 2)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `${Math.max(12, radius * 0.9)}px -apple-system, 'PingFang SC', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(numberLabel(number), x, y + 1)
  ctx.textAlign = 'start'
}

/** Fill a rounded rectangle path (no fill/stroke; caller does it). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
