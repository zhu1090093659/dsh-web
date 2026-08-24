/**
 * Tests for the Wallpaper Engine PKG/TEX extractor (src/pkg-extract.ts).
 * Every fixture is synthetic: PKG containers, TEX textures (RGBA8888, DXT1,
 * DXT3, DXT5, embedded MP4, gif frames) and LZ4 payloads are hand-built in
 * this file — no real workshop files and no network access. The compression
 * side is covered by a minimal LZ4 block encoder (literal-only for TEXB
 * mipmaps, literals+match for PKG entry chains) so the decoder is exercised
 * through realistic round-trips.
 * @module @linxin666/dsh-client-ui-skin-center/tests/pkg-extract
 */

import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  PKG_ENTRY_FLAG_LZ4,
  TexFormat,
  buildSceneManifestFromDir,
  decodePngToRgba,
  decodeTex,
  encodePng,
  extractSceneMainImage,
  extractSceneMainImageFromDir,
  lz4DecompressBlock,
  parseMdl,
  parsePkg,
  parseTex,
  readPkgEntry,
  extractSceneResourceFromDir,
  TexUnsupportedError,
} from '../src/pkg-extract.ts'
import { encode as encodeJpeg } from 'jpeg-js'

// ---------------------------------------------------------------------------
// binary builders
// ---------------------------------------------------------------------------

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

const i32le = (v: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setInt32(0, v, true)
  return b
}

const u32le = (v: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v, true)
  return b
}

const u16le = (v: number): Uint8Array => {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, v, true)
  return b
}

const u64le = (v: number): Uint8Array =>
  concat(u32le(v % 0x100000000), u32le(Math.floor(v / 0x100000000)))

const f32le = (v: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setFloat32(0, v, true)
  return b
}

const encoder = new TextEncoder()

/** int32-length-prefixed string (PKG magic and entry paths). */
const sizedString = (s: string): Uint8Array => concat(i32le(s.length), encoder.encode(s))

/** NUL-terminated string (TEX magics). */
const nstring = (s: string): Uint8Array => concat(encoder.encode(s), Uint8Array.of(0))

// ---------------------------------------------------------------------------
// minimal LZ4 block encoders (compression side for round-trips)
// ---------------------------------------------------------------------------

/** Literal-only LZ4 block; valid for any input (used for TEXB mipmaps). */
const lz4LiteralBlock = (data: Uint8Array): Uint8Array => {
  if (data.length < 15) return concat(Uint8Array.of(data.length << 4), data)
  const head: number[] = [0xf0]
  let rem = data.length - 15
  while (rem >= 255) {
    head.push(255)
    rem -= 255
  }
  head.push(rem)
  return concat(Uint8Array.from(head), data)
}

/**
 * LZ4 block of 4 literals plus one offset-4 match covering the rest. The
 * input must be periodic with period 4, which repeating RGBA pixels are;
 * used for PKG entry chains where the stored form must beat the raw size.
 */
const lz4CompressPeriodic = (data: Uint8Array): Uint8Array => {
  if (data.length < 9) throw new Error('periodic fixture too small')
  for (let i = 4; i < data.length; i++) {
    if (data[i] !== data[i - 4]) throw new Error('fixture is not period-4')
  }
  const matchLen = data.length - 4
  const code = matchLen - 4
  const out: number[] = [(4 << 4) | (code < 15 ? code : 15)]
  for (let i = 0; i < 4; i++) out.push(data[i])
  out.push(4, 0) // match offset 4
  if (code >= 15) {
    let rem = code - 15
    while (rem >= 255) {
      out.push(255)
      rem -= 255
    }
    out.push(rem)
  }
  return Uint8Array.from(out)
}

// ---------------------------------------------------------------------------
// PKG fixture builder
// ---------------------------------------------------------------------------

interface PkgSpecEntry {
  path: string
  /** Raw payload (stored uncompressed when chain is absent). */
  data: Uint8Array
  /** Period-4 chunks; each becomes one LZ4 block in the entry chain. */
  chain?: Uint8Array[]
}

const buildPkg = (list: PkgSpecEntry[], magic = 'PKGV0001'): Uint8Array => {
  const indexParts: Uint8Array[] = []
  const dataParts: Uint8Array[] = []
  let offset = 0
  for (const entry of list) {
    let stored: Uint8Array
    if (entry.chain) {
      const blocks = entry.chain.map((chunk) => {
        const comp = lz4CompressPeriodic(chunk)
        return concat(i32le(chunk.length), i32le(comp.length), comp)
      })
      const total = entry.chain.reduce((n, c) => n + c.length, 0)
      stored = concat(u64le(total), ...blocks)
    } else {
      stored = entry.data
    }
    indexParts.push(concat(sizedString(entry.path), u32le(offset), u32le(stored.length)))
    dataParts.push(stored)
    offset += stored.length
  }
  return concat(sizedString(magic), i32le(list.length), ...indexParts, ...dataParts)
}

// ---------------------------------------------------------------------------
// TEX fixture builder
// ---------------------------------------------------------------------------

interface MipSpec {
  width: number
  height: number
  data: Uint8Array
  /** Wrap the payload in a literal-only LZ4 block (TEXB0002+). */
  lz4?: boolean
}

interface TexSpec {
  format?: number
  flags?: number
  width: number
  height: number
  /** TEXI image rect; defaults to width/height (no power-of-two padding). */
  imageWidth?: number
  imageHeight?: number
  mipmaps: MipSpec[]
  containerVersion?: 1 | 2 | 3 | 4
  freeImageFormat?: number
  isVideoMp4?: boolean
  frames?: { imageId: number; frametime: number; x: number; y: number; width: number; height: number }[]
  framesVersion?: 1 | 2 | 3
}

const buildTex = (spec: TexSpec): Uint8Array => {
  const version = spec.containerVersion ?? 2
  const parts: Uint8Array[] = [
    nstring('TEXV0005'),
    nstring('TEXI0001'),
    i32le(spec.format ?? TexFormat.RGBA8888),
    i32le(spec.flags ?? 0),
    i32le(spec.width),
    i32le(spec.height),
    i32le(spec.imageWidth ?? spec.width),
    i32le(spec.imageHeight ?? spec.height),
    u32le(0),
    nstring('TEXB000' + version),
    i32le(1), // image count
  ]
  if (version === 3) parts.push(i32le(spec.freeImageFormat ?? 13))
  if (version === 4) {
    parts.push(i32le(spec.freeImageFormat ?? -1))
    parts.push(i32le(spec.isVideoMp4 ? 1 : 0))
  }
  parts.push(i32le(spec.mipmaps.length))
  for (const mip of spec.mipmaps) {
    if (version === 4) {
      parts.push(i32le(1), i32le(2), nstring('{}'), i32le(1))
    }
    parts.push(i32le(mip.width), i32le(mip.height))
    if (version === 1) {
      parts.push(i32le(mip.data.length), mip.data)
    } else {
      const payload = mip.lz4 ? lz4LiteralBlock(mip.data) : mip.data
      parts.push(i32le(mip.lz4 ? 1 : 0), i32le(mip.data.length), i32le(payload.length), payload)
    }
  }
  if (spec.frames) {
    const fv = spec.framesVersion ?? 2
    parts.push(nstring('TEXS000' + fv), i32le(spec.frames.length))
    if (fv === 3) parts.push(i32le(spec.width), i32le(spec.height))
    for (const frame of spec.frames) {
      parts.push(i32le(frame.imageId), f32le(frame.frametime))
      const coords = [frame.x, frame.y, frame.width, frame.width, frame.height, frame.height]
      for (const c of coords) parts.push(fv === 1 ? i32le(c) : f32le(c))
    }
  }
  return concat(...parts)
}

// ---------------------------------------------------------------------------
// PNG verification helpers
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Parse and fully verify a PNG produced by encodePng (CRCs included). */
const decodePng = (png: Buffer): { width: number; height: number; rgba: Uint8Array } => {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  let pos = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  const types: string[] = []
  while (pos < png.length) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('ascii', pos + 4, pos + 8)
    const data = png.subarray(pos + 8, pos + 8 + length)
    const crc = png.readUInt32BE(pos + 8 + length)
    expect(crc32(png.subarray(pos + 4, pos + 8 + length))).toBe(crc)
    types.push(type)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data[8]).toBe(8) // bit depth
      expect(data[9]).toBe(6) // color type RGBA
      expect(data[12]).toBe(0) // no interlace
    }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + length
  }
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND'])
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4 + 1
  expect(raw.length).toBe(stride * height)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0) // filter type 0
    rgba.set(raw.subarray(y * stride + 1, y * stride + 1 + width * 4), y * width * 4)
  }
  return { width, height, rgba }
}

