/**
 * Screenshot planning tests: what one request turns into, and which requests
 * are refused before anything reaches the browser. Every case is a pure
 * function call, so there is no transport, no clock, and no browser here.
 */

import { describe, expect, it } from 'vitest'
import {
  SCREENSHOT_MAX_OUTPUT_PIXELS,
  SCREENSHOT_MAX_SCALE,
  planScreenshot,
  type ScreenshotFormat,
} from '../../src/core/screenshot.ts'

/** The viewport the service pins: 1280x800 CSS pixels. */
const VIEWPORT = { width: 1280, height: 800 }

/** The quality the service passes through for JPEG captures. */
const JPEG_QUALITY = 70

describe('format', () => {
  it('operator omits the format and the plan captures PNG without a quality field', () => {
    // Given a request that names no format
    // When the plan is built
    // Then the parameters ask for PNG, carry no quality, and report the PNG media type
    const plan = planScreenshot(VIEWPORT, {}, JPEG_QUALITY)
    expect(plan.params).toEqual({ format: 'png', captureBeyondViewport: false })
    expect(plan.mediaType).toBe('image/png')
  })

  it('operator asks for JPEG and the plan carries the configured quality and media type', () => {
    // Given a request for a JPEG
    // When the plan is built with quality 70
    // Then the parameters carry that quality and the plan reports the JPEG media type
    const plan = planScreenshot(VIEWPORT, { format: 'jpeg' }, JPEG_QUALITY)
    expect(plan.params).toEqual({ format: 'jpeg', quality: 70, captureBeyondViewport: false })
    expect(plan.mediaType).toBe('image/jpeg')
  })

  it('operator asks for a format the tool schema would have rejected and the plan refuses it', () => {
    // Given a request naming an unsupported encoder
    // When the plan is built
    // Then it throws naming the two accepted formats
    expect(() => planScreenshot(VIEWPORT, { format: 'webp' as unknown as ScreenshotFormat }, JPEG_QUALITY))
      .toThrow(/screenshot format must be "png" or "jpeg"; received webp/)
  })
})

describe('viewport-only capture', () => {
  it('operator asks for nothing beyond a capture and the plan keeps the historical whole-viewport call', () => {
    // Given a request with neither a clip nor a scale
    // When the plan is built
    // Then the parameters carry no clip at all and the encoded size is the viewport at scale 1
    const plan = planScreenshot(VIEWPORT, {}, JPEG_QUALITY)
    expect('clip' in plan.params).toBe(false)
    expect(plan.scale).toBe(1)
    expect(plan.width).toBe(1280)
    expect(plan.height).toBe(800)
  })

  it('operator asks for a scale with no clip and the plan zooms the whole viewport', () => {
    // Given a 640x400 viewport and a request for scale 3 with no clip
    // When the plan is built
    // Then a clip covering that viewport is synthesized at that scale and the encoded size is 3x the viewport
    const plan = planScreenshot({ width: 640, height: 400 }, { scale: 3 }, JPEG_QUALITY)
    expect(plan.params.clip).toEqual({ x: 0, y: 0, width: 640, height: 400, scale: 3 })
    expect(plan.width).toBe(1920)
    expect(plan.height).toBe(1200)
  })
})

describe('clip capture', () => {
  it('operator asks for a clip with no scale and it renders at scale 2', () => {
    // Given a clip request that names no scale
    // When the plan is built
    // Then the clip is forwarded at scale 2 and the encoded size is twice the clip
    const plan = planScreenshot(VIEWPORT, { clip: { x: 10, y: 20, width: 300, height: 200 } }, JPEG_QUALITY)
    expect(plan.params.clip).toEqual({ x: 10, y: 20, width: 300, height: 200, scale: 2 })
    expect(plan.scale).toBe(2)
    expect(plan.width).toBe(600)
    expect(plan.height).toBe(400)
  })

  it('operator asks for a clip and an explicit scale and both are forwarded as asked', () => {
    // Given a clip request that names scale 1
    // When the plan is built
    // Then the clip is forwarded at exactly that scale and no zoom is applied
    const plan = planScreenshot(VIEWPORT, { clip: { x: 0, y: 0, width: 100, height: 50 }, scale: 1 }, JPEG_QUALITY)
    expect(plan.params.clip).toEqual({ x: 0, y: 0, width: 100, height: 50, scale: 1 })
    expect(plan.width).toBe(100)
    expect(plan.height).toBe(50)
  })
})

