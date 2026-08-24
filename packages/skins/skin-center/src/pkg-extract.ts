/**
 * Wallpaper Engine scene.pkg / .tex resource extraction.
 *
 * This module is the core of the skin center's "scene wallpaper static frame
 * extraction" feature: it unpacks a Wallpaper Engine scene package (PKG
 * container, magic PKGVxxxx), parses the nested TEX texture containers
 * (TEXV0005 header -> TEXI0001 image info -> TEXB0001..4 mipmap data ->
 * TEXS0001..3 frame animation metadata), decodes the main mipmap to RGBA8888
 * (raw RGBA8888/R8/RG88, FreeImage-embedded JPEG via jpeg-js, plus hand-rolled
 * BC1/BC2/BC3 block decompression for DXT1/DXT3/DXT5), and re-encodes the
 * result as a PNG using only node:zlib.
 *
 * Format facts were cross-checked against the two reference implementations:
 * RePKG (github.com/notscuffed/repkg, PackageReader / TexReader and friends)
 * and linux-wallpaperengine (github.com/Almamu/linux-wallpaperengine,
 * PackageParser / TextureParser):
 *
 * - PKG header: int32-length-prefixed magic string, int32 entry count, then
 *   per entry a length-prefixed path plus uint32 offset/length. Offsets are
 *   relative to the end of the index. Entry data is stored raw in practice;
 *   some packers emit LZ4-chained entries instead (int64 original size, then
 *   repeated [int32 decompressed size][int32 compressed size][LZ4 block]).
 *   parsePkg probes for a perfectly-fitting block chain and flags such
 *   entries; readPkgEntry decompresses them ("compressedSize != size" means
 *   LZ4), single-block chains included.
 * - TEX magics are NUL-terminated 8-character strings (9 bytes on disk).
 *   TEXB0002+ mipmaps carry an isLZ4Compressed flag and a decompressed byte
 *   count; the LZ4 payload is one whole block per mipmap. TEXB0004 with an
 *   unknown FreeImage format plus the video flag marks an embedded MP4, which
 *   is exposed via TexInfo.isVideoMp4 and rejected by decodeTex. GIF flags
 *   (bit 2) pull in a TEXS frame container exposed via TexInfo.frames.
 *
 * LZ4 block decoding follows the official lz4 block format specification;
 * BC1/BC2/BC3 follow the standard public algorithms. One npm dependency:
 * jpeg-js (pure JavaScript, no native builds) for FreeImage JPEG mipmaps.
 *
 * @module @linxin666/dsh-client-ui-skin-center/pkg-extract
 */

import { Buffer } from 'node:buffer'
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { decode as decodeJpeg } from 'jpeg-js'
import { join as joinPath, resolve as resolvePath, sep } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

/**
 * Hard ceilings for allocations driven by wallpaper file content. Workshop
 * files are untrusted: a crafted pkg/tex/png must not be able to force
 * multi-GB host allocations (PR #717 follow-up hardening).
 */
const MAX_PKG_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_TEX_DIMENSION = 16384
const MAX_TEX_PIXELS = 64 * 1024 * 1024

/** One file inside a PKG container. */
export interface PkgEntry {
  /** Slash-separated path exactly as stored in the package index. */
  path: string
  /** Absolute byte offset of the entry data inside the package buffer. */
  offset: number
  /** Bytes occupied by the entry inside the package (compressed length). */
  compressedSize: number
  /** Decompressed size in bytes (equals compressedSize for raw entries). */
  size: number
  /** Bit flags; bit 0 (PKG_ENTRY_FLAG_LZ4) marks LZ4-chained storage. */
  flags: number
}

/** PkgEntry.flags bit marking LZ4 block-chain storage. */
export const PKG_ENTRY_FLAG_LZ4 = 1

/** Wallpaper Engine texture format ids (TEXI0001 header), per RePKG/lwe. */
export const TexFormat = {
  RGBA8888: 0,
  RGB888: 1,
  RGB565: 2,
  DXT5: 4,
  DXT3: 6,
  DXT1: 7,
  RG88: 8,
  R8: 9,
  RG1616F: 10,
  R16F: 11,
  BC7: 12,
  RGBA1010102: 13,
  RGBA16161616F: 14,
  RGB161616F: 15,
} as const

const TEX_FORMAT_NAMES: Record<number, string> = {
  0: 'RGBA8888',
  1: 'RGB888',
  2: 'RGB565',
  4: 'DXT5',
  6: 'DXT3',
  7: 'DXT1',
  8: 'RG88',
  9: 'R8',
  10: 'RG1616F',
  11: 'R16F',
  12: 'BC7',
  13: 'RGBA1010102',
  14: 'RGBA16161616F',
  15: 'RGB161616F',
}

/**
 * A TEX format that is recognized but has no decode implementation in this
 * build (e.g. BC7, 16-bit float). Callers treat it as 'not supported here'
 * rather than a data-corruption failure, so the scene pipeline never emits a
 * partially decoded frame for it and falls back to the author preview (#906).
 */
export class TexUnsupportedError extends Error {
  /** Raw TEXI0001 format id. */
  readonly format: number
  /** Human-readable name of the format id, or 'unknown(N)'. */
  readonly formatName: string
  /** Declared TEXI0001 texture dimensions. */
  readonly width: number
  readonly height: number

  constructor(format: number, formatName: string, width: number, height: number) {
    super('tex: unsupported format ' + format)
    this.name = 'TexUnsupportedError'
    this.format = format
    this.formatName = formatName
    this.width = width
    this.height = height
  }
}

/** TEXI0001 flags bit marking an animated (sprite-sheet / gif) texture. */
const TEX_FLAG_IS_GIF = 4

/** Animated texture frame descriptor. */
export interface TexFrameInfo {
  framenumber: number
  imageId: number
  /** Frame duration in seconds. */
  frametime: number
  x: number
  y: number
  width: number
  height: number
}

/** Parsed TEX container metadata (no pixel data). */
export interface TexInfo {
  width: number
  height: number
  /** Raw TEXI0001 format id (see TexFormat). */
  format: number
  /** Human-readable name of the format id, or 'unknown(N)'. */
  formatName: string
  /** True when the TEXI flags mark an animated sprite-sheet texture. */
  isAnimatedGif: boolean
  /** True when a TEXB0004 container marks an embedded MP4 video. */
  isVideoMp4: boolean
  /** Animation frames, present only for animated textures. */
  frames?: TexFrameInfo[]
  /** Number of mipmap levels of the first image. */
  mipLevels: number
}

/** Decoded RGBA8888 image. */
export interface DecodedImage {
  width: number
  height: number
  rgba: Uint8Array
}

/** Decode uncompressed or filtered PNG image bytes into raw RGBA8888. */
export function decodePngToRgba(pngBuf: Uint8Array): DecodedImage {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idatChunks: Uint8Array[] = []
  const view = new DataView(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength)
  while (pos < pngBuf.length) {
    const len = view.getUint32(pos, false)
    const type = String.fromCharCode(pngBuf[pos + 4], pngBuf[pos + 5], pngBuf[pos + 6], pngBuf[pos + 7])
    const data = pngBuf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      const ihdrView = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = ihdrView.getUint32(0, false)
      height = ihdrView.getUint32(4, false)
      colorType = data[9]
      if (width <= 0 || height <= 0 || width > MAX_TEX_DIMENSION || height > MAX_TEX_DIMENSION || width * height > MAX_TEX_PIXELS) {
        throw new Error('png: invalid dimensions ' + width + 'x' + height)
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  const totalIdat = idatChunks.reduce((acc, c) => acc + c.length, 0)
  if (totalIdat > MAX_DECOMPRESSED_BYTES) {
    throw new Error('png: idat stream too large (' + totalIdat + ' bytes)')
  }
  const combined = new Uint8Array(totalIdat)
  let cur = 0
  for (const c of idatChunks) {
    combined.set(c, cur)
    cur += c.length
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const stride = width * bytesPerPixel
  const maxOutput = height * (1 + stride) + 64
  const uncompressed = inflateSync(combined, { maxOutputLength: maxOutput })
  const raw = new Uint8Array(width * height * 4)
  let srcPos = 0
  const rowBuf = new Uint8Array(stride)
  const prevRowBuf = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filterType = uncompressed[srcPos++]
    for (let x = 0; x < stride; x++) {
      const b = uncompressed[srcPos++]
      const a = x >= bytesPerPixel ? rowBuf[x - bytesPerPixel] : 0
      const c = x >= bytesPerPixel ? prevRowBuf[x - bytesPerPixel] : 0
      const p_b = prevRowBuf[x]
      let val = b
      if (filterType === 1) val = (b + a) & 0xff
      else if (filterType === 2) val = (b + p_b) & 0xff
      else if (filterType === 3) val = (b + Math.floor((a + p_b) / 2)) & 0xff
      else if (filterType === 4) {
        const p = a + p_b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - p_b)
        const pc = Math.abs(p - c)
        let pr = a
        if (pb < pa && pb < pc) pr = p_b
        else if (pc < pa) pr = c
        val = (b + pr) & 0xff
      }
      rowBuf[x] = val
    }
    prevRowBuf.set(rowBuf)
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4
      if (colorType === 6) {
        raw[di] = rowBuf[x * 4]
        raw[di + 1] = rowBuf[x * 4 + 1]
        raw[di + 2] = rowBuf[x * 4 + 2]
        raw[di + 3] = rowBuf[x * 4 + 3]
      } else if (colorType === 2) {
        raw[di] = rowBuf[x * 3]
        raw[di + 1] = rowBuf[x * 3 + 1]
        raw[di + 2] = rowBuf[x * 3 + 2]
        raw[di + 3] = 255
      } else {
        raw[di] = rowBuf[x]
        raw[di + 1] = rowBuf[x]
        raw[di + 2] = rowBuf[x]
        raw[di + 3] = 255
      }
    }
  }
  return { width, height, rgba: raw }
}

/** Result of extractSceneMainImage. */
export interface SceneMainImage {
  width: number
  height: number
  png: Buffer
  /** Package path of the texture the frame was extracted from. */
  texturePath: string
}

const textDecoder = new TextDecoder('utf-8')

/**
 * Bounds-checked little-endian binary reader. Every failed read throws an
 * Error prefixed with the reader label (e.g. 'pkg: unexpected end of data').
 */
class Reader {
  private data: Uint8Array
  private label: string
  private view: DataView
  pos = 0

  constructor(data: Uint8Array, label: string) {
    this.data = data
    this.label = label
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  }

  get remaining(): number {
    return this.view.byteLength - this.pos
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.view.byteLength) {
      throw new Error(this.label + ': unexpected end of data')
    }
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.pos++)
  }

  i32(): number {
    this.need(4)
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }

  u32(): number {
    this.need(4)
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }

  /** Unsigned 64-bit integer; safe up to 2^53. */
  u64(): number {
    const lo = this.u32()
    const hi = this.u32()
    return hi * 0x100000000 + lo
  }

  f32(): number {
    this.need(4)
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }

  bytes(n: number): Uint8Array {
    this.need(n)
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  /** int32-length-prefixed UTF-8 string (PKG magic and entry paths). */
  sizedString(maxLength: number): string {
    const length = this.i32()
    if (length < 0 || length > maxLength) {
      throw new Error(this.label + ': invalid string length ' + length)
    }
    return textDecoder.decode(this.bytes(length))
  }

  /** NUL-terminated string (all TEX magics and the TEXB0004 json blob). */
  nstring(maxLength: number): string {
    const start = this.pos
    let end = start
    const limit = Math.min(this.view.byteLength, start + maxLength)
    while (end < limit && this.view.getUint8(end) !== 0) end++
    if (end >= limit) {
      throw new Error(this.label + ': unterminated string')
    }
    const out = textDecoder.decode(this.data.subarray(start, end))
    this.pos = end + 1
    return out
  }
}

/**
 * Decompress one raw LZ4 block (the format inside PKG entry chains and TEXB
 * mipmaps) following the official lz4 block format specification.
 *
 * @param src compressed block bytes
 * @param dstSize exact expected decompressed size
 */
export function lz4DecompressBlock(src: Uint8Array, dstSize: number): Uint8Array {
  if (dstSize < 0 || dstSize > MAX_DECOMPRESSED_BYTES) {
    throw new Error('lz4: decompressed size out of bounds (' + String(dstSize) + ')')
  }
  const dst = new Uint8Array(dstSize)
  let ip = 0
  let op = 0
  while (ip < src.length) {
    const token = src[ip++]
    // literal run
    let literalLength = token >> 4
    if (literalLength === 15) {
      let s = 0
      do {
        if (ip >= src.length) throw new Error('lz4: truncated literal length')
        s = src[ip++]
        literalLength += s
      } while (s === 255)
    }
    if (ip + literalLength > src.length || op + literalLength > dstSize) {
      throw new Error('lz4: literal run out of bounds')
    }
    dst.set(src.subarray(ip, ip + literalLength), op)
    ip += literalLength
    op += literalLength
    if (ip >= src.length) break // last sequence: literals only, block ends
    // match copy
    if (ip + 2 > src.length) throw new Error('lz4: truncated match offset')
    const offset = src[ip] | (src[ip + 1] << 8)
    ip += 2
    if (offset === 0 || offset > op) throw new Error('lz4: invalid match offset ' + offset)
    let matchLength = token & 0x0f
    if (matchLength === 15) {
      let s = 0
      do {
        if (ip >= src.length) throw new Error('lz4: truncated match length')
        s = src[ip++]
        matchLength += s
      } while (s === 255)
    }
    matchLength += 4
    if (op + matchLength > dstSize) throw new Error('lz4: match run out of bounds')
    for (let i = 0; i < matchLength; i++) {
      dst[op] = dst[op - offset]
      op++
    }
  }
  if (op !== dstSize) {
    throw new Error('lz4: decompressed size mismatch (got ' + op + ', expected ' + dstSize + ')')
  }
  return dst
}