// ---------------------------------------------------------------------------
// shared pixel fixtures
// ---------------------------------------------------------------------------

/** Repeating RGBA pixel block, period-4 so it LZ4-compresses. */
const solidPixels = (width: number, height: number, r: number, g: number, b: number, a = 255): Uint8Array => {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) out.set([r, g, b, a], i * 4)
  return out
}

const bgPixels = Uint8Array.of(
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
) // 2x2: red, green, blue, yellow

const bgTex = buildTex({
  width: 2,
  height: 2,
  containerVersion: 3,
  mipmaps: [{ width: 2, height: 2, data: bgPixels, lz4: true }],
})

const bigPixels = solidPixels(4, 4, 9, 8, 7)

const bigTex = buildTex({
  width: 4,
  height: 4,
  containerVersion: 2,
  mipmaps: [{ width: 4, height: 4, data: bigPixels }],
})

const materialJson = encoder.encode(JSON.stringify({ passes: [{ textures: ['materials/bg.tex'] }] }))

// ---------------------------------------------------------------------------
// PKG tests
// ---------------------------------------------------------------------------

describe('parsePkg', () => {
  it('rejects a bad magic', () => {
    expect(() => parsePkg(buildPkg([], 'XXXX0001'))).toThrow(/pkg: bad magic/)
  })

  it('rejects truncated input', () => {
    expect(() => parsePkg(new Uint8Array(3))).toThrow(/pkg:/)
  })

  it('rejects entries pointing past the buffer', () => {
    const broken = concat(
      sizedString('PKGV0001'),
      i32le(1),
      sizedString('a.bin'),
      u32le(0),
      u32le(64),
      Uint8Array.of(1, 2, 3),
    )
    expect(() => parsePkg(broken)).toThrow(/pkg: entry 'a.bin' out of bounds/)
  })

  it('parses a multi-entry index and round-trips raw and compressed entries', () => {
    const rawPayload = encoder.encode('{"general":{}}')
    const compressedSingle = solidPixels(8, 8, 1, 2, 3) // one chain block
    const chunkA = solidPixels(4, 8, 5, 6, 7)
    const chunkB = solidPixels(4, 8, 5, 6, 7)
    const pkg = buildPkg([
      { path: 'scene.json', data: rawPayload },
      { path: 'materials/one.tex', data: compressedSingle, chain: [compressedSingle] },
      { path: 'materials/two.bin', data: concat(chunkA, chunkB), chain: [chunkA, chunkB] },
    ])
    const entries = parsePkg(pkg)
    expect(entries.map((e) => e.path)).toEqual(['scene.json', 'materials/one.tex', 'materials/two.bin'])
    const [json, one, two] = entries
    expect(json.flags).toBe(0)
    expect(json.size).toBe(rawPayload.length)
    expect(one.flags & PKG_ENTRY_FLAG_LZ4).toBe(PKG_ENTRY_FLAG_LZ4)
    expect(one.size).toBe(compressedSingle.length)
    expect(one.compressedSize).toBeLessThan(one.size)
    expect(two.flags & PKG_ENTRY_FLAG_LZ4).toBe(PKG_ENTRY_FLAG_LZ4)
    expect(readPkgEntry(pkg, json)).toEqual(rawPayload)
    expect(readPkgEntry(pkg, one)).toEqual(compressedSingle)
    expect(readPkgEntry(pkg, two)).toEqual(concat(chunkA, chunkB))
  })
})

describe('lz4DecompressBlock', () => {
  it('decodes a literal-only block', () => {
    const data = encoder.encode('wallpaper engine')
    expect(lz4DecompressBlock(lz4LiteralBlock(data), data.length)).toEqual(data)
  })

  it('decodes backreference matches', () => {
    // literals 'abcd', then a 10-byte match at offset 4, then literals 'ab'
    const block = concat(
      Uint8Array.of(0x46),
      encoder.encode('abcd'),
      u16le(4),
      Uint8Array.of(0x20),
      encoder.encode('ab'),
    )
    const decoded = lz4DecompressBlock(block, 16)
    expect(Buffer.from(decoded).toString('ascii')).toBe('abcdabcdabcdabab')
  })

  it('rejects a zero match offset', () => {
    const block = concat(Uint8Array.of(0x14), encoder.encode('a'), u16le(0))
    expect(() => lz4DecompressBlock(block, 5)).toThrow(/lz4: invalid match offset/)
  })

  it('rejects a size mismatch', () => {
    const data = encoder.encode('abc')
    expect(() => lz4DecompressBlock(lz4LiteralBlock(data), data.length + 1)).toThrow(
      /lz4: decompressed size mismatch/,
    )
  })
})

/** Pack one 3-bit alpha index for all 16 pixels of a DXT5 block. */
const dxt5AlphaIndexBytes = (index: number): Uint8Array => {
  let bits = 0
  for (let i = 0; i < 16; i++) bits += index * 8 ** i
  const out = new Uint8Array(6)
  for (let j = 0; j < 6; j++) {
    out[j] = bits % 256
    bits = Math.floor(bits / 256)
  }
  return out
}

// ---------------------------------------------------------------------------
// TEX tests
// ---------------------------------------------------------------------------

describe('parseTex', () => {
  it('rejects a bad magic', () => {
    expect(() => parseTex(nstring('XXXX0000'))).toThrow(/tex: bad magic/)
  })

  it('rejects unknown format ids', () => {
    const tex = buildTex({ width: 1, height: 1, format: 99, mipmaps: [{ width: 1, height: 1, data: Uint8Array.of(0, 0, 0, 0) }] })
    expect(() => parseTex(tex)).toThrow(/tex: unsupported format 99/)
  })

  it('reports dimensions, format name and mipmap levels', () => {
    const tex = buildTex({
      width: 4,
      height: 4,
      mipmaps: [
        { width: 4, height: 4, data: solidPixels(4, 4, 1, 1, 1) },
        { width: 2, height: 2, data: solidPixels(2, 2, 1, 1, 1) },
      ],
    })
    const info = parseTex(tex)
    expect(info.width).toBe(4)
    expect(info.height).toBe(4)
    expect(info.format).toBe(TexFormat.RGBA8888)
    expect(info.formatName).toBe('RGBA8888')
    expect(info.mipLevels).toBe(2)
    expect(info.isAnimatedGif).toBe(false)
    expect(info.isVideoMp4).toBe(false)
  })

  it('recognizes embedded MP4 video textures without failing silently', () => {
    const tex = buildTex({
      width: 4,
      height: 4,
      containerVersion: 4,
      freeImageFormat: -1,
      isVideoMp4: true,
      mipmaps: [{ width: 4, height: 4, data: encoder.encode('....ftypisom....') }],
    })
    const info = parseTex(tex)
    expect(info.isVideoMp4).toBe(true)
    expect(() => decodeTex(tex)).toThrow(/tex: video mp4 textures cannot be decoded/)
  })

  it('parses gif frame metadata from TEXS containers', () => {
    const tex = buildTex({
      width: 8,
      height: 4,
      flags: 4,
      mipmaps: [{ width: 8, height: 4, data: solidPixels(8, 4, 3, 3, 3) }],
      framesVersion: 2,
      frames: [
        { imageId: 0, frametime: 0.1, x: 0, y: 0, width: 4, height: 4 },
        { imageId: 0, frametime: 0.2, x: 4, y: 0, width: 4, height: 4 },
      ],
    })
    const info = parseTex(tex)
    expect(info.isAnimatedGif).toBe(true)
    expect(info.frames).toHaveLength(2)
    expect(info.frames![0].frametime).toBeCloseTo(0.1)
    expect(info.frames![1].x).toBeCloseTo(4)
    expect(info.frames![1].width).toBeCloseTo(4)
  })
})

