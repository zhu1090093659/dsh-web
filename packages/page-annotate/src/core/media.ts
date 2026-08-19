/**
 * Image media facts for the page-annotate attach seam: accepted types,
 * magic-byte sniffing and strict base64 decoding. Pure Node-safe helpers
 * (Buffer-based), shared by the attach route and its tests.
 * @module @linxin666/dsh-page-annotate/core/media
 */

/** Image media types the attach seam accepts. */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

/** Upper bound on one attach payload (base64 of a 2x screenshot). */
export const MAX_ATTACH_BYTES = 16 * 1024 * 1024

/** Detect the media type from leading magic bytes. */
export function sniffMimeType(bytes: Uint8Array): ImageMimeType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

/** Strictly decode a base64 payload; return undefined when malformed. */
export function decodeBase64(encoded: string): Uint8Array | undefined {
  if (encoded.length === 0 || encoded.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return undefined
  if (/=/.test(encoded) && !/={1,2}$/.test(encoded)) return undefined
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) return undefined
  return bytes
}