/**
 * Probe whether the entry data at [abs, abs+length) is an LZ4 block chain:
 * int64 original size followed by [int32 uncomp][int32 comp][block] entries
 * that reconstruct exactly originalSize bytes while consuming the entry to
 * the byte. Returns the original size when the chain fits perfectly.
 */
function probeCompressedEntry(data: Uint8Array, abs: number, length: number): number | null {
  if (length < 8) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const originalSize = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 0x100000000
  // compression only ever wins space; larger "originals" are raw data
  if (originalSize <= length || originalSize > 0x7fffffff) return null
  let pos = abs + 8
  let total = 0
  while (total < originalSize) {
    if (pos + 8 > abs + length) return null
    const uncomp = view.getInt32(pos, true)
    const comp = view.getInt32(pos + 4, true)
    if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length) return null
    total += uncomp
    pos += 8 + comp
  }
  return total === originalSize && pos === abs + length ? originalSize : null
}

/**
 * Parse a PKG container (magic PKGVxxxx) and return its entry index.
 * Entry offsets in the returned list are absolute positions inside data.
 */
export function parsePkg(data: Uint8Array): PkgEntry[] {
  const r = new Reader(data, 'pkg')
  const magic = r.sizedString(32)
  if (!/^PKGV\d{4}$/.test(magic)) {
    throw new Error("pkg: bad magic '" + magic + "'")
  }
  const count = r.i32()
  if (count < 0 || count > 0x100000) {
    throw new Error('pkg: invalid entry count ' + count)
  }
  const index: { path: string; offset: number; length: number }[] = []
  for (let i = 0; i < count; i++) {
    index.push({ path: r.sizedString(1024), offset: r.u32(), length: r.u32() })
  }
  const dataStart = r.pos
  return index.map(({ path, offset, length }) => {
    const abs = dataStart + offset
    if (abs + length > data.byteLength) {
      throw new Error("pkg: entry '" + path + "' out of bounds")
    }
    const originalSize = probeCompressedEntry(data, abs, length)
    return originalSize === null
      ? { path, offset: abs, compressedSize: length, size: length, flags: 0 }
      : { path, offset: abs, compressedSize: length, size: originalSize, flags: PKG_ENTRY_FLAG_LZ4 }
  })
}

/**
 * Extract (and decompress, when the entry uses LZ4 block-chain storage) one
 * package entry. Returns a fresh buffer of exactly entry.size bytes.
 */
export function readPkgEntry(data: Uint8Array, entry: PkgEntry): Uint8Array {
  const abs = entry.offset
  if (abs < 0 || abs + entry.compressedSize > data.byteLength) {
    throw new Error("pkg: entry '" + entry.path + "' out of bounds")
  }
  if ((entry.flags & PKG_ENTRY_FLAG_LZ4) === 0) {
    return data.slice(abs, abs + entry.compressedSize)
  }
  if (entry.size > MAX_PKG_ENTRY_BYTES) {
    throw new Error("pkg: entry '" + entry.path + "' too large (" + entry.size + ' bytes)')
  }
  const r = new Reader(data.subarray(abs, abs + entry.compressedSize), 'pkg')
  const originalSize = r.u64()
  if (originalSize !== entry.size) {
    throw new Error("pkg: entry '" + entry.path + "' size mismatch")
  }
  const out = new Uint8Array(entry.size)
  let written = 0
  while (written < entry.size) {
    const uncomp = r.i32()
    const comp = r.i32()
    if (uncomp <= 0 || comp <= 0 || written + uncomp > entry.size) {
      throw new Error("pkg: corrupt compressed entry '" + entry.path + "'")
    }
    out.set(lz4DecompressBlock(r.bytes(comp), uncomp), written)
    written += uncomp
  }
  if (r.remaining !== 0) {
    throw new Error("pkg: corrupt compressed entry '" + entry.path + "'")
  }
  return out
}

interface TexMipmap {
  width: number
  height: number
  /** Fully decompressed pixel bytes. */
  bytes: Uint8Array
}

interface TexParsed {
  format: number
  flags: number
  width: number
  height: number
  isAnimatedGif: boolean
  isVideoMp4: boolean
  frames: TexFrameInfo[]
  /** First image's mipmap chain, index 0 is the largest level. */
  mipmaps: TexMipmap[]
}

function readMipmap(r: Reader, containerVersion: number): TexMipmap {
  if (containerVersion === 4) {
    // TEXB0004 mipmap preamble (editor-only metadata, per RePKG)
    const param1 = r.i32()
    const param2 = r.i32()
    r.nstring(1 << 20) // condition json
    const param3 = r.i32()
    if (param1 !== 1 || param2 !== 2 || param3 !== 1) {
      throw new Error('tex: bad TEXB0004 mipmap params')
    }
  }
  const width = r.i32()
  const height = r.i32()
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384) {
    throw new Error('tex: invalid mipmap dimensions ' + width + 'x' + height)
  }
  if (containerVersion === 1) {
    return { width, height, bytes: r.bytes(r.i32()) }
  }
  const isLz4 = r.i32() === 1
  const decompressedCount = r.i32()
  const stored = r.bytes(r.i32())
  if (isLz4) {
    return { width, height, bytes: lz4DecompressBlock(stored, decompressedCount) }
  }
  return { width, height, bytes: stored }
}

/** Parse a TEX container into metadata plus the first image's mipmaps. */
function parseTexInternal(data: Uint8Array): TexParsed {
  const r = new Reader(data, 'tex')
  const magic1 = r.nstring(16)
  if (magic1 !== 'TEXV0005') {
    throw new Error("tex: bad magic '" + magic1 + "'")
  }
  const magic2 = r.nstring(16)
  if (magic2 !== 'TEXI0001') {
    throw new Error("tex: bad image-info magic '" + magic2 + "'")
  }
  const format = r.i32()
  const flags = r.i32()
  const textureWidth = r.i32()
  const textureHeight = r.i32()
  const imageWidth = r.i32()
  const imageHeight = r.i32()
  r.u32() // unknown
  if (TEX_FORMAT_NAMES[format] === undefined) {
    throw new TexUnsupportedError(format, 'unknown(' + format + ')', textureWidth, textureHeight)
  }
  const containerMagic = r.nstring(16)
  const containerMatch = /^TEXB000([1-4])$/.exec(containerMagic)
  if (!containerMatch) {
    throw new Error("tex: bad mipmap container magic '" + containerMagic + "'")
  }
  let containerVersion = Number(containerMatch[1])
  const imageCount = r.i32()
  if (imageCount <= 0 || imageCount > 256) {
    throw new Error('tex: invalid image count ' + imageCount)
  }
  let isVideoMp4 = false
  if (containerVersion === 3) {
    r.i32() // FreeImage format of embedded image data
  } else if (containerVersion === 4) {
    const freeImageFormat = r.i32()
    isVideoMp4 = r.i32() === 1
    // only an unknown container format plus the video flag keeps the
    // TEXB0004 mipmap layout; everything else falls back to TEXB0003
    if (!(freeImageFormat === -1 && isVideoMp4)) {
      containerVersion = 3
    }
  }
  let firstImage: TexMipmap[] | null = null
  for (let i = 0; i < imageCount; i++) {
    const mipmapCount = r.i32()
    if (mipmapCount <= 0 || mipmapCount > 32) {
      throw new Error('tex: invalid mipmap count ' + mipmapCount)
    }
    const mipmaps: TexMipmap[] = []
    for (let j = 0; j < mipmapCount; j++) {
      mipmaps.push(readMipmap(r, containerVersion))
    }
    if (firstImage === null) firstImage = mipmaps
  }
  const isAnimatedGif = (flags & TEX_FLAG_IS_GIF) !== 0
  const frames: TexFrameInfo[] = []
  if (isAnimatedGif) {
    const frameMagic = r.nstring(16)
    const frameMatch = /^TEXS000([1-3])$/.exec(frameMagic)
    if (!frameMatch) {
      throw new Error("tex: bad frame container magic '" + frameMagic + "'")
    }
    const frameVersion = Number(frameMatch[1])
    const frameCount = r.i32()
    if (frameCount < 0 || frameCount > 4096) {
      throw new Error('tex: invalid frame count ' + frameCount)
    }
    if (frameVersion === 3) {
      r.i32() // gif width
      r.i32() // gif height
    }
    for (let i = 0; i < frameCount; i++) {
      const imageId = r.i32()
      const frametime = r.f32()
      if (frameVersion === 1) {
        const x = r.i32()
        const y = r.i32()
        const width = r.i32()
        r.i32() // widthY
        r.i32() // heightX
        const height = r.i32()
        frames.push({ framenumber: i, imageId, frametime, x, y, width, height })
      } else {
        const x = r.f32()
        const y = r.f32()
        const width = r.f32()
        r.f32() // widthY
        r.f32() // heightX
        const height = r.f32()
        frames.push({ framenumber: i, imageId, frametime, x, y, width, height })
      }
    }
  }
  const mip0 = firstImage![0]
  if (!isVideoMp4 && mip0 && mip0.bytes && mip0.bytes.length >= 8) {
    const b = mip0.bytes
    if ((b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) ||
        (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x00 && b[3] === 0x18 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) {
      isVideoMp4 = true
    }
  }
  return {
    format,
    flags,
    width: imageWidth > 0 ? imageWidth : textureWidth > 0 ? textureWidth : mip0.width,
    height: imageHeight > 0 ? imageHeight : textureHeight > 0 ? textureHeight : mip0.height,
    isAnimatedGif,
    isVideoMp4,
    frames,
    mipmaps: firstImage!,
  }
}

/**
 * Parse a TEX container and return its metadata. Animated (gif) and embedded
 * MP4 textures are recognized and exposed, never silently dropped.
 */
export function parseTex(data: Uint8Array): TexInfo {
  const parsed = parseTexInternal(data)
  const info: TexInfo = {
    width: parsed.width,
    height: parsed.height,
    format: parsed.format,
    formatName: TEX_FORMAT_NAMES[parsed.format] ?? 'unknown(' + parsed.format + ')',
    isAnimatedGif: parsed.isAnimatedGif,
    isVideoMp4: parsed.isVideoMp4,
    mipLevels: parsed.mipmaps.length,
  }
  if (parsed.isAnimatedGif) info.frames = parsed.frames
  return info
}

function rgb565(value: number): [number, number, number] {
  const r = (value >> 11) & 31
  const g = (value >> 5) & 63
  const b = value & 31
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

/** Build the 4-color BC palette; three-color + transparent when DXT1 c0 <= c1. */
function buildColorPalette(c0: number, c1: number, fourColor: boolean): Uint8Array {
  const palette = new Uint8Array(16)
  const [r0, g0, b0] = rgb565(c0)
  const [r1, g1, b1] = rgb565(c1)
  palette.set([r0, g0, b0, 255], 0)
  palette.set([r1, g1, b1, 255], 4)
  if (fourColor) {
    palette.set([((2 * r0 + r1) / 3) | 0, ((2 * g0 + g1) / 3) | 0, ((2 * b0 + b1) / 3) | 0, 255], 8)
    palette.set([((r0 + 2 * r1) / 3) | 0, ((g0 + 2 * g1) / 3) | 0, ((b0 + 2 * b1) / 3) | 0, 255], 12)
  } else {
    palette.set([((r0 + r1) / 2) | 0, ((g0 + g1) / 2) | 0, ((b0 + b1) / 2) | 0, 255], 8)
    palette.set([0, 0, 0, 0], 12)
  }
  return palette
}

/**
 * Shared BC1/BC2/BC3 block walker. Color data sits at block base +
 * colorOffset; blockStride is 8 (BC1) or 16 (BC2/BC3). dxt1Alpha enables the
 * three-color + transparent palette when c0 <= c1.
 */
function decodeColorBlocks(
  src: Uint8Array,
  out: Uint8Array,
  width: number,
  height: number,
  blockStride: number,
  colorOffset: number,
  dxt1Alpha: boolean,
): void {
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength)
  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * blockStride
      const c0 = view.getUint16(base + colorOffset, true)
      const c1 = view.getUint16(base + colorOffset + 2, true)
      const palette = buildColorPalette(c0, c1, dxt1Alpha ? c0 > c1 : true)
      const indices = view.getUint32(base + colorOffset + 4, true)
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          const y = by * 4 + py
          if (x >= width || y >= height) continue
          const selector = (indices >> (2 * (py * 4 + px))) & 3
          const dst = (y * width + x) * 4
          out[dst] = palette[selector * 4]
          out[dst + 1] = palette[selector * 4 + 1]
          out[dst + 2] = palette[selector * 4 + 2]
          out[dst + 3] = palette[selector * 4 + 3]
        }
      }
    }
  }
}