describe('refused requests', () => {
  it('operator asks for a scale outside 1 to 3 and the plan names the accepted range', () => {
    // Given requests for scale 0, 2.5 and 4
    // When each plan is built
    // Then every one throws naming the integer range from 1 to 3
    const message = new RegExp(`screenshot scale must be an integer from 1 to ${SCREENSHOT_MAX_SCALE}`)
    expect(() => planScreenshot(VIEWPORT, { scale: 0 }, JPEG_QUALITY)).toThrow(message)
    expect(() => planScreenshot(VIEWPORT, { scale: 2.5 }, JPEG_QUALITY)).toThrow(message)
    expect(() => planScreenshot(VIEWPORT, { scale: 4 }, JPEG_QUALITY)).toThrow(message)
  })

  it('operator asks for a fractional clip and the error echoes the requested rectangle', () => {
    // Given a clip with a fractional width
    // When the plan is built
    // Then it throws asking for whole pixels and repeats the rectangle that was asked for
    expect(() => planScreenshot(VIEWPORT, { clip: { x: 0, y: 0, width: 10.5, height: 10 } }, JPEG_QUALITY))
      .toThrow(/screenshot clip must use whole pixels; received 10.5x10 at \(0, 0\)/)
  })

  it('operator asks for a clip smaller than one pixel and the error echoes the requested rectangle', () => {
    // Given a clip whose height is zero
    // When the plan is built
    // Then it throws asking for at least one pixel and repeats the rectangle
    expect(() => planScreenshot(VIEWPORT, { clip: { x: 0, y: 0, width: 10, height: 0 } }, JPEG_QUALITY))
      .toThrow(/screenshot clip must be at least 1x1 pixel; received 10x0 at \(0, 0\)/)
  })

  it('operator asks for a clip starting outside the viewport and the error echoes the requested rectangle', () => {
    // Given a clip whose origin is negative
    // When the plan is built
    // Then it throws refusing an origin outside the viewport and repeats the rectangle
    expect(() => planScreenshot(VIEWPORT, { clip: { x: -1, y: 0, width: 10, height: 10 } }, JPEG_QUALITY))
      .toThrow(/screenshot clip must not start outside the viewport; received 10x10 at \(-1, 0\)/)
  })

  it('operator asks for a clip past the viewport edge and the error reports the real viewport', () => {
    // Given a clip that reaches past the 1280x800 viewport
    // When the plan is built
    // Then it throws quoting the viewport size and the rectangle that was asked for
    expect(() => planScreenshot(VIEWPORT, { clip: { x: 1200, y: 0, width: 200, height: 100 } }, JPEG_QUALITY))
      .toThrow(/screenshot clip must stay inside the 1280x800 viewport; received 200x100 at \(1200, 0\)/)
  })

  it('operator asks for a capture whose side exceeds 8192 pixels and the error names the limit', () => {
    // Given a 6000x1000 viewport asked for at scale 2
    // When the plan is built
    // Then it throws quoting the encoded size and the 8192-pixel side limit
    expect(() => planScreenshot({ width: 6000, height: 1000 }, { scale: 2 }, JPEG_QUALITY))
      .toThrow(/would be 12000x2000 pixels, over the 8192-pixel side limit/)
  })

  it('operator asks for more pixels than the attachment budget and the error names the budget', () => {
    // Given a 1000x800 clip asked for at scale 3, which encodes 7200000 pixels
    // When the plan is built
    // Then it throws quoting the pixel count, the 4194304 budget and the advice to lower the scale
    expect(() => planScreenshot(VIEWPORT, { clip: { x: 0, y: 0, width: 1000, height: 800 }, scale: 3 }, JPEG_QUALITY))
      .toThrow(new RegExp(`would be 7200000 pixels, over the ${SCREENSHOT_MAX_OUTPUT_PIXELS}-pixel output limit; lower the scale or shrink the clip`))
  })
})
