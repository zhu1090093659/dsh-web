/**
 * Minimal PNG/WebP dimension reader — header-only, no decoding, no
 * dependencies. Used by the decoration registry to verify a strip's actual
 * pixel geometry matches its descriptor (single-row sprite strip; the client
 * renders by frame-column offsets, so a mismatched strip silently shows the
 * wrong frames). Parsing is best-effort: an unrecognized or truncated header
 * returns undefined (the caller decides whether to warn).
 *
 * PNG: signature (8) + IHDR chunk — length (4) + 'IHDR' (4) + width (4) +
 * height (4), both big-endian uint32 at fixed offsets 16/20.
 * WebP: RIFF header (12) + chunk — 'VP8X' extended (width-1/height-1 as
 * little-endian uint24 at 24/27), 'VP8L' lossless (packed 14-bit dims at
 * 21), or 'VP8 ' lossy (frame header, low 14 bits of the uint16 at 26/28).
 * @module @linxin666/dsh-pet/image-dimensions
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface ImageDimensions {
  width: number
  height: number
}

/** Read the pixel size of a PNG buffer, or undefined when unrecognized. */
function pngDimensions(buf: Buffer): ImageDimensions | undefined {
  if (buf.length < 24) return undefined
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Read the pixel size of a WebP buffer, or undefined when unrecognized. */
function webpDimensions(buf: Buffer): ImageDimensions | undefined {
  if (buf.length < 21) return undefined
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return undefined
  if (buf.toString('ascii', 8, 12) !== 'WEBP') return undefined
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    // Extended header: 1-byte flags at 20, then width-1/height-1 uint24 LE.
    if (buf.length < 30) return undefined
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    }
  }
  if (fourcc === 'VP8L') {
    // Lossless header: 0x2f marker at 20, then 14-bit width / 14-bit height
    // packed into the little-endian uint32 at 21.
    if (buf.length < 25) return undefined
    const bits = buf.readUInt32LE(21)
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    }
  }
  if (fourcc === 'VP8 ') {
    // Lossy frame header: 3-byte tag + 3-byte start code, then width/height
    // as uint16 LE whose low 14 bits carry the dimension.
    if (buf.length < 30) return undefined
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    }
  }
  return undefined
}

/**
 * Read image pixel dimensions from a PNG or WebP buffer. Returns undefined
 * for formats this reader does not recognize (never throws). Callers treat
 * undefined as "cannot verify", not as an error.
 */
export function imageDimensions(buf: Buffer): ImageDimensions | undefined {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') return webpDimensions(buf)
  return pngDimensions(buf)
}