/** BC1 (DXT1): 8-byte blocks, 4x4 pixels, optional 1-bit alpha. */
function decodeDxt1(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  decodeColorBlocks(src, out, width, height, 8, 0, true)
  return out
}

/** BC2 (DXT3): 16-byte blocks, 4-bit explicit alpha + BC1-style color. */
function decodeDxt3(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  decodeColorBlocks(src, out, width, height, 16, 8, false)
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength)
  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16
      const alphaLo = view.getUint32(base, true)
      const alphaHi = view.getUint32(base + 4, true)
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4)
        const y = by * 4 + ((i / 4) | 0)
        if (x >= width || y >= height) continue
        const nibble = i < 8 ? (alphaLo >> (4 * i)) & 15 : (alphaHi >> (4 * (i - 8))) & 15
        out[(y * width + x) * 4 + 3] = nibble * 17
      }
    }
  }
  return out
}

/** BC3 (DXT5): 16-byte blocks, interpolated 3-bit alpha + BC1-style color. */
function decodeDxt5(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  decodeColorBlocks(src, out, width, height, 16, 8, false)
  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const base = (by * blocksX + bx) * 16
      const a0 = src[base]
      const a1 = src[base + 1]
      const alphas = new Uint8Array(8)
      alphas[0] = a0
      alphas[1] = a1
      if (a0 > a1) {
        for (let k = 2; k < 8; k++) alphas[k] = (((8 - k) * a0 + (k - 1) * a1) / 7) | 0
      } else {
        for (let k = 2; k < 6; k++) alphas[k] = (((6 - k) * a0 + (k - 2) * a1) / 5) | 0
        alphas[6] = 0
        alphas[7] = 255
      }
      // 48-bit little-endian index stream, 3 bits per pixel (exact in doubles)
      let bits =
        src[base + 2] +
        src[base + 3] * 0x100 +
        src[base + 4] * 0x10000 +
        src[base + 5] * 0x1000000 +
        src[base + 6] * 0x100000000 +
        src[base + 7] * 0x10000000000
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4)
        const y = by * 4 + ((i / 4) | 0)
        const index = bits % 8
        bits = Math.floor(bits / 8)
        if (x >= width || y >= height) continue
        out[(y * width + x) * 4 + 3] = alphas[index]
      }
    }
  }
  return out
}

/**
 * Decode the first (largest) mipmap of a TEX container to RGBA8888.
 * Supports RGBA8888, R8, RG88 and DXT1/DXT3/DXT5; embedded MP4 textures and
 * unknown formats throw a descriptive error instead of failing silently.
 * WE pads mipmaps to power-of-two sizes (e.g. a 1920x1080 image stored in a
 * 2048x2048 mip); the TEXI header's image rect is the real content, anchored
 * top-left, so the result is cropped to it before returning.
 */
/** Crop the power-of-two padding: the TEXI image rect sits at the top-left of
 * the stored mip (verified by render probe), anything beyond it is filler. */
function cropToImageRect(decoded: DecodedImage, imageWidth: number, imageHeight: number): DecodedImage {
  const cropW = Math.min(imageWidth, decoded.width)
  const cropH = Math.min(imageHeight, decoded.height)
  if (cropW > 0 && cropH > 0 && (cropW < decoded.width || cropH < decoded.height)) {
    const cropped = new Uint8Array(cropW * cropH * 4)
    for (let y = 0; y < cropH; y++) {
      cropped.set(decoded.rgba.subarray(y * decoded.width * 4, (y * decoded.width + cropW) * 4), y * cropW * 4)
    }
    return { width: cropW, height: cropH, rgba: cropped }
  }
  return decoded
}

export function decodeTex(data: Uint8Array): DecodedImage {
  const parsed = parseTexInternal(data)
  if (parsed.isVideoMp4) {
    throw new Error('tex: video mp4 textures cannot be decoded to a static frame')
  }
  const mip = parsed.mipmaps[0]
  if (isPngBuffer(mip.bytes)) {
    return decodePngToRgba(mip.bytes)
  }
  // FreeImage-embedded JPEG mipmaps (FF D8): decode through the pure-JS
  // jpeg-js decoder; cropToImageRect below trims any power-of-two padding (#756).
  if (mip.bytes[0] === 0xff && mip.bytes[1] === 0xd8) {
    const jpeg = decodeJpeg(Buffer.from(mip.bytes), { useTArray: true })
    const rgba: Uint8Array = jpeg.data
    return cropToImageRect({ width: jpeg.width, height: jpeg.height, rgba }, parsed.width, parsed.height)
  }
  const { width, height, bytes } = mip
  let decoded: DecodedImage
  switch (parsed.format) {
    case TexFormat.RGBA8888: {
      if (bytes.length < width * height * 4) {
        throw new Error(
          'tex: mipmap size mismatch for RGBA8888 (actual ' + bytes.length + ' < expected ' + width * height * 4 + ')',
        )
      }
      decoded = { width, height, rgba: bytes.slice(0, width * height * 4) }
      break
    }
    case TexFormat.R8: {
      if (bytes.length < width * height) throw new Error('tex: mipmap size mismatch for R8')
      const rgba = new Uint8Array(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i]
        rgba[i * 4 + 1] = bytes[i]
        rgba[i * 4 + 2] = bytes[i]
        rgba[i * 4 + 3] = 255
      }
      decoded = { width, height, rgba }
      break
    }
    case TexFormat.RG88: {
      if (bytes.length < width * height * 2) throw new Error('tex: mipmap size mismatch for RG88')
      const rgba = new Uint8Array(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = bytes[i * 2]
        rgba[i * 4 + 1] = bytes[i * 2 + 1]
        rgba[i * 4 + 2] = 0
        rgba[i * 4 + 3] = 255
      }
      decoded = { width, height, rgba }
      break
    }
    case TexFormat.DXT1: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 8
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT1')
      decoded = { width, height, rgba: decodeDxt1(bytes, width, height) }
      break
    }
    case TexFormat.DXT3: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT3')
      decoded = { width, height, rgba: decodeDxt3(bytes, width, height) }
      break
    }
    case TexFormat.DXT5: {
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16
      if (bytes.length < expected) throw new Error('tex: mipmap size mismatch for DXT5')
      decoded = { width, height, rgba: decodeDxt5(bytes, width, height) }
      break
    }
    default:
      throw new TexUnsupportedError(
        parsed.format,
        TEX_FORMAT_NAMES[parsed.format] ?? 'unknown(' + parsed.format + ')',
        parsed.width,
        parsed.height,
      )
  }
  return cropToImageRect(decoded, parsed.width, parsed.height)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * Encode RGBA8888 pixels as a minimal PNG (8-bit RGBA, filter type 0) using
 * node:zlib deflate and a hand-rolled CRC32. Zero dependencies.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('png: invalid dimensions ' + width + 'x' + height)
  }
  if (rgba.length !== width * height * 4) {
    throw new Error('png: rgba buffer size mismatch')
  }
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter type 0 (none)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // compression 0, filter 0, interlace 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Extract .tex candidate paths referenced by one scene.json image object. */
function collectImageObjectTextures(
  imageObject: Record<string, unknown>,
  readJson: (path: string) => unknown | null,
): string[] {
  const out: string[] = []
  const pushTextureList = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      const rawName =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
            ? (item as { name: string }).name
            : item && typeof item === 'object' && typeof (item as { file?: unknown }).file === 'string'
              ? (item as { file: string }).file
              : null
      if (!rawName) continue
      if (rawName.toLowerCase().endsWith('.tex')) {
        out.push(rawName)
      } else {
        out.push(rawName + '.tex')
        out.push('materials/' + rawName + '.tex')
      }
    }
  }
  const ref = imageObject.image as string
  if (ref.toLowerCase().endsWith('.tex')) {
    out.push(ref)
  } else {
    let materialJson = readJson(ref) as { material?: string; passes?: { textures?: unknown }[] } | null
    if (materialJson && typeof materialJson.material === 'string') {
      const matRef = materialJson.material
      materialJson = (readJson(matRef) ?? readJson('materials/' + matRef)) as { passes?: { textures?: unknown }[] } | null
    }
    if (materialJson && Array.isArray(materialJson.passes)) {
      for (const pass of materialJson.passes) pushTextureList(pass?.textures)
    }
  }
  // per-instance texture overrides
  const instance = imageObject.instance as { textures?: unknown } | undefined
  if (instance && typeof instance === 'object') pushTextureList(instance.textures)
  return out
}

/**
 * High-level pipeline: unpack a scene package, pick the main texture (the
 * material texture of the first image object in scene.json, falling back to
 * the largest decodable .tex in the package), decode it and re-encode as PNG.
 * Textures that cannot produce a static frame (embedded MP4, unsupported
 * pixel formats) are skipped in favor of the next candidate; if nothing is
 * decodable the last parse error is rethrown so failures are never silent.
 */
/** One readable file inside a scene project, with its canonical path. */
interface SceneFile {
  path: string
  bytes: Uint8Array
}

/**
 * Internal read access over one scene's files — either a PKG container or a
 * loose project directory. Paths are the relative, slash-separated paths
 * used by scene.json material references.
 */
interface SceneAccess {
  /** Parse one JSON file; null when absent or invalid. */
  readJson: (path: string) => unknown | null
  /** Read one file; null when absent (or, for directories, an escape). */
  readFile: (path: string) => SceneFile | null
  /** Every available .tex path (fallback texture candidates). */
  listTexPaths: () => string[]
}

/** SceneAccess over a packed scene.pkg container (case-insensitive paths). */
function pkgSceneAccess(pkgData: Uint8Array): SceneAccess {
  const entries = parsePkg(pkgData)
  const byPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]))
  const readFile = (path: string): SceneFile | null => {
    const entry = byPath.get(path.toLowerCase())
    if (!entry) return null
    return { path: entry.path, bytes: readPkgEntry(pkgData, entry) }
  }
  return {
    readJson: (path) => {
      const file = readFile(path)
      if (!file) return null
      try {
        return JSON.parse(textDecoder.decode(file.bytes))
      } catch {
        return null
      }
    },
    readFile,
    listTexPaths: () =>
      entries.filter((entry) => entry.path.toLowerCase().endsWith('.tex')).map((entry) => entry.path),
  }
}

/**
 * SceneAccess over a loose scene project directory (scene.json plus loose
 * .tex/.json files, e.g. WE defaultprojects). Reads are fenced inside the
 * directory; texture references escaping it resolve to null.
 */
function dirSceneAccess(dir: string): SceneAccess {
  const normDir = resolvePath(dir)
  const realDir = (() => { try { return realpathSync(normDir) } catch { return normDir } })()
  const readFile = (path: string): SceneFile | null => {
    const abs = resolvePath(normDir, path)
    if (abs !== normDir && !abs.startsWith(normDir + sep)) return null
    try {
      // Never follow symlinks: a project dir containing a link must not
      // leak arbitrary file bytes into the extraction pipeline.
      if (lstatSync(abs).isSymbolicLink()) return null
      if (!statSync(abs).isFile()) return null
      const real = realpathSync(abs)
      if (real !== realDir && !real.startsWith(realDir + sep)) return null
      return { path, bytes: new Uint8Array(readFileSync(real)) }
    } catch {
      return null
    }
  }
  const listTexPaths = (): string[] => {
    const out: string[] = []
    const walk = (sub: string, depth: number): void => {
      if (depth > 4) return
      let names: string[] = []
      try {
        names = readdirSync(sub === '' ? normDir : joinPath(normDir, sub))
      } catch {
        return
      }
      for (const name of names) {
        const rel = sub === '' ? name : sub + '/' + name
        let isDir = false
        let isFile = false
        try {
          const lst = lstatSync(joinPath(normDir, rel))
          if (lst.isSymbolicLink()) continue
          isDir = lst.isDirectory()
          isFile = lst.isFile()
        } catch {
          continue
        }
        if (isDir) walk(rel, depth + 1)
        else if (isFile && name.toLowerCase().endsWith('.tex')) out.push(rel)
      }
    }
    walk('', 0)
    return out
  }
  return {
    readJson: (path) => {
      const file = readFile(path)
      if (!file) return null
      try {
        return JSON.parse(textDecoder.decode(file.bytes))
      } catch {
        return null
      }
    },
    readFile,
    listTexPaths,
  }
}

function isPngBuffer(buf: Uint8Array): boolean {
  return buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
}