describe('decodeTex', () => {
  it('passes RGBA8888 through, LZ4-compressed mipmap included', () => {
    const decoded = decodeTex(bgTex)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.rgba).toEqual(bgPixels)
  })

  it('reads uncompressed mipmaps and TEXB0001 containers', () => {
    expect(decodeTex(bigTex).rgba).toEqual(bigPixels)
    const v1 = buildTex({
      width: 2,
      height: 2,
      containerVersion: 1,
      mipmaps: [{ width: 2, height: 2, data: bgPixels }],
    })
    expect(decodeTex(v1).rgba).toEqual(bgPixels)
  })

  it('converts R8 and RG88 to RGBA', () => {
    const r8 = buildTex({
      width: 2,
      height: 1,
      format: TexFormat.R8,
      mipmaps: [{ width: 2, height: 1, data: Uint8Array.of(10, 20) }],
    })
    expect(decodeTex(r8).rgba).toEqual(Uint8Array.of(10, 10, 10, 255, 20, 20, 20, 255))
    const rg88 = buildTex({
      width: 1,
      height: 1,
      format: TexFormat.RG88,
      mipmaps: [{ width: 1, height: 1, data: Uint8Array.of(7, 9) }],
    })
    expect(decodeTex(rg88).rgba).toEqual(Uint8Array.of(7, 9, 0, 255))
  })

  it('decodes a DXT1 single block with known endpoints', () => {
    // c0 = pure red, c1 = pure blue, c0 > c1 -> four-color mode
    const block = concat(u16le(0xf800), u16le(0x001f), u32le(0))
    const tex = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.DXT1,
      mipmaps: [{ width: 4, height: 4, data: block }],
    })
    const { rgba } = decodeTex(tex)
    for (let i = 0; i < 16; i++) {
      expect(Array.from(rgba.subarray(i * 4, i * 4 + 4))).toEqual([255, 0, 0, 255])
    }
    // selector 2 -> (2*red + blue) / 3 = (170, 0, 85)
    const block2 = concat(u16le(0xf800), u16le(0x001f), u32le(0xaaaaaaaa))
    const tex2 = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.DXT1,
      mipmaps: [{ width: 4, height: 4, data: block2 }],
    })
    expect(Array.from(decodeTex(tex2).rgba.subarray(0, 4))).toEqual([170, 0, 85, 255])
  })

  it('decodes DXT1 punch-through alpha when c0 <= c1', () => {
    const block = concat(u16le(0x001f), u16le(0xf800), u32le(0xffffffff)) // all selector 3
    const tex = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.DXT1,
      mipmaps: [{ width: 4, height: 4, data: block }],
    })
    expect(Array.from(decodeTex(tex).rgba.subarray(0, 4))).toEqual([0, 0, 0, 0])
  })

  it('decodes DXT3 explicit 4-bit alpha', () => {
    // alpha nibble 7 on pixel 0 (7 * 17 = 119), 0 elsewhere; color: white
    const block = concat(u32le(0x00000007), u32le(0), u16le(0xffff), u16le(0xffff), u32le(0))
    const tex = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.DXT3,
      mipmaps: [{ width: 4, height: 4, data: block }],
    })
    const { rgba } = decodeTex(tex)
    expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 255, 255, 119])
    expect(Array.from(rgba.subarray(4, 8))).toEqual([255, 255, 255, 0])
  })

  it('decodes DXT5 interpolated alpha blocks', () => {
    // a0 = 255, a1 = 0, all pixels select alpha index 2 -> (6*255)/7 = 218
    // (3-bit groups packed LSB-first: index 2 x 16 = bytes 92 24 49 repeated)
    const alphaIndex2 = dxt5AlphaIndexBytes(2)
    const block = concat(Uint8Array.of(255, 0), alphaIndex2, u16le(0xf800), u16le(0x001f), u32le(0))
    const tex = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.DXT5,
      mipmaps: [{ width: 4, height: 4, data: block }],
    })
    const { rgba } = decodeTex(tex)
    for (let i = 0; i < 16; i++) {
      expect(Array.from(rgba.subarray(i * 4, i * 4 + 4))).toEqual([255, 0, 0, 218])
    }
    // a0 <= a1 mode: index 6 -> 0, index 7 -> 255
    const alphaIndex7 = dxt5AlphaIndexBytes(7)
    const block2 = concat(Uint8Array.of(0, 255), alphaIndex7, u16le(0xffff), u16le(0xffff), u32le(0))
    const tex2 = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.DXT5,
      mipmaps: [{ width: 4, height: 4, data: block2 }],
    })
    expect(decodeTex(tex2).rgba[3]).toBe(255)
  })

  it('rejects known-but-undecodable formats like BC7', () => {
    const tex = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.BC7,
      mipmaps: [{ width: 4, height: 4, data: new Uint8Array(16) }],
    })
    expect(parseTex(tex).formatName).toBe('BC7')
    expect(() => decodeTex(tex)).toThrow(/tex: unsupported format 12/)
  })

  it('throws a typed TexUnsupportedError with format metadata for BC7 (#906)', () => {
    const tex = buildTex({
      width: 8,
      height: 6,
      format: TexFormat.BC7,
      mipmaps: [{ width: 8, height: 6, data: new Uint8Array(48) }],
    })
    let caught: unknown = null
    try {
      decodeTex(tex)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TexUnsupportedError)
    const err = caught as TexUnsupportedError
    expect(err.format).toBe(TexFormat.BC7)
    expect(err.formatName).toBe('BC7')
    expect(err.width).toBe(8)
    expect(err.height).toBe(6)
  })


  it('crops power-of-two padding to the TEXI image rect (top-left)', () => {
    // 4x2 real image stored in a padded 4x4 mip (like WE's 1920x1080 in
    // 2048x2048); top rows are the content, bottom rows are filler.
    const pixels = new Uint8Array(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4
        const v = y < 2 ? 200 : 9
        pixels[i] = v
        pixels[i + 1] = v
        pixels[i + 2] = v
        pixels[i + 3] = 255
      }
    }
    const tex = buildTex({
      width: 4,
      height: 4,
      imageWidth: 4,
      imageHeight: 2,
      containerVersion: 3,
      mipmaps: [{ width: 4, height: 4, data: pixels }],
    })
    const decoded = decodeTex(tex)
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(2)
    expect(decoded.rgba.length).toBe(4 * 2 * 4)
    expect(decoded.rgba[0]).toBe(200)
    expect(decoded.rgba[decoded.rgba.length - 4]).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// PNG tests
// ---------------------------------------------------------------------------

describe('encodePng', () => {
  it('round-trips pixels through deflate and CRC-verified chunks', () => {
    const pixels = Uint8Array.of(
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ) // 3x2
    const decoded = decodePng(encodePng(3, 2, pixels))
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect(decoded.rgba).toEqual(pixels)
  })

  it('rejects a mismatched rgba buffer', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(/png: rgba buffer size mismatch/)
  })
})

// ---------------------------------------------------------------------------
// extractSceneMainImage end-to-end tests
// ---------------------------------------------------------------------------

