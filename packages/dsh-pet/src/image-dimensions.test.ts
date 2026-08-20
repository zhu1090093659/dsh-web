import { describe, expect, it } from 'vitest'
import { imageDimensions } from './image-dimensions.ts'

/** Minimal PNG header (signature + IHDR) for the given size. */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(26)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

/** Minimal extended WebP header (RIFF + VP8X) for the given size. */
function webpExtendedHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(30 - 8, 4)
  buf.write('WEBP', 8)
  buf.write('VP8X', 12)
  buf[20] = 0 // flags: none
  buf.writeUIntLE(width - 1, 24, 3)
  buf.writeUIntLE(height - 1, 27, 3)
  return buf
}

/** Minimal lossless WebP header (RIFF + VP8L). */
function webpLosslessHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(25)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(25 - 8, 4)
  buf.write('WEBP', 8)
  buf.write('VP8L', 12)
  buf[20] = 0x2f
  const bits = (width - 1) | ((height - 1) << 14)
  buf.writeUInt32LE(bits, 21)
  return buf
}

/** Minimal lossy WebP header (RIFF + VP8 ) — low 14 bits carry the size. */
function webpLossyHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(30 - 8, 4)
  buf.write('WEBP', 8)
  buf.write('VP8 ', 12)
  buf.writeUInt16LE(width & 0x3fff, 26)
  buf.writeUInt16LE(height & 0x3fff, 28)
  return buf
}

describe('imageDimensions (decoration strip geometry)', () => {
  it('reads a PNG header', () => {
    expect(imageDimensions(pngHeader(256, 48))).toEqual({ width: 256, height: 48 })
    expect(imageDimensions(pngHeader(64, 48))).toEqual({ width: 64, height: 48 })
  })

  it('reads an extended WebP header (VP8X)', () => {
    expect(imageDimensions(webpExtendedHeader(128, 64))).toEqual({ width: 128, height: 64 })
  })

  it('reads a lossless WebP header (VP8L)', () => {
    expect(imageDimensions(webpLosslessHeader(300, 200))).toEqual({ width: 300, height: 200 })
  })

  it('reads a lossy WebP header (VP8 )', () => {
    expect(imageDimensions(webpLossyHeader(80, 40))).toEqual({ width: 80, height: 40 })
  })

  it('returns undefined for non-image bytes and truncated headers', () => {
    expect(imageDimensions(Buffer.from('not-an-image'))).toBeUndefined()
    expect(imageDimensions(Buffer.alloc(0))).toBeUndefined()
    expect(imageDimensions(Buffer.from([0x89, 0x50]))).toBeUndefined()
    // PNG magic but truncated before IHDR width/height.
    expect(imageDimensions(pngHeader(10, 10).subarray(0, 10))).toBeUndefined()
  })

  it('returns undefined for a RIFF buffer that is not WebP', () => {
    const riff = Buffer.alloc(16)
    riff.write('RIFF', 0)
    riff.write('AVI ', 8)
    expect(imageDimensions(riff)).toBeUndefined()
  })
})