function isLikelyMaskOrHelper(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    lower.includes('/masks/') ||
    lower.includes('_mask') ||
    lower.includes('mask') ||
    lower.includes('flow') ||
    lower.includes('wave') ||
    lower.includes('noise') ||
    lower.includes('lut') ||
    lower.includes('distort') ||
    lower.includes('warp') ||
    lower.includes('vortex') ||
    lower.includes('glow') ||
    lower.includes('neon') ||
    lower.includes('strip') ||
    lower.includes('bulb') ||
    lower.includes('led') ||
    lower.includes('combined') ||
    lower.includes('isometric') ||
    lower.includes('razer') ||
    lower.includes('len') ||
    lower.includes('lens') ||
    lower.includes('flare') ||
    lower.includes('prism') ||
    lower.includes('diffract') ||
    lower.includes('black') ||
    lower.includes('overlay') ||
    lower === 'sun' ||
    lower.endsWith('/sun.tex') ||
    lower.endsWith('/sun.json') ||
    lower.endsWith('/sun') ||
    lower.includes('waterripple') ||
    lower.includes('waterflow') ||
    lower.includes('phase') ||
    lower.includes('normal') ||
    lower.includes('foliagesway') ||
    lower.includes('cursorripple') ||
    lower.includes('赞助') ||
    lower.includes('sponsor') ||
    lower.includes('donate') ||
    lower.includes('qrcode') ||
    lower.includes('qr_code') ||
    lower.includes('audio_bar') ||
    lower.includes('audiobar') ||
    lower.includes('simple_audio') ||
    lower.includes('提示框') ||
    lower.includes('tip') ||
    lower.includes('watermark') ||
    lower.includes('logo') ||
    lower.includes('particle') ||
    lower.includes('audio') ||
    lower.includes('lightmap') ||
    lower.includes('light_map') ||
    lower.includes('visso') ||
    lower.includes('font') ||
    lower.includes('text_')
  )
}

function hasContent(rgba: Uint8Array, width: number, height: number): boolean {
  const totalPixels = width * height
  const step = Math.max(1, Math.floor(totalPixels / 1000))
  let visibleCount = 0
  let sampleCount = 0
  for (let i = 0; i < totalPixels; i += step) {
    sampleCount++
    const idx = i * 4
    const r = rgba[idx]
    const g = rgba[idx + 1]
    const b = rgba[idx + 2]
    const a = rgba[idx + 3]
    if (a > 10 && (r > 0 || g > 0 || b > 0)) {
      visibleCount++
    }
  }
  return sampleCount === 0 || (visibleCount / sampleCount) >= 0.01
}

/**
 * Read the scene's declared projection size (the viewport the author
 * designed the scene for). Scenes without an explicit projection default to
 * null so the extractor keeps the texture's native dimensions.
 */
function sceneProjectionSize(scene: Record<string, unknown>): { width: number; height: number } | null {
  const general = scene.general as { orthogonalprojection?: { width?: unknown; height?: unknown } } | undefined
  const rawW = general?.orthogonalprojection?.width
  const rawH = general?.orthogonalprojection?.height
  const width = typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0 ? Math.floor(rawW) : 0
  const height = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? Math.floor(rawH) : 0
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * Center-crop RGBA pixels to the scene's projection aspect ratio (cover
 * semantics). Scene textures are authored at the full projection canvas
 * (e.g. 2048x2048) while the viewport is 16:9; returning the raw square
 * makes the wallpaper stretch or crop wrongly on a widescreen display.
 * Returns null when no projection is declared or the ratio already matches.
 */
function cropToProjection(
  rgba: Uint8Array,
  width: number,
  height: number,
  projection: { width: number; height: number } | null,
): { width: number; height: number; rgba: Uint8Array } | null {
  if (!projection) return null
  const sourceRatio = width / height
  const targetRatio = projection.width / projection.height
  if (Math.abs(sourceRatio - targetRatio) < 0.005) return null
  let outWidth = width
  let outHeight = height
  if (sourceRatio > targetRatio) {
    outWidth = Math.floor(height * targetRatio)
    if (outWidth >= width) return null
  } else {
    outHeight = Math.floor(width / targetRatio)
    if (outHeight >= height) return null
  }
  const startX = Math.max(0, Math.floor((width - outWidth) / 2))
  const startY = Math.max(0, Math.floor((height - outHeight) / 2))
  const out = new Uint8Array(outWidth * outHeight * 4)
  for (let y = 0; y < outHeight; y++) {
    const srcStart = ((startY + y) * width + startX) * 4
    out.set(rgba.subarray(srcStart, srcStart + outWidth * 4), y * outWidth * 4)
  }
  return { width: outWidth, height: outHeight, rgba: out }
}

function getTextureScore(path: string): number {
  const lower = path.toLowerCase()
  if (isLikelyMaskOrHelper(path)) return -100
  let score = 0
  if (lower.includes('白天') || lower.includes('day') || lower.includes('main') || lower.includes('background') || lower.includes('wallpaper')) {
    score += 50
  }
  if (lower.includes('清晨') || lower.includes('morning') || lower.includes('黄昏') || lower.includes('dusk')) {
    score += 20
  }
  if (lower.includes('昼夜变化') || lower.includes('mddn') || lower.includes('transition')) {
    score -= 30
  }
  return score
}

/** Composite layered 2D sprite scenes into a single full-resolution frame.
 * Rejects the composite when the scene's top-ranked texture (the intended
 * main art) is not among the decoded layers — e.g. an unsupported BC7 main
 * texture — so the caller falls back to the per-candidate path and the
 * author preview instead of emitting a partial frame (#906). */
function tryCompositeMultiLayerScene(
  scene: Record<string, unknown>,
  access: SceneAccess,
  topCandidate: string | null,
): SceneMainImage | null {
  const objects = Array.isArray(scene.objects) ? (scene.objects as Array<Record<string, unknown>>) : []
  const imageObjects = objects.filter(
    (obj) =>
      obj &&
      typeof obj === 'object' &&
      typeof obj.image === 'string' &&
      !String(obj.image).startsWith('models/util/') &&
      !isLikelyMaskOrHelper(String(obj.image)),
  )
  if (imageObjects.length <= 1) return null

  let canvasWidth = 1920
  let canvasHeight = 1080

  const layers: { x: number; y: number; width: number; height: number; rgba: Uint8Array }[] = []
  const layerSources: string[] = []
  let hasLargeBase = false

  for (const obj of objects) {
    if (!obj.image || typeof obj.image !== 'string' || obj.image.startsWith('models/util/')) continue
    if (obj.visible && typeof obj.visible === 'object' && (obj.visible as { value?: unknown }).value === false) continue
    if (typeof obj.name === 'string') {
      const nameLower = obj.name.toLowerCase()
      if (
        nameLower.includes('black') ||
        nameLower.includes('len') ||
        nameLower.includes('util') ||
        nameLower.includes('flare') ||
        nameLower.includes('blend') ||
        nameLower === 'sun' ||
        nameLower === 'sun2'
      ) {
        continue
      }
    }
    if (isLikelyMaskOrHelper(obj.image)) continue

    const modelJson = access.readJson(obj.image) as Record<string, unknown> | null
    if (!modelJson || typeof modelJson.material !== 'string') continue
    const matJson = access.readJson(modelJson.material) as Record<string, unknown> | null
    if (!matJson || !Array.isArray(matJson.passes)) continue
    const passes = matJson.passes as Array<{ textures?: string[] }>
    const texName = passes[0]?.textures?.[0]
    if (!texName || isLikelyMaskOrHelper(texName)) continue

    const texPath = access.listTexPaths().find(
      (p) =>
        p.toLowerCase() === texName.toLowerCase() ||
        p.toLowerCase() === ('materials/' + texName + '.tex').toLowerCase() ||
        p.toLowerCase() === (texName + '.tex').toLowerCase() ||
        p.toLowerCase().endsWith('/' + texName.toLowerCase() + '.tex') ||
        p.toLowerCase().endsWith('/' + texName.toLowerCase()),
    )
    if (!texPath) continue
    const file = access.readFile(texPath)
    if (!file) continue

    let decoded: DecodedImage | null = null
    try {
      decoded = decodeTex(file.bytes)
    } catch {
      continue
    }
    if (!decoded || decoded.width < 64 || decoded.height < 64) continue

    if (decoded.width >= 1280 || decoded.height >= 720) {
      hasLargeBase = true
    }

    if (decoded.width > canvasWidth || decoded.height > canvasHeight) {
      canvasWidth = Math.max(canvasWidth, decoded.width)
      canvasHeight = Math.max(canvasHeight, decoded.height)
    }

    let ox = 0
    let oy = 0
    if (typeof modelJson.cropoffset === 'string') {
      const parts = modelJson.cropoffset.trim().split(/\s+/)
      ox = parseFloat(parts[0]) || 0
      oy = parseFloat(parts[1]) || 0
    }

    const centerX = canvasWidth / 2 + ox
    const centerY = canvasHeight / 2 - oy
    const startX = Math.round(centerX - decoded.width / 2)
    const startY = Math.round(centerY - decoded.height / 2)

    layers.push({ x: startX, y: startY, width: decoded.width, height: decoded.height, rgba: decoded.rgba })
    layerSources.push(texPath)
  }

  if (imageObjects.length >= 3 && layers.length <= 1) {
    throw new Error('pkg: multi-layer scene composition requires full preview render')
  }
  if (layers.length <= 1 || !hasLargeBase) return null
  if (topCandidate !== null && !layerSources.some((p) => p.toLowerCase() === topCandidate.toLowerCase())) {
    // The scene's intended main texture never decoded; a composite built
    // from the leftover layers would be a broken frame (#906).
    return null
  }

  const canvas = new Uint8Array(canvasWidth * canvasHeight * 4)
  for (const layer of layers) {
    for (let y = 0; y < layer.height; y++) {
      const cy = layer.y + y
      if (cy < 0 || cy >= canvasHeight) continue
      for (let x = 0; x < layer.width; x++) {
        const cx = layer.x + x
        if (cx < 0 || cx >= canvasWidth) continue
        const si = (y * layer.width + x) * 4
        const di = (cy * canvasWidth + cx) * 4
        const sa = layer.rgba[si + 3] / 255
        if (sa <= 0) continue
        const da = canvas[di + 3] / 255
        const outA = sa + da * (1 - sa)
        if (outA <= 0) continue
        canvas[di] = Math.round((layer.rgba[si] * sa + canvas[di] * da * (1 - sa)) / outA)
        canvas[di + 1] = Math.round((layer.rgba[si + 1] * sa + canvas[di + 1] * da * (1 - sa)) / outA)
        canvas[di + 2] = Math.round((layer.rgba[si + 2] * sa + canvas[di + 2] * da * (1 - sa)) / outA)
        canvas[di + 3] = Math.round(outA * 255)
      }
    }
  }

  return {
    width: canvasWidth,
    height: canvasHeight,
    png: Buffer.from(encodePng(canvasWidth, canvasHeight, canvas)),
    texturePath: 'composite(' + String(layers.length) + ' layers)',
  }
}

