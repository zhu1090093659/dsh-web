/**
 * Screenshot planning: the one place that turns a screenshot request into
 * `Page.captureScreenshot` parameters and the pixel size the encoded image will
 * have.
 *
 * Two things are decided here rather than at the call site. The format decides
 * the media type the attachment service is asked to store, and a clip with a
 * scale turns one capture into a cropped render, so both the tool result and the
 * attachment metadata come from the same plan instead of being re-derived from
 * each other.
 *
 * The limits are hard because every pixel is encoded, base64-encoded again, and
 * pushed through the protocol: a full-viewport capture at scale 3 is 9.2 million
 * pixels of JPEG on a socket, and a caller that asked for it by accident would
 * stall the host rather than produce a screenshot anyone can read. The output
 * budget matches the attachment service's own downscale threshold, so a plan
 * that passes here never gets silently resized afterwards.
 *
 * @module @linxin666/dsh-client-ui-browser-view/core/screenshot
 */

/** Encoded image formats this package requests from CDP. */
export type ScreenshotFormat = 'png' | 'jpeg'

/** A rectangular crop in CSS pixels, relative to the viewport origin. */
export interface ScreenshotClip {
  /** Left edge in CSS pixels. */
  x: number
  /** Top edge in CSS pixels. */
  y: number
  /** Crop width in CSS pixels. */
  width: number
  /** Crop height in CSS pixels. */
  height: number
}

/** The tool-level screenshot request, before any planning. */
export interface ScreenshotRequest {
  /** Encoded format. @default 'png' */
  format?: ScreenshotFormat
  /** Crop to this rectangle instead of the whole viewport. */
  clip?: ScreenshotClip
  /**
   * Device pixels per CSS pixel. Defaults to 1 without a clip and to 2 with one,
   * because a cropped capture is a detail view.
   */
  scale?: number
}

/** CDP `Page.captureScreenshot` parameters; the only place this package builds them. */
export interface CdpScreenshotParams {
  /** Encoded format. */
  format: ScreenshotFormat
  /** JPEG quality, 0-100; CDP ignores it for PNG. */
  quality?: number
  /** Always false: capture only what the pinned viewport shows. */
  captureBeyondViewport: false
  /** Optional crop plus the scale it renders at. */
  clip?: { x: number; y: number; width: number; height: number; scale: number }
}

/** Everything the caller and the attachment need to know about one capture. */
export interface ScreenshotPlan {
  /** Parameters to hand to `Page.captureScreenshot`. */
  params: CdpScreenshotParams
  /** Media type of the encoded bytes. */
  mediaType: 'image/png' | 'image/jpeg'
  /** Encoded width in device pixels: the viewport or clip width times the scale. */
  width: number
  /** Encoded height in device pixels: the viewport or clip height times the scale. */
  height: number
  /** Scale the capture renders at. */
  scale: number
}

/** Matches the attachment service's `normalizedImageMaxPixels`: 2048*2048. */
export const SCREENSHOT_MAX_OUTPUT_PIXELS = 2048 * 2048

/** Largest scale a request may ask for. */
export const SCREENSHOT_MAX_SCALE = 3

/** Longest encoded side CDP renders in one capture. */
const SCREENSHOT_MAX_SIDE = 8192

/** Scale a clip-only request renders at: a crop is a detail view. */
const DEFAULT_CLIP_SCALE = 2

/**
 * Describe one requested rectangle for an error message.
 * @param clip - the rectangle as the caller asked for it.
 * @returns a compact `width x height at x,y` reading.
 */
function describeClip(clip: ScreenshotClip): string {
  return `${clip.width}x${clip.height} at (${clip.x}, ${clip.y})`
}

/**
 * Reject a format outside png/jpeg.
 *
 * The tool schema already constrains this; a second guard here is what keeps a
 * caller that reaches the core directly from asking CDP for an unknown encoder
 * and receiving an opaque protocol error.
 * @param format - the requested format.
 * @throws when the format is neither `png` nor `jpeg`.
 */
function assertFormat(format: ScreenshotFormat): void {
  if (format !== 'png' && format !== 'jpeg') {
    throw new Error(`screenshot format must be "png" or "jpeg"; received ${String(format)}`)
  }
}

/**
 * Reject a scale outside the allowed range.
 * @param scale - the requested scale.
 * @throws when the scale is not a whole number from 1 to {@link SCREENSHOT_MAX_SCALE}.
 */
function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 1 || scale > SCREENSHOT_MAX_SCALE) {
    throw new Error(`screenshot scale must be an integer from 1 to ${SCREENSHOT_MAX_SCALE}; received ${scale}`)
  }
}

