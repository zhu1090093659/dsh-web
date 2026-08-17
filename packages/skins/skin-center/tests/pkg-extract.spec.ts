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
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  PKG_ENTRY_FLAG_LZ4,
  TexFormat,
  decodeTex,
  encodePng,
  extractSceneMainImage,
  lz4DecompressBlock,
  parsePkg,
  parseTex,
  readPkgEntry,
} from '../src/pkg-extract.ts'

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
    i32le(spec.width),
    i32le(spec.height),
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

  it('throws when scene.json is absent', () => {
    const pkg = buildPkg([{ path: 'materials/bg.tex', data: bgTex }])
    expect(() => extractSceneMainImage(pkg)).toThrow(/pkg: scene.json not found or invalid/)
  })
})