/** Shared scene pipeline over one access layer; label prefixes error text. */
function extractSceneMainImageVia(access: SceneAccess, label: string): SceneMainImage {
  let scene = access.readJson('scene.json') as Record<string, unknown> | null
  if (!scene) {
    const project = access.readJson('project.json') as { file?: string } | null
    if (project && typeof project.file === 'string' && project.file.endsWith('.json')) {
      scene = access.readJson(project.file) as Record<string, unknown> | null
    }
  }
  if (!scene || !Array.isArray(scene.objects)) {
    throw new Error(label + ': scene.json not found or invalid')
  }

  // The scene's declared viewport (e.g. 1920x1080). Scene textures are often
  // authored larger or square; the final frame must match the projection so
  // the wallpaper keeps its aspect on widescreen displays.
  const projection = sceneProjectionSize(scene)

  // 3D model scenes use UV maps on 3D meshes rather than 2D desktop backgrounds
  const has3dModels = (scene.objects as Array<{ model?: unknown }>).some(
    (obj) => obj && typeof obj === 'object' && typeof obj.model === 'string' && obj.model.length > 0,
  )
  if (has3dModels) {
    throw new Error(label + ': 3D scene cannot be extracted as 2D frame')
  }

  const rawCandidates: string[] = []
  for (const obj of scene.objects as unknown[]) {
    if (obj && typeof obj === 'object' && typeof (obj as { image?: unknown }).image === 'string') {
      rawCandidates.push(...collectImageObjectTextures(obj as Record<string, unknown>, access.readJson))
    }
  }
  const allCandidates: { path: string; fromObject: boolean }[] = []
  for (const p of rawCandidates) {
    if (!isLikelyMaskOrHelper(p) && !allCandidates.some((c) => c.path.toLowerCase() === p.toLowerCase())) {
      allCandidates.push({ path: p, fromObject: true })
    }
  }
  for (const p of access.listTexPaths()) {
    if (!isLikelyMaskOrHelper(p) && !allCandidates.some((c) => c.path.toLowerCase() === p.toLowerCase())) {
      allCandidates.push({ path: p, fromObject: false })
    }
  }
  const ranked = allCandidates.map(({ path, fromObject }) => {
    let area = 0
    try {
      const file = access.readFile(path)
      const info = file ? parseTex(file.bytes) : null
      if (info) area = info.width * info.height
    } catch {
      // ignore
    }
    const score = getTextureScore(path) + (fromObject ? 100 : 0)
    return { path, score, area }
  })
  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return b.area - a.area
  })
  const candidates = ranked.map((r) => r.path)
  if (candidates.length === 0) {
    throw new Error(label + ': no texture candidates found')
  }

  // The top-ranked candidate is the intended main texture: the composite
  // layer must include it, and the decode loop must stop on its unsupported
  // format, or the pipeline would emit a partial frame as the wallpaper.
  const composite = tryCompositeMultiLayerScene(scene, access, candidates[0] ?? null)
  if (composite !== null) {
    return composite
  }
  let lastError: unknown = null
  for (const path of candidates) {
    if (isLikelyMaskOrHelper(path)) continue
    const file = access.readFile(path)
    if (!file) {
      // Keep a previously recorded decode error as the more truthful one: a
      // later candidate missing from the package must not mask why the best
      // candidate failed to decode (#752).
      if (lastError === null) {
        lastError = new Error(label + ": texture '" + path + "' not found in " + (label === 'pkg' ? 'package' : 'directory'))
      }
      continue
    }
    try {
      const parsed = parseTexInternal(file.bytes)
      if (parsed.isVideoMp4) {
        throw new Error('tex: video mp4 textures cannot be decoded to a static frame')
      }
      const mip0 = parsed.mipmaps[0]
      if (isPngBuffer(mip0.bytes)) {
        const png = Buffer.from(mip0.bytes)
        if (projection) {
          const decoded = decodePngToRgba(mip0.bytes)
          const cropped = cropToProjection(decoded.rgba, decoded.width, decoded.height, projection)
          if (cropped) {
            return {
              width: cropped.width,
              height: cropped.height,
              png: encodePng(cropped.width, cropped.height, cropped.rgba),
              texturePath: file.path,
            }
          }
        }
        return { width: mip0.width, height: mip0.height, png, texturePath: file.path }
      }
      const { width, height, rgba } = decodeTex(file.bytes)
      if (!hasContent(rgba, width, height)) {
        lastError = new Error(label + ": texture '" + path + "' is a shader mask or partial layer")
        continue
      }
      const cropped = cropToProjection(rgba, width, height, projection)
      if (cropped) {
        return { width: cropped.width, height: cropped.height, png: encodePng(cropped.width, cropped.height, cropped.rgba), texturePath: file.path }
      }
      return { width, height, png: encodePng(width, height, rgba), texturePath: file.path }
    } catch (err) {
      // The top-ranked candidate is the intended main texture: a
      // known-but-undecodable format must stop here so the frame route
      // reports it and the client falls back to the author preview instead
      // of substituting a lower-ranked partial layer as the frame (#906).
      if (err instanceof TexUnsupportedError && path === candidates[0]) throw err
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(label + ': no decodable texture found')
}

export function extractSceneMainImage(pkgData: Uint8Array): SceneMainImage {
  return extractSceneMainImageVia(pkgSceneAccess(pkgData), 'pkg')
}

/**
 * Loose-scene variant of extractSceneMainImage: decode the main texture of a
 * scene project directory that ships scene.json and textures as plain files
 * instead of a packed scene.pkg (#521).
 */
export function extractSceneMainImageFromDir(dir: string): SceneMainImage {
  return extractSceneMainImageVia(dirSceneAccess(dir), 'scene')
}

/** Return an MP4 payload embedded in a TEX mipmap/file, if present. */
function embeddedMp4Bytes(raw: Uint8Array): Uint8Array | null {
  for (let i = 0; i < 200 && i + 8 <= raw.length; i++) {
    if (raw[i] !== 0x66 || raw[i + 1] !== 0x74 || raw[i + 2] !== 0x79 || raw[i + 3] !== 0x70) continue
    const ftypOffset = i - 4
    if (ftypOffset >= 0 && ftypOffset < raw.length) return raw.slice(ftypOffset)
  }
  return null
}

/** Find and extract the primary MP4 video embedded inside a scene's .tex textures. */
function extractSceneVideoVia(access: SceneAccess): Uint8Array | null {
  const candidates: { path: string; score: number; bytes: Uint8Array }[] = []
  for (const path of access.listTexPaths()) {
    const file = access.readFile(path)
    if (!file) continue
    const bytes = embeddedMp4Bytes(file.bytes)
    if (bytes !== null) {
      candidates.push({ path, score: getTextureScore(path), bytes })
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].bytes
}

export function extractSceneVideo(pkgData: Uint8Array): Uint8Array | null {
  return extractSceneVideoVia(pkgSceneAccess(pkgData))
}

export function extractSceneVideoFromDir(dir: string): Uint8Array | null {
  return extractSceneVideoVia(dirSceneAccess(dir))
}

export function hasSceneVideo(pkgData: Uint8Array): boolean {
  try {
    return extractSceneVideo(pkgData) !== null
  } catch {
    return false
  }
}

export function hasSceneVideoFromDir(dir: string): boolean {
  try {
    return extractSceneVideoFromDir(dir) !== null
  } catch {
    return false
  }
}

export interface SceneManifestLayer {
  name: string
  texUrl: string
  x: number
  y: number
  w: number
  h: number
  alpha?: number
  /** Z rotation in radians (2D scene object angles). */
  angle?: number
  /** UV sub-rect [u0, v0, u1, v1] sampled from the texture (cropoffset only;
   *  power-of-two padding is already cropped away at decode time). */
  uvCrop?: [number, number, number, number]
  /** Material shader name (genericimage default; flowimage gets its own pass). */
  shader?: string
  /** All pass textures resolved (flowimage: mask + content layers). */
  texUrls?: string[]
  /** constantshadervalues numerics (flow Speed/Amount/Bright etc.). */
  nums?: Record<string, number>
  /** Resolved color user properties, keyed by shader uniform name. */
  userColors?: Record<string, [number, number, number]>
  isGround?: boolean
  isReflection?: boolean
  /** Water surface height as screen v (0 at the top); player falls back to its
   *  legacy default when absent. */
  waterLine?: number
  sway?: number
  swaySpeed?: number
  /** Real-time period selected by an embedded WE time controller. */
  timePeriod?: 'morning' | 'day' | 'dusk' | 'night' | 'manual'
  /** An embedded MP4 texture served directly to the scene player. */
  videoUrl?: string
}

export interface DecodedMesh {
  vCount: number
  iCount: number
  pos: Float32Array
  norm: Float32Array
  uv: Float32Array
  /** Optional second UV channel used by baked lightmaps. */
  uv2?: Float32Array
  /** u16 for meshes with <= 65535 vertices, u32 above that (mdlv >= 23). */
  indices: Uint16Array | Uint32Array
  materialPath?: string
}

export interface SceneManifestMesh {
  vCount: number
  iCount: number
  posB64: string
  normB64: string
  uvB64: string
  /** Optional second UV channel used by baked lightmaps. */
  uv2B64?: string
  indicesB64: string
  /** True when indicesB64 decodes to Uint32Array (mesh has > 65535 vertices). */
  idx32?: boolean
  texUrl?: string
  /** Repeat the base texture when authored UVs leave the [0,1] range. */
  repeatBase?: boolean
  materialPath?: string
  /** WE material shader name (passes[0].shader), e.g. 'ricepodjet'. */
  shader?: string
  /** WE material blending: additive passes render into the glow queue. */
  additive?: boolean
  /** WE material depthtesting disabled (orbital glows, skybox passes). */
  noDepthTest?: boolean
  /** WE material depthwriting disabled. */
  noDepthWrite?: boolean
  /** Resolved user-property tint color (usershadervalues -> project property). */
  tint?: [number, number, number]
  /** Second tint (usershadervalues entry mapped to the 'tint2' uniform). */
  tint2?: [number, number, number]
  /** Second texture of the material pass (e.g. normal map or bg overlay). */
  texUrl2?: string
  /** Baked lightmap texture selected from the material combo texture slots. */
  lightmapUrl?: string
  /** WE material blending 'translucent' (alpha-blended overlay). */
  translucent?: boolean
  /** GRADIENT_FADE combo: alpha fades towards the top/bottom edges. */
  gradFade?: boolean
  /** All resolved color user properties, keyed by shader uniform name. */
  userColors?: Record<string, [number, number, number]>
  /** All resolved numeric user properties, keyed by shader uniform name. */
  userNums?: Record<string, number>
  color?: [number, number, number]
}

/** A fullscreen image layer inside a 3D scene (model json with fullscreen: true). */
export interface SceneManifestBgLayer {
  name: string
  shader?: string
  texUrl?: string
  userColors?: Record<string, [number, number, number]>
  userNums?: Record<string, number>
}

/** A 3D scene sprite object (scene.json `sprite` key), rendered as a camera-facing additive billboard. */
export interface SceneManifestSprite {
  name: string
  texUrl?: string
  origin: [number, number, number]
  scale: [number, number, number]
}

/** A 3D scene particle system (scene.json `particle` key), simplified to a sphere-shell emitter. */
export interface SceneManifestParticles3d {
  name: string
  texUrl?: string
  origin: [number, number, number]
  rate: number
  maxCount: number
  lifeMin: number
  lifeMax: number
  sizeMin: number
  sizeMax: number
  distMin: number
  distMax: number
  velMin: [number, number, number]
  velMax: [number, number, number]
  colorMin: [number, number, number]
  colorMax: [number, number, number]
}

export interface SceneManifestModel {
  name: string
  origin: [number, number, number]
  angles: [number, number, number]
  scale: [number, number, number]
  meshes: SceneManifestMesh[]
}

export interface SceneManifestPointLight {
  origin: [number, number, number]
  color: [number, number, number]
  radius: number
}

export interface SceneManifestCamera {
  eye: [number, number, number]
  center: [number, number, number]
  up: [number, number, number]
  fov: number
}

export interface SceneManifest {
  width: number
  height: number
  is3D?: boolean
  clearColor?: [number, number, number]
  carBodyColor?: [number, number, number]
  carStripesColor?: [number, number, number]
  camera?: SceneManifestCamera
  ambientColor?: [number, number, number]
  skyLightColor?: [number, number, number]
  pointLights?: SceneManifestPointLight[]
  /** Scene declares a camera but no animation paths: fixed viewpoint. */
  cameraStatic?: boolean
  cameraPaths?: Array<{
    d: number
    e0: [number, number, number]
    c0: [number, number, number]
    u0: [number, number, number]
    e1: [number, number, number]
    c1: [number, number, number]
    u1: [number, number, number]
  }>
  models?: SceneManifestModel[]
  sprites?: SceneManifestSprite[]
  particles3d?: SceneManifestParticles3d[]
  bgLayers?: SceneManifestBgLayer[]
  hasMeteors?: boolean
  hasFireflies?: boolean
  meteorTex?: string
  sparkleTex?: string
  /** Scene contains WE embedded scripts the browser renderer cannot execute. */
  scripted?: boolean
  /** Author-configured local-hour boundaries for real-time scene switching. */
  timeSchedule?: { morning: number; day: number; dusk: number; night: number }
  layers: SceneManifestLayer[]
}

// Vertex layout bits of the MDLV mesh flag (matches the open-source
// open-wallpaper-engine MdlParser). Position (12 bytes) is always present;
// every other attribute is gated by its bit. UV2 implies an extra UV slot
// in addition to the regular one.
const MDL_FLAG_NORMAL = 0x00000002
const MDL_FLAG_TANGENT = 0x00000004
const MDL_FLAG_UV = 0x00000008
const MDL_FLAG_UV2 = 0x00000020
const MDL_FLAG_EXTRA4 = 0x00010000
const MDL_FLAG_SKIN_BLEND = 0x00800000
const MDL_FLAG_SKIN_WEIGHT = 0x01000000

/** Per-vertex byte stride for a mesh flag bitset; 0 when the flag is unusable. */
function mdlVertexStride(flag: number): number {
  let s = 12
  if (flag & MDL_FLAG_NORMAL) s += 12
  if (flag & MDL_FLAG_TANGENT) s += 16
  if (flag & MDL_FLAG_EXTRA4) s += 4
  if (flag & MDL_FLAG_SKIN_BLEND) s += 16
  if (flag & MDL_FLAG_SKIN_WEIGHT) s += 16
  if (flag & (MDL_FLAG_UV | MDL_FLAG_UV2)) s += 8
  if (flag & MDL_FLAG_UV2) s += 8
  return s
}

function readMdlCString(buf: Uint8Array, p: number): { str: string; next: number } | null {
  let end = p
  while (end < buf.length && buf[end] !== 0) end++
  if (end >= buf.length) return null
  let str = ''
  for (let i = p; i < end; i++) str += String.fromCharCode(buf[i])
  return { str, next: end + 1 }
}

/**
 * Parse a Wallpaper Engine MDLV .mdl file into renderable meshes.
 *
 * Structured layout (verified against MDLV0014+ files and the
 * open-wallpaper-engine parser):
 *   "MDLV####\0" tag, u32 mdl_flag, u32 skin_count, u32 mesh_count
 *   per mesh: skin_count x cstr material path, u32 flag_a (extra u32 when 2),
 *     aabb (6 f32, mdlv >= 17), u32 mesh_flag (mdlv > 14, else header flag),
 *     u32 vertex_bytes, vertices, u32 indices_bytes, triangle indices
 *     (u16, or u32 when mdlv >= 23 and vertex_count > 65535)
 * Trailing MDLS/MDAT/MDLA/MDMP/MDLE puppet/animation blocks are not needed
 * for static rendering and are ignored; skinned meshes stay in bind pose.
 */
export function parseMdl(buf: Uint8Array): DecodedMesh[] {
  if (buf.length < 21) return []
  const magic = String.fromCharCode(...buf.slice(0, 4))
  if (magic !== 'MDLV') return []
  const mdlv = parseInt(String.fromCharCode(...buf.slice(4, 8)), 10)
  if (!Number.isFinite(mdlv) || mdlv < 1) return []

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 9 // version tag is 8 chars + NUL
  const mdlFlag = dv.getUint32(p, true); p += 4
  const skinCount = dv.getUint32(p, true); p += 4
  const meshCount = dv.getUint32(p, true); p += 4
  if (skinCount < 1 || skinCount > 64 || meshCount < 1 || meshCount > 1024) return []

  const meshes: DecodedMesh[] = []
  for (let m = 0; m < meshCount; m++) {
    const materials: string[] = []
    for (let s = 0; s < skinCount; s++) {
      const cstr = readMdlCString(buf, p)
      if (!cstr) return meshes
      materials.push(cstr.str)
      p = cstr.next
    }
    if (p + 8 > buf.length) return meshes
    const flagA = dv.getUint32(p, true); p += 4
    if (flagA === 2) p += 4
    if (mdlv >= 17) p += 24 // aabb min/max
    let meshFlag = mdlFlag
    if (mdlv > 14) {
      if (p + 8 > buf.length) return meshes
      meshFlag = dv.getUint32(p, true); p += 4
    }
    const vBytes = dv.getUint32(p, true); p += 4
    const stride = mdlVertexStride(meshFlag)
    if (vBytes < stride || vBytes > 100000000 || vBytes % stride !== 0 || p + vBytes + 4 > buf.length) return meshes
    const vCount = vBytes / stride

    const pos = new Float32Array(vCount * 3)
    const norm = new Float32Array(vCount * 3)
    const uv = new Float32Array(vCount * 2)
    const uv2 = (meshFlag & MDL_FLAG_UV2) !== 0 ? new Float32Array(vCount * 2) : undefined
    const hasNorm = (meshFlag & MDL_FLAG_NORMAL) !== 0
    const hasUv = (meshFlag & (MDL_FLAG_UV | MDL_FLAG_UV2)) !== 0
    for (let v = 0; v < vCount; v++) {
      // Attribute order in the file: pos, normal, tangent, extra4,
      // blend_indices (4 x u32), blend_weights (4 x f32), uv, uv2.
      pos[v * 3] = dv.getFloat32(p, true)
      pos[v * 3 + 1] = dv.getFloat32(p + 4, true)
      pos[v * 3 + 2] = dv.getFloat32(p + 8, true)
      p += 12
      if (hasNorm) {
        norm[v * 3] = dv.getFloat32(p, true)
        norm[v * 3 + 1] = dv.getFloat32(p + 4, true)
        norm[v * 3 + 2] = dv.getFloat32(p + 8, true)
        p += 12
      } else {
        norm[v * 3 + 1] = 1
      }
      if (meshFlag & MDL_FLAG_TANGENT) p += 16
      if (meshFlag & MDL_FLAG_EXTRA4) p += 4
      if (meshFlag & MDL_FLAG_SKIN_BLEND) p += 16
      if (meshFlag & MDL_FLAG_SKIN_WEIGHT) p += 16
      if (hasUv) {
        uv[v * 2] = dv.getFloat32(p, true)
        uv[v * 2 + 1] = dv.getFloat32(p + 4, true)
        p += 8
      }
      if (uv2) {
        uv2[v * 2] = dv.getFloat32(p, true)
        uv2[v * 2 + 1] = dv.getFloat32(p + 4, true)
        p += 8
      }
    }

    if (p + 4 > buf.length) return meshes
    const iBytes = dv.getUint32(p, true); p += 4
    if (iBytes < 2 || iBytes > 60000000 || p + iBytes > buf.length) return meshes
    // mdlv >= 23 switches to u32 indices once a mesh passes 65535 vertices.
    const useU32 = vCount > 0xffff && (mdlv >= 23 || iBytes % 12 === 0)
    const iCount = Math.floor(iBytes / (useU32 ? 4 : 2))
    let indices: Uint16Array | Uint32Array
    if (useU32) {
      const arr = new Uint32Array(iCount)
      for (let i = 0; i < iCount; i++) arr[i] = dv.getUint32(p + i * 4, true)
      indices = arr
    } else {
      const arr = new Uint16Array(iCount)
      for (let i = 0; i < iCount; i++) arr[i] = dv.getUint16(p + i * 2, true)
      indices = arr
    }
    p += iBytes

    meshes.push({ vCount, iCount, pos, norm, uv, uv2, indices, materialPath: materials[0] })
  }
  return meshes
}

function containsEmbeddedScript(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (typeof record.script === 'string' && record.script.trim() !== '') return true
  }
  return Object.values(value).some(child => containsEmbeddedScript(child, seen))
}

function buildSceneManifestVia(access: SceneAccess, token: string, projectOverride?: unknown): SceneManifest | null {
  let scene = access.readJson('scene.json') as Record<string, unknown> | null
  const project = (projectOverride && typeof projectOverride === 'object' ? projectOverride : access.readJson('project.json')) as Record<string, unknown> | null
  if (!scene && project && typeof project.file === 'string' && project.file.endsWith('.json')) {
    scene = access.readJson(project.file) as Record<string, unknown> | null
  }
  if (!scene || !Array.isArray(scene.objects)) return null

  const general = scene.general as {
    ambientcolor?: unknown
    clearcolor?: unknown
    fov?: unknown
    skylightcolor?: unknown
    orthogonalprojection?: { width?: number; height?: number }
  } | undefined
  const projW = general?.orthogonalprojection?.width
  const projH = general?.orthogonalprojection?.height
  // Negative / NaN / non-numeric projection values must not leak into the
  // player's viewport math (negative viewports render black).
  const width = typeof projW === 'number' && Number.isFinite(projW) && projW > 0 ? Math.floor(projW) : 3840
  const height = typeof projH === 'number' && Number.isFinite(projH) && projH > 0 ? Math.floor(projH) : 2160
  const resourceBase = '/api/skin-center/we/scene-resource/' + token + '/'

  const manifest: SceneManifest = {
    width,
    height,
    hasMeteors: false,
    hasFireflies: false,
    scripted: containsEmbeddedScript(scene),
    layers: [],
  }

  const allTex = access.listTexPaths()
  const parseVec3 = (val: unknown, def: [number, number, number]): [number, number, number] => {
    if (typeof val === 'string') {
      const parts = val.trim().split(/\s+/).map(parseFloat)
      if (parts.length >= 3 && !parts.some(isNaN)) return [parts[0], parts[1], parts[2]]
    }
    return def
  }

  manifest.clearColor = parseVec3(general?.clearcolor, [0.1, 0.1, 0.15])
  manifest.ambientColor = parseVec3(general?.ambientcolor, [0, 0, 0])
  manifest.skyLightColor = parseVec3(general?.skylightcolor, [0, 0, 0])
  const pointLights = (scene.objects as Array<Record<string, unknown>>)
    .filter((obj) => obj.light === 'point')
    .slice(0, 4)
    .map((obj) => {
      const intensity = typeof obj.intensity === 'number' && Number.isFinite(obj.intensity)
        ? Math.max(0, obj.intensity)
        : 1
      const color = parseVec3(obj.color, [1, 1, 1])
      return {
        origin: parseVec3(obj.origin, [0, 0, 0]),
        color: color.map((channel) => channel * intensity) as [number, number, number],
        radius: typeof obj.radius === 'number' && Number.isFinite(obj.radius) && obj.radius > 0 ? obj.radius : 1,
      }
    })
  if (pointLights.length > 0) manifest.pointLights = pointLights

  const props = (project?.general as Record<string, unknown> | undefined)?.properties as Record<string, Record<string, unknown>> | undefined
  const propertyValue = (name: string): unknown => props?.[name]?.value
  const boundedHour = (name: string, fallback: number): number => {
    const raw = propertyValue(name)
    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
    return Number.isFinite(numeric) && numeric >= 0 && numeric < 24 ? numeric : fallback
  }
  const timeVarying = propertyValue('timevarying') === true
  const timePeriods = new Set(['morning', 'day', 'dusk', 'night', 'mddn'])
  if (timeVarying && (scene.objects as Array<Record<string, unknown>>).some((obj) => timePeriods.has(String(obj.name).toLowerCase()))) {
    manifest.timeSchedule = {
      morning: boundedHour('morningtime', 4),
      day: boundedHour('daytime', 8),
      dusk: boundedHour('dusktime', 17),
      night: boundedHour('nighttime', 20),
    }
  }
  if (props?.schemecolor?.value && typeof props.schemecolor.value === 'string') {
    manifest.clearColor = parseVec3(props.schemecolor.value, [0.57, 0.71, 0.81])
  }
  if (props?.carbodycolor?.value && typeof props.carbodycolor.value === 'string') {
    manifest.carBodyColor = parseVec3(props.carbodycolor.value, [1, 0, 0])
  }
  if (props?.carstripescolor?.value && typeof props.carstripescolor.value === 'string') {
    manifest.carStripesColor = parseVec3(props.carstripescolor.value, [0, 0, 0])
  }

  const is3D = Boolean(scene.camera) || (scene.objects as Array<Record<string, unknown>>).some((o) => typeof o.model === 'string' && o.model.endsWith('.mdl'))
  if (is3D) {
    manifest.is3D = true
    const cam = scene.camera as Record<string, unknown> | undefined
    let eye = parseVec3(cam?.eye, [0, 1.5, 4.0])
    let center = parseVec3(cam?.center, [0, 0, 0])
    let up = parseVec3(cam?.up, [0, 1, 0])
    if (cam?.paths && Array.isArray(cam.paths) && typeof cam.paths[0] === 'string') {
      const pathJson = access.readJson(cam.paths[0]) as { paths?: Array<{ duration?: number; transforms?: Array<{ eye?: string; center?: string; up?: string }> }> } | null
      const firstTf = pathJson?.paths?.[0]?.transforms?.[0]
      if (firstTf) {
        if (firstTf.eye) eye = parseVec3(firstTf.eye, eye)
        if (firstTf.center) center = parseVec3(firstTf.center, center)
        if (firstTf.up) up = parseVec3(firstTf.up, up)
      }
      // Extract all camera path segments for animation
      if (pathJson?.paths && pathJson.paths.length > 0) {
        manifest.cameraPaths = []
        for (const seg of pathJson.paths) {
          if (!seg.transforms || seg.transforms.length < 2) continue
          if (typeof seg.duration !== 'number' || !Number.isFinite(seg.duration) || seg.duration <= 0) continue
          const t0 = seg.transforms[0]
          const t1 = seg.transforms[seg.transforms.length - 1]
          manifest.cameraPaths.push({
            d: seg.duration,
            e0: parseVec3(t0.eye, eye) as [number, number, number],
            c0: parseVec3(t0.center, center) as [number, number, number],
            u0: parseVec3(t0.up, up) as [number, number, number],
            e1: parseVec3(t1.eye, eye) as [number, number, number],
            c1: parseVec3(t1.center, center) as [number, number, number],
            u1: parseVec3(t1.up, up) as [number, number, number],
          })
        }
        if (manifest.cameraPaths.length === 0) delete manifest.cameraPaths
      }
    }
    const cameraFov = cam?.fov
    const generalFov = general?.fov
    const validFov = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 180
    manifest.camera = {
      eye,
      center,
      up,
      // Wallpaper Engine serializes the projection FOV under scene.general;
      // a few older projects put it on the camera itself. Prefer the explicit
      // camera value, then the authored general value, then WE's 50-degree
      // default. Falling back to 45 over-zooms official scenes such as Arsenal.
      fov: validFov(cameraFov) ? cameraFov : validFov(generalFov) ? generalFov : 50,
    }
    // A scene camera without usable paths is a fixed viewpoint, not an orbit.
    if (cam && !(manifest.cameraPaths && manifest.cameraPaths.length > 0)) {
      manifest.cameraStatic = true
    }
    manifest.models = []
    for (const obj of scene.objects as Array<Record<string, unknown>>) {
      if (typeof obj.model !== 'string' || !obj.model.endsWith('.mdl')) continue
      const mdlFile = access.readFile(obj.model)
      if (!mdlFile) continue
      const decodedMeshes = parseMdl(mdlFile.bytes)
      if (decodedMeshes.length === 0) continue

      const baseName = obj.model.split('/').pop()?.replace(/\.mdl$/i, '')

      // Resolve a WE material texture reference ('ricepod/jet') to a tex path.
      const resolveTexRef = (ref: string): string | undefined => {
        const want = ref.toLowerCase().replace(/\.tex$/i, '')
        return allTex.find((p) => {
          const lower = p.toLowerCase().replace(/\.tex$/i, '')
          return lower === want || lower === 'materials/' + want || lower.endsWith('/' + want)
        })
      }

      const meshes: SceneManifestMesh[] = decodedMeshes.map((m) => {
        let subTex: string | undefined
        let shader: string | undefined
        let additive: boolean | undefined
        let noDepthTest: boolean | undefined
        let noDepthWrite: boolean | undefined
        let tint: [number, number, number] | undefined
        let tint2: [number, number, number] | undefined
        let texPath2: string | undefined
        let lightmapPath: string | undefined
        let translucent: boolean | undefined
        let gradFade: boolean | undefined
        let userColors: Record<string, [number, number, number]> | undefined
        let userNums: Record<string, number> | undefined
        if (m.materialPath) {
          // Material JSON is authoritative: shader, blending, depth flags and
          // the exact texture of the first pass.
          try {
            const matJsonRaw = access.readJson(m.materialPath) as Record<string, unknown> | null
            const pass0 = Array.isArray(matJsonRaw?.passes)
              ? (matJsonRaw.passes as Array<Record<string, unknown>>)[0]
              : undefined
            if (pass0) {
              if (typeof pass0.shader === 'string') shader = pass0.shader
              if (pass0.blending === 'additive') additive = true
              if (pass0.blending === 'translucent') translucent = true
              const combos = pass0.combos as Record<string, unknown> | undefined
              if (combos && combos.GRADIENT_FADE) gradFade = true
              const dt = pass0.depthtesting ?? pass0.depthtest
              const dw = pass0.depthwriting ?? pass0.depthwrite
              if (dt === 'disabled') noDepthTest = true
              if (dw === 'disabled') noDepthWrite = true
              if (Array.isArray(pass0.textures) && pass0.textures.length > 0) {
                const texturePaths = pass0.textures.map((texture) => resolveTexRef(String(texture)))
                subTex = texturePaths[0]
                if (texturePaths.length > 1) texPath2 = texturePaths[1]
                if (combos?.lightmap) {
                  // generic.frag places the lightmap after the optional normal
                  // map. Preserve its dedicated role instead of treating it as
                  // an arbitrary second overlay texture.
                  lightmapPath = texturePaths[combos?.normalmap ? 2 : 1]
                }
              }
              // usershadervalues bind WE user properties (schemecolor etc.)
              // to shader uniforms; resolve colors and numbers at build time.
              const usv = pass0.usershadervalues as Record<string, unknown> | undefined
              if (usv) {
                for (const [key, uniformName] of Object.entries(usv)) {
                  if (typeof uniformName !== 'string') continue
                  const propDef = props?.[key]
                  const pv = propDef?.value
                  if (typeof pv === 'string') {
                    const col = parseVec3(pv, [1, 1, 1])
                    if (uniformName === 'tint') tint = col
                    else if (uniformName === 'tint2') tint2 = col
                    userColors = userColors ?? {}
                    userColors[uniformName] = col
                  } else if (typeof pv === 'number' && Number.isFinite(pv)) {
                    userNums = userNums ?? {}
                    userNums[uniformName] = pv
                  }
                }
              }
              // constantshadervalues carry literal numeric shader constants.
              const csv = pass0.constantshadervalues as Record<string, unknown> | undefined
              if (csv) {
                for (const [key, val] of Object.entries(csv)) {
                  if (typeof val === 'number' && Number.isFinite(val)) {
                    userNums = userNums ?? {}
                    userNums[key] = val
                  }
                }
              }
            }
          } catch { /* material JSON not readable */ }
          if (!subTex) {
            // materialPath = 'materials/xxx/name.json' -> look for 'name.tex' in allTex
            const matBaseName = m.materialPath.replace(/\.json$/i, '').split('/').pop()
            if (matBaseName) {
              subTex = allTex.find((p) => {
                const lower = p.toLowerCase()
                return lower.includes(matBaseName.toLowerCase()) && !lower.includes('normal') && !lower.includes('mask')
              })
            }
          }
        }
        // Fallback: match by model baseName
        if (!subTex && baseName) {
          subTex = allTex.find((p) => p.toLowerCase().includes(baseName.toLowerCase()) && !p.toLowerCase().includes('normal') && !p.toLowerCase().includes('mask'))
        }
        return {
          vCount: m.vCount,
          iCount: m.iCount,
          posB64: Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength).toString('base64'),
          normB64: Buffer.from(m.norm.buffer, m.norm.byteOffset, m.norm.byteLength).toString('base64'),
          uvB64: Buffer.from(m.uv.buffer, m.uv.byteOffset, m.uv.byteLength).toString('base64'),
          uv2B64: m.uv2 ? Buffer.from(m.uv2.buffer, m.uv2.byteOffset, m.uv2.byteLength).toString('base64') : undefined,
          indicesB64: Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength).toString('base64'),
          idx32: m.indices instanceof Uint32Array || undefined,
          texUrl: subTex ? resourceBase + subTex : undefined,
          repeatBase: m.uv.some((value) => value < 0 || value > 1) || undefined,
          materialPath: m.materialPath,
          shader,
          additive,
          noDepthTest,
          noDepthWrite,
          tint,
          tint2,
          texUrl2: texPath2 ? resourceBase + texPath2 : undefined,
          lightmapUrl: lightmapPath ? resourceBase + lightmapPath : undefined,
          translucent,
          gradFade,
          userColors,
          userNums,
        }
      })

      manifest.models.push({
        name: typeof obj.name === 'string' ? obj.name : 'model',
        origin: parseVec3(obj.origin, [0, 0, 0]),
        angles: parseVec3(obj.angles, [0, 0, 0]),
        scale: parseVec3(obj.scale, [1, 1, 1]),
        meshes,
      })
    }

    // Sprite objects (billboard glows like the sun) and 3D particle systems
    // (starfield streaks) ride along with the 3D scene.
    for (const obj of scene.objects as Array<Record<string, unknown>>) {
      // Fullscreen image layers (cloudsbg etc.) render as clip-space quads
      // with their material shader behind everything else.
      if (typeof obj.image === 'string' && !obj.image.startsWith('models/util/')) {
        const layerJson = access.readJson(obj.image) as Record<string, unknown> | null
        if (layerJson?.fullscreen === true && typeof layerJson.material === 'string') {
          const matJson = access.readJson(layerJson.material) as Record<string, unknown> | null
          const pass0 = Array.isArray(matJson?.passes)
            ? (matJson.passes as Array<Record<string, unknown>>)[0]
            : undefined
          if (pass0) {
            let texPath: string | undefined
            if (Array.isArray(pass0.textures)) {
              for (const t of pass0.textures) {
                const ref = String(t)
                if (ref.startsWith('_rt_')) continue // render-target refs have no file
                const want = ref.toLowerCase().replace(/\.tex$/i, '')
                texPath = allTex.find((p) => {
                  const lower = p.toLowerCase().replace(/\.tex$/i, '')
                  return lower === want || lower === 'materials/' + want || lower.endsWith('/' + want)
                })
                if (texPath) break
              }
            }
            const userColors: Record<string, [number, number, number]> = {}
            const userNums: Record<string, number> = {}
            const usv = pass0.usershadervalues as Record<string, unknown> | undefined
            if (usv) {
              for (const [key, uniformName] of Object.entries(usv)) {
                if (typeof uniformName !== 'string') continue
                const pv = props?.[key]?.value
                if (typeof pv === 'string') userColors[uniformName] = parseVec3(pv, [1, 1, 1])
                else if (typeof pv === 'number' && Number.isFinite(pv)) userNums[uniformName] = pv
              }
            }
            manifest.bgLayers = manifest.bgLayers ?? []
            manifest.bgLayers.push({
              name: typeof obj.name === 'string' ? obj.name : 'fullscreen',
              shader: typeof pass0.shader === 'string' ? pass0.shader : undefined,
              texUrl: texPath ? resourceBase + texPath : undefined,
              userColors: Object.keys(userColors).length > 0 ? userColors : undefined,
              userNums: Object.keys(userNums).length > 0 ? userNums : undefined,
            })
          }
          continue
        }
      }
      if (typeof obj.sprite === 'string') {
        const spriteJson = access.readJson(obj.sprite) as Record<string, unknown> | null
        const pass0 = Array.isArray(spriteJson?.passes)
          ? (spriteJson.passes as Array<Record<string, unknown>>)[0]
          : undefined
        let texPath: string | undefined
        const texRef = Array.isArray(pass0?.textures) ? String(pass0.textures[0] ?? '') : ''
        if (texRef) {
          const want = texRef.toLowerCase().replace(/\.tex$/i, '')
          texPath = allTex.find((p) => {
            const lower = p.toLowerCase().replace(/\.tex$/i, '')
            return lower === want || lower === 'materials/' + want || lower.endsWith('/' + want)
          })
        }
        manifest.sprites = manifest.sprites ?? []
        manifest.sprites.push({
          name: typeof obj.name === 'string' ? obj.name : 'sprite',
          texUrl: texPath ? resourceBase + texPath : undefined,
          origin: parseVec3(obj.origin, [0, 0, 0]),
          scale: parseVec3(obj.scale, [1, 1, 1]),
        })
      }
      if (typeof obj.particle === 'string') {
        const pj = access.readJson(obj.particle) as Record<string, unknown> | null
        if (!pj) continue
        const emitter = Array.isArray(pj.emitter) ? (pj.emitter as Array<Record<string, unknown>>)[0] : undefined
        const init = Array.isArray(pj.initializer) ? (pj.initializer as Array<Record<string, unknown>>) : []
        const byName = (n: string) => init.find((i) => i.name === n)
        const life = byName('lifetimerandom')
        const size = byName('sizerandom')
        const vel = byName('velocityrandom')
        const col = byName('colorrandom')
        let texPath: string | undefined
        if (typeof pj.material === 'string') {
          const matJson = access.readJson(pj.material) as Record<string, unknown> | null
          const pass0 = Array.isArray(matJson?.passes) ? (matJson.passes as Array<Record<string, unknown>>)[0] : undefined
          const texRef = Array.isArray(pass0?.textures) ? String(pass0.textures[0] ?? '') : ''
          if (texRef) {
            const want = texRef.toLowerCase().replace(/\.tex$/i, '')
            texPath = allTex.find((p) => {
              const lower = p.toLowerCase().replace(/\.tex$/i, '')
              return lower === want || lower === 'materials/' + want || lower.endsWith('/' + want)
            })
          }
        }
        const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
        const objOrigin = parseVec3(obj.origin, [0, 0, 0])
        const emitterOrigin = parseVec3(emitter?.origin, [0, 0, 0])
        manifest.particles3d = manifest.particles3d ?? []
        manifest.particles3d.push({
          name: typeof obj.name === 'string' ? obj.name : 'particles',
          texUrl: texPath ? resourceBase + texPath : undefined,
          origin: [
            objOrigin[0] + emitterOrigin[0],
            objOrigin[1] + emitterOrigin[1],
            objOrigin[2] + emitterOrigin[2],
          ],
          rate: num(emitter?.rate, 30),
          maxCount: num(pj.maxcount, 128),
          lifeMin: num(life?.min, 2),
          lifeMax: num(life?.max, 4),
          sizeMin: num(size?.min, 0.1),
          sizeMax: num(size?.max, 0.15),
          distMin: num(emitter?.distancemin, 2),
          distMax: num(emitter?.distancemax, 10),
          velMin: parseVec3(vel?.min, [0, 0, -10]),
          velMax: parseVec3(vel?.max, [0, 0, -20]),
          colorMin: parseVec3(col?.min, [200, 200, 200]).map((c) => c / 255) as [number, number, number],
          colorMax: parseVec3(col?.max, [255, 255, 255]).map((c) => c / 255) as [number, number, number],
        })
      }
    }
    if (manifest.models.length > 0) {
      return manifest
    }
  }

  for (const obj of scene.objects as Array<Record<string, unknown>>) {
    const nameLower = (typeof obj.name === 'string' ? obj.name : '').toLowerCase()
    if (nameLower.includes('star') || nameLower.includes('meteor')) {
      manifest.hasMeteors = true
    }
    if (nameLower.includes('fireflies') || nameLower.includes('motes') || nameLower.includes('dust')) {
      manifest.hasFireflies = true
    }
  }

  const meteorTexPath = allTex.find((p) => p.toLowerCase().includes('shootingstar') || p.toLowerCase().includes('meteor'))
  if (meteorTexPath) manifest.meteorTex = resourceBase + meteorTexPath
  const sparkleTexPath = allTex.find((p) => p.toLowerCase().includes('sparkle') || p.toLowerCase().includes('halo') || p.toLowerCase().includes('star'))
  if (sparkleTexPath) manifest.sparkleTex = resourceBase + sparkleTexPath

  const sceneObjects = scene.objects as Array<Record<string, unknown>>

  // Fold the parent transform chain (linux-wallpaperengine CImage::resolveTransform):
  // a child's origin/scale/angles are relative to the already-resolved parent, so
  // grouped objects (props like utility poles) only land correctly after folding.
  // Walk leaf-first with a visited check + depth cap against cycles, then
  // accumulate root-down: offset = rotate(childOrigin * parentScale, parentAngle).
  const resolveObjectTransform = (obj: Record<string, unknown>) => {
    const chain = [obj]
    let cur = obj
    while (cur.parent != null && chain.length <= 32) {
      const parent = sceneObjects.find((o) => o.id === cur.parent)
      if (!parent || chain.includes(parent)) break
      chain.push(parent)
      cur = parent
    }
    const root = chain[chain.length - 1]
    let origin = parseVec3(root.origin, [width / 2, height / 2, 0])
    let scale = parseVec3(root.scale, [1, 1, 1])
    let angle = parseVec3(root.angles, [0, 0, 0])[2]
    for (let i = chain.length - 2; i >= 0; i--) {
      const localOrigin = parseVec3(chain[i].origin, [0, 0, 0])
      const localScale = parseVec3(chain[i].scale, [1, 1, 1])
      const localAngle = parseVec3(chain[i].angles, [0, 0, 0])[2]
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      origin = [
        origin[0] + localOrigin[0] * scale[0] * c - localOrigin[1] * scale[1] * s,
        origin[1] + localOrigin[0] * scale[0] * s + localOrigin[1] * scale[1] * c,
        origin[2] + localOrigin[2] * scale[2],
      ]
      scale = [scale[0] * localScale[0], scale[1] * localScale[1], scale[2] * localScale[2]]
      angle += localAngle
    }
    return { origin, scale, angle }
  }

  // In real WE scenes the water reflection is an object effect
  // (effects/reflection/effect.json), not only a conventionally named object.
  const hasReflectionEffect = (obj: Record<string, unknown>) =>
    (Array.isArray(obj.effects) ? obj.effects : []).some(
      (e) => typeof (e as Record<string, unknown> | null)?.file === 'string' &&
        ((e as Record<string, unknown>).file as string).toLowerCase().includes('effects/reflection'),
    )

  for (const obj of sceneObjects) {
    if (!obj.image || typeof obj.image !== 'string' || obj.image.startsWith('models/util/')) {
      if ((typeof obj.name === 'string' && obj.name.toLowerCase() === 'reflection') || hasReflectionEffect(obj)) {
        const reflTex = allTex.find((p) => p.toLowerCase().includes('reflection_mask'))
        if (reflTex) {
          // No image means no own rect: keep the legacy fullscreen layer and
          // let the player fall back to its default water line.
          manifest.layers.push({
            name: 'Reflection',
            isReflection: true,
            texUrl: resourceBase + reflTex,
            x: width / 2,
            y: height / 2,
            w: width,
            h: height,
          })
        }
      }
      continue
    }

    if (obj.visible === false) continue
    const nameLower = (typeof obj.name === 'string' ? obj.name : '').toLowerCase()
    const isTimePeriodLayer = manifest.timeSchedule !== undefined && timePeriods.has(nameLower)
    // WE's time controller overrides the stored visibility of all period layers
    // at runtime. Keep those layers in the manifest even when project.json's
    // default selection marks them hidden; ordinary hidden layers stay skipped.
    if (obj.visible && typeof obj.visible === 'object' && (obj.visible as { value?: unknown }).value === false && !isTimePeriodLayer) continue
    if (
      nameLower.includes('black') ||
      nameLower.includes('len') ||
      nameLower.includes('util') ||
      nameLower.includes('flare') ||
      nameLower.includes('blend') ||
      nameLower === 'sun' ||
      nameLower === 'sun2'
    ) {
      continue
    }

    const modelJson = access.readJson(obj.image) as Record<string, unknown> | null
    if (!modelJson || typeof modelJson.material !== 'string') continue
    const matJson = access.readJson(modelJson.material) as Record<string, unknown> | null
    if (!matJson || !Array.isArray(matJson.passes)) continue
    const pass0 = (matJson.passes as Array<Record<string, unknown>>)[0]
    const layerShader = typeof pass0?.shader === 'string' ? pass0.shader : undefined
    const texRefs = (Array.isArray(pass0?.textures) ? pass0.textures : [])
      .map((t) => String(t))
      .filter((t) => !t.startsWith('_rt_'))
    if (texRefs.length === 0) continue
    const texName = texRefs[0]
    // flowimage's first texture is the flow mask; the content layers follow.
    if (layerShader !== 'flowimage' && isLikelyMaskOrHelper(texName)) continue

    const resolveLayerTex = (ref: string) =>
      allTex.find(
        (p) =>
          p.toLowerCase() === ref.toLowerCase() ||
          p.toLowerCase() === ('materials/' + ref + '.tex').toLowerCase() ||
          p.toLowerCase() === (ref + '.tex').toLowerCase() ||
          p.toLowerCase().endsWith('/' + ref.toLowerCase() + '.tex') ||
          p.toLowerCase().endsWith('/' + ref.toLowerCase()),
      )
    const texPath = resolveLayerTex(texName)
    if (!texPath) continue
    const file = access.readFile(texPath)
    if (!file) continue
    const texPaths = texRefs
      .map((ref) => resolveLayerTex(ref))
      .filter((p): p is string => Boolean(p))
    const nums: Record<string, number> = {}
    const csv = pass0?.constantshadervalues as Record<string, unknown> | undefined
    if (csv) {
      for (const [k, v] of Object.entries(csv)) {
        if (typeof v === 'number' && Number.isFinite(v)) nums[k] = v
      }
    }
    // flowimage content layers and the flow mask are all sampled with the
    // quad UV [0,1]; decodeTex already crops power-of-two padding, so no
    // per-texture UV scaling is needed here.
    // Layer user colors (flag tint colors etc.), keyed by uniform name.
    let layerUserColors: Record<string, [number, number, number]> | undefined
    const lusv = pass0?.usershadervalues as Record<string, unknown> | undefined
    if (lusv) {
      for (const [key, uniformName] of Object.entries(lusv)) {
        if (typeof uniformName !== 'string') continue
        const pv = props?.[key]?.value
        if (typeof pv === 'string') {
          layerUserColors = layerUserColors ?? {}
          layerUserColors[uniformName] = parseVec3(pv, [1, 1, 1])
        }
      }
    }

    let decoded: DecodedImage | null = null
    try {
      decoded = decodeTex(file.bytes)
    } catch {
      decoded = null
    }

    // Layer geometry follows the scene object (open-wallpaper-engine
    // ImageObject::FromJson): size comes from the image json width/height,
    // then the object size, then the decoded texture; the object origin is
    // the quad center and scale/angles/alpha apply on top. Grouped objects
    // resolve their transform through the parent chain first.
    const resolvedTransform = resolveObjectTransform(obj)
    const objOrigin: [number, number, number] = [...resolvedTransform.origin]
    const objScale = resolvedTransform.scale
    const objAngles: [number, number, number] = [0, 0, resolvedTransform.angle]
    let lw = 0
    let lh = 0
    if (typeof modelJson.width === 'number' && typeof modelJson.height === 'number') {
      lw = modelJson.width
      lh = modelJson.height
    } else if (typeof obj.size === 'string') {
      const parts = obj.size.trim().split(/\s+/).map(parseFloat)
      if (parts.length >= 2 && !parts.some(isNaN)) {
        lw = parts[0]
        lh = parts[1]
      }
    }
    if ((!lw || !lh) && decoded) {
      lw = decoded.width
      lh = decoded.height
    }
    if (!lw || !lh) continue
    if (!decoded && !access.readFile(texPath)) continue
    if (decoded && !modelJson.width && decoded.width < 64 && decoded.height < 64) continue
    lw *= Math.abs(objScale[0]) || 1
    lh *= Math.abs(objScale[1]) || 1
    if (modelJson.fullscreen === true) {
      lw = width
      lh = height
      objOrigin[0] = width / 2
      objOrigin[1] = height / 2
      objAngles[2] = 0
    }

    // alignment anchors the quad by half its scaled size per side
    // (linux-wallpaperengine CImage::updateScenePosition); default 'center'
    // leaves the origin at the quad center.
    const alignment = typeof obj.alignment === 'string' ? obj.alignment.toLowerCase() : ''
    let alignDx = 0
    let alignDy = 0
    if (alignment.includes('left')) alignDx = lw / 2
    else if (alignment.includes('right')) alignDx = -lw / 2
    if (alignment.includes('top')) alignDy = -lh / 2
    else if (alignment.includes('bottom')) alignDy = lh / 2

    let ox = 0
    let oy = 0
    if (typeof modelJson.cropoffset === 'string') {
      const parts = modelJson.cropoffset.trim().split(/\s+/)
      ox = parseFloat(parts[0]) || 0
      oy = parseFloat(parts[1]) || 0
    }

    const alpha = typeof obj.alpha === 'number' && Number.isFinite(obj.alpha)
      ? Math.min(1, Math.max(0, obj.alpha))
      : 1
    let videoUrl: string | undefined
    try {
      if (parseTexInternal(file.bytes).isVideoMp4) videoUrl = resourceBase + texPath
    } catch {
      // Not a parseable TEX: the existing image/resource fallback decides it.
    }

    // decodeTex already crops power-of-two padding to the TEXI image rect,
    // so only an explicit cropoffset produces a sampled sub-rect here.
    // Verified by render probe: texture v=0 is the first uploaded PNG row
    // (image top), matching WE's top-left crop convention.
    let uvCrop: [number, number, number, number] | undefined
    if (decoded && typeof modelJson.width === 'number' && typeof modelJson.height === 'number') {
      const u0 = ox / decoded.width
      const u1 = (ox + modelJson.width) / decoded.width
      const v0 = oy / decoded.height
      const v1 = (oy + modelJson.height) / decoded.height
      if (u0 !== 0 || v0 !== 0 || u1 < 0.999 || v1 < 0.999) {
        uvCrop = [u0, v0, u1, v1]
      }
    }

    const isGround =
      nameLower.includes('land') ||
      nameLower.includes('grass') ||
      nameLower.includes('railing') ||
      nameLower.includes('betong') ||
      nameLower.includes('sign') ||
      nameLower.includes('cabinet') ||
      nameLower.includes('bush') ||
      nameLower.includes('fence')

    const layerX = objOrigin[0] + alignDx
    const layerY = objOrigin[1] + alignDy

    // Reflection carried as an object effect (effects/reflection/effect.json):
    // emit the reflection layer anchored to this object's own rect with the
    // water line at its top edge (screen v, 0 at the top). The object itself
    // still renders as a normal layer below.
    if (hasReflectionEffect(obj) || nameLower === 'reflection') {
      const reflTex = allTex.find((p) => p.toLowerCase().includes('reflection_mask'))
      if (reflTex) {
        manifest.layers.push({
          name: 'Reflection',
          isReflection: true,
          texUrl: resourceBase + reflTex,
          x: layerX,
          y: layerY,
          w: lw,
          h: lh,
          waterLine: Math.min(1, Math.max(0, 1 - (layerY + lh / 2) / height)),
        })
      }
    }

    manifest.layers.push({
      name: typeof obj.name === 'string' ? obj.name : 'layer',
      texUrl: resourceBase + texPath,
      // cropoffset (ox/oy) only crops the sampled UV rect; it must not move
      // the quad in world space.
      x: layerX,
      y: layerY,
      w: lw,
      h: lh,
      alpha,
      angle: objAngles[2] || 0,
      uvCrop,
      shader: layerShader,
      texUrls: texPaths.length > 1
        ? texPaths.map((p) => resourceBase + p)
        : undefined,
      userColors: layerUserColors,
      nums: Object.keys(nums).length > 0 ? nums : undefined,
      isGround,
      sway: 0,
      swaySpeed: 1.5,
      timePeriod: isTimePeriodLayer
        ? (nameLower === 'mddn' ? 'manual' : nameLower as 'morning' | 'day' | 'dusk' | 'night')
        : undefined,
      videoUrl,
    })
  }

  if (manifest.layers.length === 0) return null
  return manifest
}