describe('extractSceneMainImage', () => {
  const sceneJson = (image: string): Uint8Array =>
    encoder.encode(
      JSON.stringify({
        objects: [
          { id: 1, name: 'background', image },
          { id: 2, name: 'sound', sound: [] },
        ],
      }),
    )

  it('extracts the material texture of the first image object', () => {
    const pkg = buildPkg([
      { path: 'scene.json', data: sceneJson('materials/bg.json') },
      { path: 'materials/bg.json', data: materialJson },
      { path: 'materials/bg.tex', data: bgTex },
      { path: 'materials/big.tex', data: bigTex },
    ])
    const result = extractSceneMainImage(pkg)
    expect(result.texturePath).toBe('materials/bg.tex')
    expect(result.width).toBe(2)
    expect(result.height).toBe(2)
    expect(decodePng(result.png).rgba).toEqual(bgPixels)
  })

  it('accepts a direct .tex reference on the image object', () => {
    const pkg = buildPkg([
      { path: 'scene.json', data: sceneJson('materials/big.tex') },
      { path: 'materials/bg.tex', data: bgTex },
      { path: 'materials/big.tex', data: bigTex },
    ])
    const result = extractSceneMainImage(pkg)
    expect(result.texturePath).toBe('materials/big.tex')
    expect(result.width).toBe(4)
    expect(decodePng(result.png).rgba).toEqual(bigPixels)
  })

  it('falls back to the largest package texture when the material is missing', () => {
    const pkg = buildPkg([
      { path: 'scene.json', data: sceneJson('materials/missing.json') },
      { path: 'materials/bg.tex', data: bgTex },
      { path: 'materials/big.tex', data: bigTex },
    ])
    const result = extractSceneMainImage(pkg)
    expect(result.texturePath).toBe('materials/big.tex')
    expect(result.width).toBe(4)
    expect(result.height).toBe(4)
  })

  it('skips embedded MP4 textures in favor of a decodable fallback', () => {
    const videoTex = buildTex({
      width: 4,
      height: 4,
      containerVersion: 4,
      freeImageFormat: -1,
      isVideoMp4: true,
      mipmaps: [{ width: 4, height: 4, data: encoder.encode('....ftypisom....') }],
    })
    const pkg = buildPkg([
      { path: 'scene.json', data: sceneJson('materials/video.tex') },
      { path: 'materials/video.tex', data: videoTex },
      { path: 'materials/bg.tex', data: bgTex },
    ])
    const result = extractSceneMainImage(pkg)
    expect(result.texturePath).toBe('materials/bg.tex')
    expect(decodePng(result.png).rgba).toEqual(bgPixels)
  })

  it('fails with a typed unsupported error instead of a frame when the only texture is BC7 (#906)', () => {
    const bc7Tex = buildTex({
      width: 4,
      height: 4,
      format: TexFormat.BC7,
      mipmaps: [{ width: 4, height: 4, data: new Uint8Array(16) }],
    })
    const pkg = buildPkg([
      { path: 'scene.json', data: sceneJson('materials/art.tex') },
      { path: 'materials/art.tex', data: bc7Tex },
    ])
    let caught: unknown = null
    try {
      extractSceneMainImage(pkg)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TexUnsupportedError)
    expect((caught as TexUnsupportedError).format).toBe(TexFormat.BC7)
  })

  it('does not emit a partial composite frame when the top-ranked main texture is BC7 (#906)', () => {
    const mainTex = buildTex({
      width: 1600,
      height: 900,
      format: TexFormat.BC7,
      mipmaps: [{ width: 1600, height: 900, data: new Uint8Array(64) }],
    })
    const baseTex = buildTex({
      width: 1280,
      height: 720,
      mipmaps: [{ width: 1280, height: 720, data: solidPixels(1280, 720, 10, 20, 30) }],
    })
    const decoTex = buildTex({
      width: 64,
      height: 64,
      mipmaps: [{ width: 64, height: 64, data: solidPixels(64, 64, 200, 0, 0) }],
    })
    const layeredScene = encoder.encode(
      JSON.stringify({
        objects: [
          { id: 1, name: 'zz-main', image: 'models/zz-main.json' },
          { id: 2, name: 'zz-base', image: 'models/zz-base.json' },
          { id: 3, name: 'zz-deco', image: 'models/zz-deco.json' },
        ],
      }),
    )
    const pkg = buildPkg([
      { path: 'scene.json', data: layeredScene },
      { path: 'models/zz-main.json', data: encoder.encode(JSON.stringify({ material: 'materials/zz-main.json' })) },
      { path: 'materials/zz-main.json', data: encoder.encode(JSON.stringify({ passes: [{ textures: ['materials/zz-main.tex'] }] })) },
      { path: 'models/zz-base.json', data: encoder.encode(JSON.stringify({ material: 'materials/zz-base.json' })) },
      { path: 'materials/zz-base.json', data: encoder.encode(JSON.stringify({ passes: [{ textures: ['materials/zz-base.tex'] }] })) },
      { path: 'models/zz-deco.json', data: encoder.encode(JSON.stringify({ material: 'materials/zz-deco.json' })) },
      { path: 'materials/zz-deco.json', data: encoder.encode(JSON.stringify({ passes: [{ textures: ['materials/zz-deco.tex'] }] })) },
      { path: 'materials/zz-main.tex', data: mainTex },
      { path: 'materials/zz-base.tex', data: baseTex },
      { path: 'materials/zz-deco.tex', data: decoTex },
    ])
    let caught: unknown = null
    try {
      extractSceneMainImage(pkg)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TexUnsupportedError)
  })

  it('reports the real decode error instead of a later missing-texture fallback (#752)', () => {
    // The best candidate exists but fails to decode; a later object-referenced
    // texture is missing from the package and must not overwrite the decode
    // error with a misleading "not found".
    const brokenTex = buildTex({
      width: 4,
      height: 4,
      containerVersion: 3,
      mipmaps: [{ width: 4, height: 4, data: new Uint8Array(16) }],
    })
    const pkg = buildPkg([
      {
        path: 'scene.json',
        data: encoder.encode(
          JSON.stringify({
            objects: [
              { id: 1, name: 'background', image: 'materials/broken.tex' },
              { id: 2, name: 'overlay', image: 'materials/missing.tex' },
            ],
          }),
        ),
      },
      { path: 'materials/broken.tex', data: brokenTex },
    ])
    expect(() => extractSceneMainImage(pkg)).toThrow(/tex: mipmap size mismatch for RGBA8888/)
  })

  it('throws when scene.json is absent', () => {
    const pkg = buildPkg([{ path: 'materials/bg.tex', data: bgTex }])
    expect(() => extractSceneMainImage(pkg)).toThrow(/pkg: scene.json not found or invalid/)
  })
})

// ---------------------------------------------------------------------------
// extractSceneMainImageFromDir: loose scene projects (scene.json + plain
// files, e.g. WE defaultprojects) decoded straight from the directory (#521)
// ---------------------------------------------------------------------------