/**
 * Reject a clip CDP could not honour.
 *
 * Fractional edges make the encoded size disagree with the reported size, a
 * zero or negative extent has no pixels, and a negative origin addresses
 * something outside the page.
 * @param clip - the requested rectangle.
 * @throws when any edge is fractional, the origin is negative, or an extent is below one pixel.
 */
function assertClip(clip: ScreenshotClip): void {
  const edges = [clip.x, clip.y, clip.width, clip.height]
  if (!edges.every(edge => Number.isInteger(edge))) {
    throw new Error(`screenshot clip must use whole pixels; received ${describeClip(clip)}`)
  }
  if (clip.x < 0 || clip.y < 0) {
    throw new Error(`screenshot clip must not start outside the viewport; received ${describeClip(clip)}`)
  }
  if (clip.width < 1 || clip.height < 1) {
    throw new Error(`screenshot clip must be at least 1x1 pixel; received ${describeClip(clip)}`)
  }
}

/**
 * Reject a clip that reaches past the viewport.
 *
 * Reporting the real viewport is what lets the caller correct the rectangle
 * without a second round-trip to find out how large the page actually is.
 * @param clip - the requested rectangle.
 * @param viewport - the viewport the capture renders.
 * @throws when the clip crosses the right or bottom edge.
 */
function assertInside(clip: ScreenshotClip, viewport: { width: number; height: number }): void {
  if (clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height) {
    throw new Error(
      `screenshot clip must stay inside the ${viewport.width}x${viewport.height} viewport; received ${describeClip(clip)}`,
    )
  }
}

/**
 * Reject a capture whose encoded size would be unusable.
 * @param width - base width in CSS pixels, before scaling.
 * @param height - base height in CSS pixels, before scaling.
 * @param scale - scale the capture renders at.
 * @throws when a side exceeds {@link SCREENSHOT_MAX_SIDE} or the total exceeds {@link SCREENSHOT_MAX_OUTPUT_PIXELS}.
 */
function assertOutputSize(width: number, height: number, scale: number): void {
  const encodedWidth = width * scale
  const encodedHeight = height * scale
  if (encodedWidth > SCREENSHOT_MAX_SIDE || encodedHeight > SCREENSHOT_MAX_SIDE) {
    throw new Error(
      `a ${width}x${height} screenshot at scale ${scale} would be ${encodedWidth}x${encodedHeight} pixels, over the ${SCREENSHOT_MAX_SIDE}-pixel side limit; lower the scale or shrink the clip`,
    )
  }
  const pixels = encodedWidth * encodedHeight
  if (pixels > SCREENSHOT_MAX_OUTPUT_PIXELS) {
    throw new Error(
      `a ${width}x${height} screenshot at scale ${scale} would be ${pixels} pixels, over the ${SCREENSHOT_MAX_OUTPUT_PIXELS}-pixel output limit; lower the scale or shrink the clip`,
    )
  }
}

/**
 * Plan one screenshot capture.
 *
 * Pure: the same three arguments always produce the same plan, and nothing here
 * reads configuration, the clock, or the environment.
 * @param viewport - the CSS-pixel viewport the page is pinned to.
 * @param request - what the caller asked for; every field is optional.
 * @param jpegQuality - quality to request for a JPEG capture, 0-100.
 * @returns the CDP parameters, the media type, and the encoded pixel size.
 * @throws when the format, scale, clip, or resulting size cannot be honoured.
 */
export function planScreenshot(
  viewport: { width: number; height: number },
  request: ScreenshotRequest,
  jpegQuality: number,
): ScreenshotPlan {
  const format: ScreenshotFormat = request.format ?? 'png'
  assertFormat(format)

  const clip = request.clip
  if (clip !== undefined) assertClip(clip)
  if (request.scale !== undefined) assertScale(request.scale)
  const scale = request.scale ?? (clip === undefined ? 1 : DEFAULT_CLIP_SCALE)

  const width = clip === undefined ? viewport.width : clip.width
  const height = clip === undefined ? viewport.height : clip.height
  if (clip !== undefined) assertInside(clip, viewport)
  assertOutputSize(width, height, scale)

  const params: CdpScreenshotParams = { format, captureBeyondViewport: false }
  if (format === 'jpeg') params.quality = jpegQuality
  if (clip !== undefined) {
    params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale }
  } else if (scale > 1) {
    // A whole-viewport zoom is the same thing as a clip over the whole viewport,
    // and CDP only accepts a scale as part of a clip.
    params.clip = { x: 0, y: 0, width: viewport.width, height: viewport.height, scale }
  }

  return {
    params,
    mediaType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: width * scale,
    height: height * scale,
    scale,
  }
}