function extractSceneResourceVia(access: SceneAccess, subpath: string): Uint8Array | null {
  const norm = subpath.replace(/\\/g, '/')
  const file =
    access.readFile(norm) ||
    access.readFile('materials/' + norm) ||
    access.readFile(norm + '.tex')
  if (!file) return null
  try {
    const parsed = parseTexInternal(file.bytes)
    const mip0 = parsed.mipmaps[0]
    if (parsed.isVideoMp4) return embeddedMp4Bytes(file.bytes) ?? mip0.bytes
    if (isPngBuffer(mip0.bytes)) {
      return Buffer.from(mip0.bytes)
    }
    const dec = decodeTex(file.bytes)
    return Buffer.from(encodePng(dec.width, dec.height, dec.rgba))
  } catch {
    return file.bytes
  }
}

export function buildSceneManifest(pkgData: Uint8Array, token: string, project?: unknown): SceneManifest | null {
  return buildSceneManifestVia(pkgSceneAccess(pkgData), token, project)
}

export function buildSceneManifestFromDir(dir: string, token: string): SceneManifest | null {
  return buildSceneManifestVia(dirSceneAccess(dir), token)
}

export function extractSceneResource(pkgData: Uint8Array, subpath: string): Uint8Array | null {
  return extractSceneResourceVia(pkgSceneAccess(pkgData), subpath)
}

export function extractSceneResourceFromDir(dir: string, subpath: string): Uint8Array | null {
  return extractSceneResourceVia(dirSceneAccess(dir), subpath)
}