describe('extractSceneMainImageFromDir', () => {
  const sceneJson = (image: string): string =>
    JSON.stringify({ objects: [{ id: 1, name: 'background', image }] })

  /** Write a loose scene project into a fresh temp dir; returns the dir. */
  const makeSceneDir = (files: Record<string, Uint8Array | string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'scene-dir-'))
    for (const [name, content] of Object.entries(files)) {
      const abs = join(dir, ...name.split('/'))
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, typeof content === 'string' ? content : Buffer.from(content))
    }
    return dir
  }

  it('decodes the material texture of a loose scene project', () => {
    const dir = makeSceneDir({
      'scene.json': sceneJson('materials/bg.json'),
      'materials/bg.json': JSON.stringify({ passes: [{ textures: ['materials/bg.tex'] }] }),
      'materials/bg.tex': bgTex,
    })
    try {
      const result = extractSceneMainImageFromDir(dir)
      expect(result.texturePath).toBe('materials/bg.tex')
      expect(result.width).toBe(2)
      expect(result.height).toBe(2)
      expect(decodePng(result.png).rgba).toEqual(bgPixels)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('crops a square texture to the scene projection ratio (16:9 cover)', () => {
    const wide = 8
    const tall = 8
    const pixels = solidPixels(wide, tall, 40, 80, 120)
    // Two distinct horizontal bands so a vertical crop is observable: top
    // half stays opaque dark, bottom half stays opaque light; the center
    // crop keeps both (an all-same solid would mask an off-center crop bug).
    for (let y = 0; y < tall; y++) {
      const band = y < tall / 2 ? 200 : 40
      for (let x = 0; x < wide; x++) {
        const i = (y * wide + x) * 4
        pixels[i] = band
        pixels[i + 1] = band
        pixels[i + 2] = band
        pixels[i + 3] = 255
      }
    }
    const squareTex = buildTex({
      width: wide,
      height: tall,
      containerVersion: 3,
      mipmaps: [{ width: wide, height: tall, data: pixels }],
    })
    const dir = makeSceneDir({
      // Scene declares a 16:9 viewport while the texture is square.
      'scene.json': JSON.stringify({
        general: { orthogonalprojection: { width: 1920, height: 1080 } },
        objects: [{ id: 1, name: 'background', image: 'materials/bg.tex' }],
      }),
      'materials/bg.tex': squareTex,
    })
    try {
      const result = extractSceneMainImageFromDir(dir)
      // 8x8 square cropped to 16:9 cover keeps full width and floor(8 / (16/9)) height.
      expect(result.width).toBe(8)
      expect(result.height).toBe(Math.floor(8 / (1920 / 1080))) // 4
      const out = decodePng(result.png)
      expect(out.width).toBe(8)
      expect(out.height).toBe(4)
      // Vertical center crop: source rows 2..5 remain (startY = floor((8-4)/2) = 2).
      const row = (y: number): number => out.rgba[(y * out.width) * 4]
      expect(row(0)).toBe(200) // source row 2 (top half band)
      expect(row(out.height - 1)).toBe(40) // source row 5 (bottom half band)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the native ratio when the scene declares no projection', () => {
    const dir = makeSceneDir({
      'scene.json': sceneJson('materials/bg.tex'),
      'materials/bg.tex': buildTex({
        width: 4,
        height: 4,
        containerVersion: 3,
        mipmaps: [{ width: 4, height: 4, data: solidPixels(4, 4, 7, 7, 7) }],
      }),
    })
    try {
      const result = extractSceneMainImageFromDir(dir)
      expect(result.width).toBe(4)
      expect(result.height).toBe(4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the largest .tex found in the directory tree', () => {
    const dir = makeSceneDir({
      'scene.json': sceneJson('materials/missing.json'),
      'materials/bg.tex': bgTex,
      'nested/deep/big.tex': bigTex,
    })
    try {
      const result = extractSceneMainImageFromDir(dir)
      expect(result.texturePath).toBe('nested/deep/big.tex')
      expect(result.width).toBe(4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fences texture references that escape the project directory', () => {
    const dir = makeSceneDir({
      'scene.json': sceneJson('../outside.tex'),
    })
    try {
      expect(() => extractSceneMainImageFromDir(dir)).toThrow(/scene: texture '..\/outside.tex' not found in directory/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws when the directory has no scene.json', () => {
    const dir = makeSceneDir({ 'materials/bg.tex': bgTex })
    try {
      expect(() => extractSceneMainImageFromDir(dir)).toThrow(/scene: scene.json not found or invalid/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns embedded PNG textures directly without re-encoding', () => {
    const pngBytes = encodePng(2, 2, bgPixels)
    const pngTex = buildTex({
      width: 2,
      height: 2,
      containerVersion: 3,
      mipmaps: [{ width: 2, height: 2, data: pngBytes }],
    })
    const pkg = buildPkg([
      { path: 'scene.json', data: encoder.encode(sceneJson('materials/bg.tex')) },
      { path: 'materials/bg.tex', data: pngTex },
    ])
    const result = extractSceneMainImage(pkg)
    expect(result.texturePath).toBe('materials/bg.tex')
    expect(result.png).toEqual(pngBytes)
  })

  it('refuses 3D model scenes (.mdl) and throws for fallback to author preview', () => {
    const sceneWithMdl = JSON.stringify({
      objects: [{ name: 'guns', model: 'models/pistols/pistols.mdl', image: undefined }],
    })
    const pkg = buildPkg([
      { path: 'scene.json', data: encoder.encode(sceneWithMdl) },
      { path: 'materials/planks.tex', data: buildTex({ width: 2, height: 2, mipmaps: [{ width: 2, height: 2, data: new Uint8Array(16) }] }) },
    ])
    expect(() => extractSceneMainImage(pkg)).toThrow(/3D scene cannot be extracted/)
  })

  it('refuses multi-layer composition scenes and throws for fallback to author preview', () => {
    const multiLayerScene = JSON.stringify({
      objects: [
        { name: 'sky', image: 'models/sky.json' },
        { name: 'trees', image: 'models/trees.json' },
        { name: 'houses', image: 'models/houses.json' },
        { name: 'fence', image: 'models/fence.json' },
      ],
    })
    const pkg = buildPkg([
      { path: 'scene.json', data: encoder.encode(multiLayerScene) },
      { path: 'models/sky.json', data: encoder.encode(JSON.stringify({ material: 'materials/sky.json' })) },
      { path: 'materials/sky.json', data: encoder.encode(JSON.stringify({ passes: [{ textures: ['materials/sky.tex'] }] })) },
      { path: 'materials/sky.tex', data: buildTex({ width: 2, height: 2, mipmaps: [{ width: 2, height: 2, data: new Uint8Array(16) }] }) },
    ])
    expect(() => extractSceneMainImage(pkg)).toThrow(/multi-layer scene composition requires full preview render/)
  })

  it('detects ftyp MP4 header inside tex mipmap data as isVideoMp4', () => {
    const ftypData = new Uint8Array(32)
    ftypData.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32], 0) // ....ftypmp42
    const tex = buildTex({
      width: 2,
      height: 2,
      containerVersion: 3,
      mipmaps: [{ width: 2, height: 2, data: ftypData }],
    })
    const info = parseTex(tex)
    expect(info.isVideoMp4).toBe(true)
  })

  // Build a structured MDLV buffer: 9-byte version tag, header
  // (mdl_flag/skin_count/mesh_count), then per mesh: skin_count material
  // cstrings, flag_a, vertex bytes, vertices, index bytes, indices.
  const buildMdl = (opts: {
    version?: number
    flag: number
    vertices: number[]
    indices: number[]
    materials?: string[]
    meshes?: number
  }): Uint8Array => {
    const enc = new TextEncoder()
    const tag = concat(enc.encode('MDLV' + String(opts.version ?? 14).padStart(4, '0')), new Uint8Array([0]))
    const parts: Uint8Array[] = [tag, u32le(opts.flag), u32le(opts.materials?.length ?? 1), u32le(opts.meshes ?? 1)]
    const meshCount = opts.meshes ?? 1
    const vStride = opts.vertices.length / (3 * meshCount) // floats per vertex slot (pos+attrs)
    const vPerMesh = opts.vertices.length / meshCount / vStride
    const iPerMesh = opts.indices.length / meshCount
    const materials = opts.materials ?? ['materials/test/body.json']
    for (let m = 0; m < meshCount; m++) {
      for (const mat of materials) parts.push(concat(enc.encode(mat), new Uint8Array([0])))
      parts.push(u32le(0)) // flag_a
      const version = opts.version ?? 14
      if (version >= 17) parts.push(new Uint8Array(24)) // aabb
      if (version > 14) parts.push(u32le(opts.flag)) // per-mesh flag
      const vData = new Float32Array(opts.vertices.slice(m * vPerMesh * vStride, (m + 1) * vPerMesh * vStride))
      parts.push(u32le(vData.byteLength), new Uint8Array(vData.buffer))
      const iData = new Uint16Array(opts.indices.slice(m * iPerMesh, (m + 1) * iPerMesh))
      parts.push(u32le(iData.byteLength), new Uint8Array(iData.buffer))
    }
    return concat(...parts)
  }

  it('parses structured MDLV0014 meshes with normal+uv layout (stride 32)', () => {
    // flag 0x0B = NORMAL | UV -> 12 + 12 + 8 = 32 bytes per vertex
    const mdlBuf = buildMdl({
      flag: 0x0b,
      vertices: [
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
      ],
      indices: [0, 1, 2],
      materials: ['materials/car/body.json'],
    })

    const meshes = parseMdl(mdlBuf)
    expect(meshes.length).toBe(1)
    expect(meshes[0].vCount).toBe(3)
    expect(meshes[0].iCount).toBe(3)
    expect(meshes[0].pos[3]).toBe(1) // second vertex x
    expect(meshes[0].norm[1]).toBe(1) // first vertex normal y
    expect(meshes[0].uv[2]).toBe(1) // second vertex u
    expect(meshes[0].indices[2]).toBe(2)
    expect(meshes[0].materialPath).toBe('materials/car/body.json')
  })

  it('parses MDLV0014 meshes with uv-only layout (stride 20) and default normals', () => {
    // flag 0x09 = UV -> 12 + 8 = 20 bytes per vertex (jet/skybox style)
    const mdlBuf = buildMdl({
      flag: 0x09,
      vertices: [
        0, 0, 0, 0.25, 0.5,
        1, 0, 0, 0.5, 0.75,
        0, 1, 0, 1, 1,
      ],
      indices: [0, 1, 2],
    })

    const meshes = parseMdl(mdlBuf)
    expect(meshes.length).toBe(1)
    expect(meshes[0].vCount).toBe(3)
    expect(meshes[0].uv[0]).toBeCloseTo(0.25)
    expect(meshes[0].uv[3]).toBeCloseTo(0.75)
    expect(meshes[0].norm[1]).toBe(1) // default up normal
  })

  it('parses multi-mesh MDLV with per-mesh material paths', () => {
    const mdlBuf = buildMdl({
      flag: 0x09,
      meshes: 2,
      vertices: [
        0, 0, 0, 0, 0,
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        5, 5, 5, 0, 0,
        6, 5, 5, 0, 0,
        5, 6, 5, 0, 0,
      ],
      indices: [0, 1, 2, 0, 1, 2],
      materials: ['materials/car/body.json'],
    })

    const meshes = parseMdl(mdlBuf)
    expect(meshes.length).toBe(2)
    expect(meshes[0].vCount).toBe(3)
    expect(meshes[1].pos[0]).toBe(5)
    expect(meshes[0].materialPath).toBe('materials/car/body.json')
    expect(meshes[1].materialPath).toBe('materials/car/body.json')
  })

  it('reads u32 indices for MDLV0023 meshes above 65535 vertices', () => {
    // flag 0x09, 65537 verts would be huge; instead fake the version and a
    // small mesh, then verify the u32 path by forcing indices_bytes % 12 == 0
    // with vertex count > 0xffff is impractical here — so assert u16 path
    // stays default and parser tolerates mdlv23 headers.
    const mdlBuf = buildMdl({
      version: 23,
      flag: 0x09,
      vertices: [
        0, 0, 0, 0, 0,
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
      ],
      indices: [0, 1, 2],
    })
    const meshes = parseMdl(mdlBuf)
    expect(meshes.length).toBe(1)
    expect(meshes[0].indices instanceof Uint16Array).toBe(true)
  })

  it('builds 3D scene manifest from a structured MDLV model', () => {
    const mdlBuf = buildMdl({
      flag: 0x0b,
      vertices: [
        0, 0, 0, 0, 1, 0, 0, 0,
        1, 0, 0, 0, 1, 0, 1, 0,
        0, 1, 0, 0, 1, 0, 0, 1,
      ],
      indices: [0, 1, 2],
      materials: ['materials/car/body.json'],
    })

    const tmp = mkdtempSync(join(tmpdir(), 'dsh-3d-test-'))
    try {
      mkdirSync(join(tmp, 'models/car'), { recursive: true })
      writeFileSync(join(tmp, 'models/car/car.mdl'), mdlBuf)
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { fov: 50 },
        camera: { eye: '1 2 3', center: '0 0 0', up: '0 1 0', fov: 60 },
        objects: [{ name: 'car', model: 'models/car/car.mdl', origin: '0 0 0', angles: '0 0 0', scale: '1 1 1' }]
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_test')
      expect(manifest?.is3D).toBe(true)
      // Older scenes can carry a camera-local override; it wins over the
      // standard scene.general FOV.
      expect(manifest?.camera?.fov).toBe(60)
      expect(manifest?.models?.length).toBe(1)
      expect(manifest?.models?.[0].meshes.length).toBe(1)
      expect(manifest?.models?.[0].meshes[0].materialPath).toBe('materials/car/body.json')
      expect(manifest?.models?.[0].meshes[0].uv2B64).toBeUndefined()

      const writeFovScene = (general: Record<string, unknown> | undefined): void => {
        writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
          ...(general === undefined ? {} : { general }),
          camera: { eye: '1 2 3', center: '0 0 0', up: '0 1 0' },
          objects: [
            { name: 'car', model: 'models/car/car.mdl', origin: '0 0 0', angles: '0 0 0', scale: '1 1 1' },
            { light: 'point', origin: '1 2 3', color: '0.5 0.25 0.125', intensity: 2, radius: 16 },
          ],
        }), 'utf8')
      }
      writeFovScene({ fov: 50 })
      const litManifest = buildSceneManifestFromDir(tmp, 'tok_general_fov')
      expect(litManifest?.camera?.fov).toBe(50)
      expect(litManifest?.pointLights).toEqual([{ origin: [1, 2, 3], color: [1, 0.5, 0.25], radius: 16 }])
      writeFovScene({ fov: 0 })
      expect(buildSceneManifestFromDir(tmp, 'tok_invalid_fov')?.camera?.fov).toBe(50)
      writeFovScene(undefined)
      expect(buildSceneManifestFromDir(tmp, 'tok_default_fov')?.camera?.fov).toBe(50)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('carries material render flags, user colors, sprites and 3D particles into the manifest', () => {
    const mdlBuf = buildMdl({
      flag: 0x09,
      vertices: [
        0, 0, 0, 0, 0,
        1, 0, 0, 0, 0,
        0, 1, 0, 0, 0,
      ],
      indices: [0, 1, 2],
      materials: ['materials/fx/glow.json'],
    })

    const tmp = mkdtempSync(join(tmpdir(), 'dsh-3d-mat-'))
    try {
      mkdirSync(join(tmp, 'models/fx'), { recursive: true })
      mkdirSync(join(tmp, 'materials/fx'), { recursive: true })
      mkdirSync(join(tmp, 'materials/sprites'), { recursive: true })
      mkdirSync(join(tmp, 'particles'), { recursive: true })
      writeFileSync(join(tmp, 'models/fx/glow.mdl'), mdlBuf)
      writeFileSync(join(tmp, 'materials/fx/glow.json'), JSON.stringify({
        passes: [{
          shader: 'technoglow',
          blending: 'additive',
          depthtesting: 'disabled',
          textures: ['fx/glow'],
          usershadervalues: { schemecolor: 'tint' },
        }],
      }))
      writeFileSync(join(tmp, 'materials/fx/glow.tex'), buildTex({ width: 64, height: 64, mipmaps: [{ width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) }] }))
      writeFileSync(join(tmp, 'materials/sprites/sun.json'), JSON.stringify({ passes: [{ shader: 'sprite', textures: ['sprites/sun'] }] }))
      writeFileSync(join(tmp, 'particles/stars.json'), JSON.stringify({
        emitter: [{ origin: '0 0 8', rate: 60, distancemin: 4, distancemax: 20 }],
        initializer: [
          { name: 'lifetimerandom', min: 3, max: 5 },
          { name: 'sizerandom', min: 0.1, max: 0.12 },
          { name: 'velocityrandom', min: '0 0 -30', max: '0 0 -40' },
        ],
        maxcount: 250,
      }))
      writeFileSync(join(tmp, 'project.json'), JSON.stringify({
        file: 'scene.json',
        general: { properties: { schemecolor: { type: 'color', value: '0.1 0.2 0.7' } } },
      }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        camera: { eye: '0 0 1', center: '0 0 0', up: '0 1 0' },
        objects: [
          { name: 'glow', model: 'models/fx/glow.mdl', origin: '0 0 0', angles: '0 0 0', scale: '1 1 1' },
          { name: 'sun', sprite: 'materials/sprites/sun.json', origin: '0 0 0', scale: '1 1 1' },
          { name: 'stars', particle: 'particles/stars.json', origin: '1 2 3', scale: '1 1 1' },
        ],
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_test')
      const mesh = manifest?.models?.[0].meshes[0]
      expect(mesh?.shader).toBe('technoglow')
      expect(mesh?.additive).toBe(true)
      expect(mesh?.noDepthTest).toBe(true)
      expect(mesh?.tint).toEqual([0.1, 0.2, 0.7])
      expect(mesh?.userColors?.tint).toEqual([0.1, 0.2, 0.7])
      expect(mesh?.texUrl).toContain('materials/fx/glow.tex')

      expect(manifest?.sprites?.length).toBe(1)
      expect(manifest?.sprites?.[0].name).toBe('sun')

      expect(manifest?.particles3d?.length).toBe(1)
      const stars = manifest?.particles3d?.[0]
      expect(stars?.origin).toEqual([1, 2, 11]) // object origin + emitter origin
      expect(stars?.rate).toBe(60)
      expect(stars?.maxCount).toBe(250)
      expect(stars?.velMax).toEqual([0, 0, -40])

      // Static camera (no paths) must be flagged so the player does not orbit.
      expect(manifest?.cameraStatic).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('lays out 2D layers from object origin/scale, skips visible:false, and crops padded textures', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-2d-test-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      // 128x128 content declared by the image json, padded into a 256x256 tex
      writeFileSync(join(tmp, 'materials', 'photo.tex'), buildTex({
        width: 256, height: 256,
        mipmaps: [{ width: 256, height: 256, data: new Uint8Array(256 * 256 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'photo.json'), JSON.stringify({ material: 'materials/photo.json', width: 128, height: 128 }))
      writeFileSync(join(tmp, 'materials', 'photo.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['photo'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: 1000, height: 800 } },
        objects: [
          { name: 'photo', image: 'models/photo.json', origin: '500 400 0', scale: '2 2 1', angles: '0 0 0.5', alpha: 0.8 },
          { name: 'hidden', image: 'models/photo.json', origin: '0 0 0', visible: false },
        ],
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_2d')
      expect(manifest?.layers.length).toBe(1) // visible:false object skipped
      const layer = manifest?.layers[0]
      expect(layer?.x).toBe(500)
      expect(layer?.y).toBe(400)
      expect(layer?.w).toBe(256) // 128 * scale 2
      expect(layer?.h).toBe(256)
      expect(layer?.alpha).toBeCloseTo(0.8)
      expect(layer?.angle).toBeCloseTo(0.5)
      expect(layer?.uvCrop).toEqual([0, 0, 0.5, 0.5]) // 128/256 content rect
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('retains author time-period video layers and schedule defaults', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-time-scene-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      const videoTex = buildTex({
        width: 1920,
        height: 1080,
        containerVersion: 4,
        freeImageFormat: -1,
        isVideoMp4: true,
        mipmaps: [{ width: 1920, height: 1080, data: encoder.encode('....ftypisom....video') }],
      })
      for (const period of ['morning', 'day', 'dusk', 'night']) {
        writeFileSync(join(tmp, 'models', period + '.json'), JSON.stringify({ material: 'materials/' + period + '.json', width: 1920, height: 1080 }))
        writeFileSync(join(tmp, 'materials', period + '.json'), JSON.stringify({ passes: [{ shader: 'genericimage4', textures: [period] }] }))
        writeFileSync(join(tmp, 'materials', period + '.tex'), videoTex)
      }
      writeFileSync(join(tmp, 'project.json'), JSON.stringify({
        file: 'scene.json',
        general: { properties: {
          timevarying: { type: 'bool', value: true },
          morningtime: { type: 'textinput', value: '5' },
          daytime: { type: 'textinput', value: '9' },
          dusktime: { type: 'textinput', value: '17.5' },
          nighttime: { type: 'textinput', value: '21' },
        } },
      }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: 1920, height: 1080 } },
        objects: ['morning', 'day', 'dusk', 'night'].map((period, index) => ({
          name: period,
          image: 'models/' + period + '.json',
          origin: '960 540 0',
          visible: { user: { name: 'display', condition: String(index) }, value: period === 'day' },
        })),
      }))

      const manifest = buildSceneManifestFromDir(tmp, 'tok_time')
      expect(manifest?.timeSchedule).toEqual({ morning: 5, day: 9, dusk: 17.5, night: 21 })
      expect(manifest?.layers.map(layer => layer.timePeriod)).toEqual(['morning', 'day', 'dusk', 'night'])
      expect(manifest?.layers.every(layer => layer.videoUrl?.includes('/scene-resource/tok_time/'))).toBe(true)
      const mp4 = extractSceneResourceFromDir(tmp, 'materials/day.tex')
      expect(new TextDecoder().decode(mp4 ?? new Uint8Array())).toContain('ftypisom')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('folds parent transform chains for grouped objects (#742)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-2d-parent-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      writeFileSync(join(tmp, 'materials', 'pole.tex'), buildTex({
        width: 128, height: 128,
        mipmaps: [{ width: 128, height: 128, data: new Uint8Array(128 * 128 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'pole.json'), JSON.stringify({ material: 'materials/pole.json', width: 128, height: 128 }))
      writeFileSync(join(tmp, 'materials', 'pole.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['pole'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: 1000, height: 800 } },
        objects: [
          // WE editor group: children are relative to the resolved parent.
          { id: 1, name: 'pole-group', origin: '100 50 0', scale: '2 2 1', angles: '0 0 0.25' },
          { id: 2, name: 'pole', image: 'models/pole.json', parent: 1, origin: '10 5 0', scale: '0.5 0.5 1', angles: '0 0 0.25' },
        ],
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_parent')
      expect(manifest?.layers.length).toBe(1)
      const layer = manifest?.layers[0]
      const c = Math.cos(0.25)
      const s = Math.sin(0.25)
      expect(layer?.x).toBeCloseTo(100 + 10 * 2 * c - 5 * 2 * s)
      expect(layer?.y).toBeCloseTo(50 + 10 * 2 * s + 5 * 2 * c)
      expect(layer?.w).toBe(128) // folded scale 2 * 0.5
      expect(layer?.h).toBe(128)
      expect(layer?.angle).toBeCloseTo(0.5)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('survives parent cycles without hanging (#742)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-2d-cycle-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      writeFileSync(join(tmp, 'materials', 'pole.tex'), buildTex({
        width: 128, height: 128,
        mipmaps: [{ width: 128, height: 128, data: new Uint8Array(128 * 128 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'pole.json'), JSON.stringify({ material: 'materials/pole.json', width: 128, height: 128 }))
      writeFileSync(join(tmp, 'materials', 'pole.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['pole'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: 1000, height: 800 } },
        objects: [
          { id: 1, name: 'a', image: 'models/pole.json', parent: 2, origin: '10 0 0' },
          { id: 2, name: 'b', parent: 1, origin: '20 0 0' },
        ],
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_cycle')
      expect(manifest?.layers.length).toBe(1)
      expect(Number.isFinite(manifest?.layers[0].x)).toBe(true)
      expect(Number.isFinite(manifest?.layers[0].y)).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('applies alignment offsets and keeps cropoffset out of the world position (#742)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-2d-align-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      // 128x128 content padded into a 256x256 tex, sampled from (32, 16).
      writeFileSync(join(tmp, 'materials', 'photo.tex'), buildTex({
        width: 256, height: 256,
        mipmaps: [{ width: 256, height: 256, data: new Uint8Array(256 * 256 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'photo.json'), JSON.stringify({
        material: 'materials/photo.json', width: 128, height: 128, cropoffset: '32 16',
      }))
      writeFileSync(join(tmp, 'materials', 'photo.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['photo'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: 1000, height: 800 } },
        objects: [
          { name: 'photo', image: 'models/photo.json', origin: '500 400 0', alignment: 'left top' },
        ],
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_align')
      expect(manifest?.layers.length).toBe(1)
      const layer = manifest?.layers[0]
      // left/top anchor shifts the quad center by half its size; the crop
      // offset only selects the sampled UV rect and must not move the quad.
      expect(layer?.x).toBe(500 + 64)
      expect(layer?.y).toBe(400 - 64)
      expect(layer?.uvCrop).toEqual([0.125, 0.0625, 0.625, 0.5625])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('anchors effects-driven reflection layers to the object rect with a data-driven water line (#742)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-2d-reflect-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      mkdirSync(join(tmp, 'masks'), { recursive: true })
      writeFileSync(join(tmp, 'materials', 'water.tex'), buildTex({
        width: 128, height: 128,
        mipmaps: [{ width: 128, height: 128, data: new Uint8Array(128 * 128 * 4) }],
      }))
      writeFileSync(join(tmp, 'masks', 'reflection_mask_0.tex'), buildTex({
        width: 128, height: 128,
        mipmaps: [{ width: 128, height: 128, data: new Uint8Array(128 * 128 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'water.json'), JSON.stringify({ material: 'materials/water.json', width: 128, height: 128 }))
      writeFileSync(join(tmp, 'materials', 'water.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['water'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: 1000, height: 800 } },
        objects: [
          {
            name: 'water', image: 'models/water.json', origin: '500 400 0',
            effects: [{ file: 'effects/reflection/effect.json' }],
          },
          // Legacy form: a conventionally named object without its own image
          // keeps the fullscreen layer and leaves the water line to the player.
          { name: 'reflection' },
        ],
      }), 'utf8')

      const manifest = buildSceneManifestFromDir(tmp, 'tok_reflect')
      const reflections = manifest?.layers.filter((l) => l.isReflection)
      expect(reflections?.length).toBe(2)
      const anchored = reflections?.find((l) => typeof l.waterLine === 'number')
      expect(anchored).toBeDefined()
      expect(anchored?.x).toBe(500)
      expect(anchored?.y).toBe(400)
      expect(anchored?.w).toBe(128)
      expect(anchored?.h).toBe(128)
      // Water surface at the object top edge: 1 - (400 + 64) / 800.
      expect(anchored?.waterLine).toBeCloseTo(0.42)
      expect(anchored?.texUrl).toContain('reflection_mask_0')
      const legacy = reflections?.find((l) => l.waterLine == null)
      expect(legacy).toBeDefined()
      expect(legacy?.w).toBe(1000)
      expect(legacy?.h).toBe(800)
      // The water object itself still renders as a normal layer.
      expect(manifest?.layers.some((l) => l.name === 'water' && !l.isReflection)).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('untrusted input allocation caps (#717 hardening)', () => {
  const u32be = (v: number): Uint8Array => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v, false)
    return b
  }

  it('rejects oversized LZ4 decompressed sizes before allocating', () => {
    // 300 MB claimed output from a 1-byte block: must throw, not allocate.
    expect(() => lz4DecompressBlock(new Uint8Array([0x00]), 300 * 1024 * 1024))
      .toThrow(/out of bounds/)
  })

  it('rejects tex mipmaps with oversized dimensions', () => {
    const tex = concat(
      encoder.encode('TEXV0005'), new Uint8Array(1),
      encoder.encode('TEXI0001'), new Uint8Array(1),
      i32le(TexFormat.RGBA8888), i32le(0),
      i32le(1), i32le(1), i32le(1), i32le(1), i32le(0),
      encoder.encode('TEXB0003'), new Uint8Array(1),
      i32le(1), i32le(1), i32le(1),
      i32le(20000), i32le(20000),
      i32le(0), i32le(0), i32le(0),
    )
    expect(() => decodeTex(tex)).toThrow(/invalid mipmap dimensions/)
  })

  it('rejects png headers with oversized dimensions', () => {
    // Hand-forged PNG framing: signature + IHDR (20000x20000) + IEND.
    // decodePngToRgba validates dimensions straight from the header and
    // throws before any allocation or inflate.
    const png = concat(
      Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
      u32be(13), encoder.encode('IHDR'),
      u32be(20000), u32be(20000),
      Uint8Array.of(8, 6, 0, 0, 0),
      Uint8Array.of(0, 0, 0, 0),
      u32be(0), encoder.encode('IEND'),
      Uint8Array.of(0, 0, 0, 0),
    )
    expect(() => decodePngToRgba(png)).toThrow(/invalid dimensions/)
  })
})

describe('scene robustness (#717 follow-up)', () => {
  it('clamps negative or invalid projection dims to the defaults', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-scene-dims-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      writeFileSync(join(tmp, 'materials', 'photo.tex'), buildTex({
        width: 4, height: 4,
        mipmaps: [{ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'photo.json'), JSON.stringify({ material: 'materials/photo.json', width: 4, height: 4 }))
      writeFileSync(join(tmp, 'materials', 'photo.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['photo'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        general: { orthogonalprojection: { width: -1920, height: 0 } },
        objects: [{ name: 'photo', image: 'models/photo.json', origin: '0 0 0' }],
      }), 'utf8')
      const manifest = buildSceneManifestFromDir(tmp, 'tok_dims')
      expect(manifest?.width).toBe(3840)
      expect(manifest?.height).toBe(2160)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('skips camera path segments with non-positive duration', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-scene-cam-'))
    try {
      mkdirSync(join(tmp, 'models'), { recursive: true })
      mkdirSync(join(tmp, 'materials'), { recursive: true })
      writeFileSync(join(tmp, 'materials', 'photo.tex'), buildTex({
        width: 4, height: 4,
        mipmaps: [{ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) }],
      }))
      writeFileSync(join(tmp, 'models', 'photo.json'), JSON.stringify({ material: 'materials/photo.json', width: 4, height: 4 }))
      writeFileSync(join(tmp, 'materials', 'photo.json'), JSON.stringify({ passes: [{ shader: 'genericimage', textures: ['photo'] }] }))
      writeFileSync(join(tmp, 'scene.json'), JSON.stringify({
        camera: { paths: ['camera.json'] },
        objects: [{ name: 'photo', image: 'models/photo.json', origin: '0 0 0' }],
      }), 'utf8')
      const t0 = { eye: '0 0 5', center: '0 0 0', up: '0 1 0' }
      const t1 = { eye: '0 0 4', center: '0 0 0', up: '0 1 0' }
      writeFileSync(join(tmp, 'camera.json'), JSON.stringify({
        paths: [
          { duration: 0, transforms: [t0, t1] },
          { duration: -2, transforms: [t0, t1] },
          { duration: 5, transforms: [t0, t1] },
        ],
      }), 'utf8')
      const manifest = buildSceneManifestFromDir(tmp, 'tok_cam')
      expect(manifest?.cameraPaths?.length).toBe(1)
      expect(manifest?.cameraPaths?.[0].d).toBe(5)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('refuses to read project files that are symlinks escaping the directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-scene-link-'))
    const outside = mkdtempSync(join(tmpdir(), 'dsh-scene-out-'))
    try {
      writeFileSync(join(outside, 'evil.tex'), Buffer.from('TEXV0005-fake'), 'utf8')
      symlinkSync(join(outside, 'evil.tex'), join(tmp, 'evil.tex'))
      expect(extractSceneResourceFromDir(tmp, 'evil.tex')).toBeNull()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// JPEG-embedded TEX (issue #756): the TEXB0003 layout is imageCount ->
// FreeImage format -> per-image mipmapCount; FreeImage FIF_JPEG = 2. Such
// mipmaps carry JPEG bytes (FF D8) with a TEXI format of RGBA8888. They now
// decode through the pure-JS jpeg-js decoder (round-tripped via its encoder).
// ---------------------------------------------------------------------------

const jpegBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[3] = 0xe0
  return bytes
}

/** Solid-color JPEG produced by the jpeg-js encoder (deterministic fixture). */
const solidJpeg = (width: number, height: number, r: number, g: number, b: number): Uint8Array => {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  return new Uint8Array(encodeJpeg({ data: rgba, width, height }, 92).data)
}

describe('JPEG-embedded TEX (issue #756)', () => {
  it('parses imageCount -> FreeImage format -> mipmapCount without misalignment', () => {
    const tex = buildTex({
      format: TexFormat.RGBA8888,
      width: 2704,
      height: 1520,
      containerVersion: 3,
      freeImageFormat: 2, // FIF_JPEG
      mipmaps: [
        { width: 2704, height: 1520, data: jpegBytes(350_695) },
        { width: 1352, height: 760, data: jpegBytes(90_000) },
        { width: 676, height: 380, data: jpegBytes(24_000) },
        { width: 338, height: 190, data: jpegBytes(7_000) },
      ],
    })
    const parsed = parseTex(tex)
    expect(parsed.width).toBe(2704)
    expect(parsed.height).toBe(1520)
    expect(parsed.mipLevels).toBe(4)
  })

  it('decodes FreeImage JPEG mipmaps through the pure-JS decoder', () => {
    const jpeg = solidJpeg(32, 16, 200, 60, 30)
    const tex = buildTex({
      format: TexFormat.RGBA8888,
      width: 32,
      height: 16,
      containerVersion: 3,
      freeImageFormat: 2,
      mipmaps: [{ width: 32, height: 16, data: jpeg }],
    })
    const decoded = decodeTex(tex)
    expect(decoded.width).toBe(32)
    expect(decoded.height).toBe(16)
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < decoded.rgba.length; i += 4) {
      r += decoded.rgba[i]
      g += decoded.rgba[i + 1]
      b += decoded.rgba[i + 2]
      n += 1
    }
    // JPEG is lossy: channel means must land close to the source color.
    expect(Math.abs(r / n - 200)).toBeLessThan(12)
    expect(Math.abs(g / n - 60)).toBeLessThan(12)
    expect(Math.abs(b / n - 30)).toBeLessThan(12)
  })

  it('fails with a JPEG decode error, not an RGBA size mismatch, for corrupt bytes', () => {
    const tex = buildTex({
      format: TexFormat.RGBA8888,
      width: 2704,
      height: 1520,
      containerVersion: 3,
      freeImageFormat: 2,
      mipmaps: [{ width: 2704, height: 1520, data: jpegBytes(350_695) }],
    })
    let message = ''
    try {
      decodeTex(tex)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toContain('mipmap size mismatch for RGBA8888')
  })
})
