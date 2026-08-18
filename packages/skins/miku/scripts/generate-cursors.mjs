/**
 * generate-cursors.mjs — extract the Miku cursor art from a Windows cursor
 * theme (an .ani pack) supplied via the command line, and emit
 * `src/client/cursors.ts` with the complete `MIKU_CURSOR_CSS` text.
 *
 * The theme ships as `.ani` (Windows animated cursor). Browsers cannot load
 * `.ani` as a CSS cursor image, and each file is actually a static 160x160
 * 32bpp cursor stored as 12-23 identical frames, so we take frame 0, decode
 * the 32bpp BGRA + AND mask, box-scale to 48x48, encode a PNG, and inline
 * it as a base64 data URI (Chromium supports PNG cursors with an explicit
 * hotspot; it does not support SVG cursors). The generated file is checked
 * in so the build needs no filesystem dependency. The decoding assumes the
 * 16-byte ICO-style directory entry this pack uses.
 *
 * Usage: node scripts/generate-cursors.mjs <themeDir>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC_DIR = dirname(fileURLToPath(import.meta.url))
const OUT_FILE = join(SRC_DIR, '..', 'src', 'client', 'cursors.ts')

const THEME_DIR = process.argv[2]
if (!THEME_DIR) {
  process.stderr.write('usage: node scripts/generate-cursors.mjs <themeDir>\n')
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* Minimal RIFF (ANI) + CUR frame parsing                              */
/* ------------------------------------------------------------------ */

function parseRIFF(buf, start, end) {
  const out = []
  let p = start
  while (p + 8 <= end) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    out.push({ id, size, dataStart: p + 8 })
    p = p + 8 + size + (size % 2)
  }
  return out
}

function walk(chunks, buf, res) {
  for (const c of chunks) {
    if (c.id === 'LIST') {
      const type = buf.toString('ascii', c.dataStart, c.dataStart + 4)
      res.push({ listType: type, size: c.size, dataStart: c.dataStart })
      walk(parseRIFF(buf, c.dataStart + 4, c.dataStart + c.size), buf, res)
    } else {
      res.push({ chunk: c.id, size: c.size, dataStart: c.dataStart })
    }
  }
  return res
}

/** Decode one .cur frame (160x160 32bpp BGRA + 1bpp AND mask) to RGBA. */
function decodeCurFrame(cur) {
  // These theme files use a 16-byte ICO-style directory entry (no hotspot
  // fields): header 6 bytes + entry 16 bytes -> bitmap header at offset 22.
  const hdr = 22
  const biW = cur.readInt32LE(hdr + 4)
  const biH = cur.readInt32LE(hdr + 8)
  const bpp = cur.readUInt16LE(hdr + 14)
  const xorH = biH / 2
  const xorStart = hdr + cur.readUInt32LE(hdr) // biSize (40)
  const xorStride = Math.ceil((biW * bpp) / 8 / 4) * 4
  const andStride = Math.ceil(Math.ceil(biW / 8) / 4) * 4
  const andStart = xorStart + xorStride * xorH
  const px = new Uint8Array(biW * xorH * 4)
  for (let y = 0; y < xorH; y++) {
    // DIBs with a positive height are bottom-up; flip on decode.
    const srcY = xorH - 1 - y
    const row = xorStart + srcY * xorStride
    const andRow = andStart + srcY * andStride
    for (let x = 0; x < biW; x++) {
      const o = row + x * 4
      const andBit = (cur[andRow + (x >> 3)] >> (7 - (x & 7))) & 1
      const alpha = andBit ? 0 : cur[o + 3]
      const d = (y * biW + x) * 4
      px[d] = cur[o + 2]
      px[d + 1] = cur[o + 1]
      px[d + 2] = cur[o]
      px[d + 3] = alpha
    }
  }
  return { w: biW, h: xorH, px }
}

/** Box-average scale keeping premultiplied-ish alpha compositing. */
function boxScale(src, w, h, nw, nh) {
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh))
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const s = (yy * w + xx) * 4
          const sa = src[s + 3]
          if (sa > 4) {
            r += src[s] * sa
            g += src[s + 1] * sa
            b += src[s + 2] * sa
            a += sa
            n++
          }
        }
      }
      const d = (y * nw + x) * 4
      if (a > 0) {
        out[d] = Math.round(r / a)
        out[d + 1] = Math.round(g / a)
        out[d + 2] = Math.round(b / a)
        out[d + 3] = Math.min(255, Math.round(a / Math.max(1, n)))
      } else {
        out[d + 3] = 0
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Minimal PNG encoder (RGBA, 8-bit)                                   */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* Cursor set                                                          */
/* ------------------------------------------------------------------ */

/** key -> theme file name, 48x48 hotspot (x, y). */
const CURSORS = {
  default: { file: 'Normal Select.ani', hot: [2, 2] },
  pointer: { file: 'Link.ani', hot: [2, 2] },
  text: { file: 'Text Select.ani', hot: [4, 5] },
  wait: { file: 'Busy.ani', hot: [13, 5] },
  progress: { file: 'Work.ani', hot: [8, 5] },
  help: { file: 'Help Select.ani', hot: [11, 7] },
  notAllowed: { file: 'Unavailable.ani', hot: [10, 7] },
  move: { file: 'Move.ani', hot: [22, 24] },
  crosshair: { file: 'Precision Select.ani', hot: [10, 5] },
  hResize: { file: 'Horizontal Resize.ani', hot: [23, 24] },
  vResize: { file: 'Vertical Resize.ani', hot: [22, 23] },
  diag1: { file: 'Diagonal Resize 1.ani', hot: [23, 23] },
  diag2: { file: 'Diagonal Resize 2.ani', hot: [23, 23] },
}

const SIZE = 48

function extractFrame(file) {
  const buf = readFileSync(join(THEME_DIR, file))
  const list = walk(parseRIFF(buf, 12, buf.length), buf, [])
  const fram = list.find((x) => x.listType === 'fram')
  if (!fram) throw new Error(`no fram list in ${file}`)
  const sub = parseRIFF(buf, fram.dataStart + 4, fram.dataStart + fram.size)
  if (sub.length === 0) throw new Error(`no frames in ${file}`)
  // The theme stores identical static frames; frame 0 is the artwork.
  const cur = buf.subarray(sub[0].dataStart, sub[0].dataStart + sub[0].size)
  const f = decodeCurFrame(cur)
  const scaled = boxScale(f.px, f.w, f.h, SIZE, SIZE)
  return encodePNG(SIZE, SIZE, scaled).toString('base64')
}

const uris = {}
for (const [key, spec] of Object.entries(CURSORS)) {
  uris[key] = extractFrame(spec.file)
  process.stdout.write(`extracted ${spec.file} -> ${key} (${Math.round((uris[key].length * 3) / 4 / 1024)} KiB)\n`)
}

/* ------------------------------------------------------------------ */
/* CSS surface                                                         */
/* ------------------------------------------------------------------ */

const cur = (key, fallback) => `url("data:image/png;base64,${uris[key]}") ${CURSORS[key].hot[0]} ${CURSORS[key].hot[1]}, ${fallback}`

const css = `/* Miku cursor surface: inline PNG cursors extracted from the user's
   Miku cursor theme (art by Moos柚眠). Maps the standard cursor states to
   the theme's pointer shapes. Generated, do not edit. */
body[data-dsh-miku], body[data-dsh-miku] * { cursor: ${cur('default', 'auto')}; }
body[data-dsh-miku] a, body[data-dsh-miku] button, body[data-dsh-miku] [role='button'],
body[data-dsh-miku] [role='link'], body[data-dsh-miku] [role='menuitem'], body[data-dsh-miku] [role='option'],
body[data-dsh-miku] [role='tab'], body[data-dsh-miku] [role='checkbox'], body[data-dsh-miku] [role='radio'],
body[data-dsh-miku] [role='switch'], body[data-dsh-miku] [role='treeitem'], body[data-dsh-miku] [role='gridcell'],
body[data-dsh-miku] input[type='submit'], body[data-dsh-miku] input[type='button'],
body[data-dsh-miku] input[type='reset'], body[data-dsh-miku] input[type='file'],
body[data-dsh-miku] label, body[data-dsh-miku] select, body[data-dsh-miku] summary,
body[data-dsh-miku] [class$='_entry'] { cursor: ${cur('pointer', 'pointer')}; }
body[data-dsh-miku] input:not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button']):not([type='reset']):not([type='file']),
body[data-dsh-miku] textarea, body[data-dsh-miku] [contenteditable='true'],
body[data-dsh-miku] [role='textbox'], body[data-dsh-miku] [role='searchbox'] { cursor: ${cur('text', 'text')}; }
body[data-dsh-miku] [class*='loading'], body[data-dsh-miku] [class*='spinner'],
body[data-dsh-miku] [class*='pending'], body[data-dsh-miku] [aria-busy='true'] { cursor: ${cur('wait', 'wait')}; }
body[data-dsh-miku] [data-dsh-miku-busy] *, body[data-dsh-miku] [class*='busy'] { cursor: ${cur('progress', 'progress')}; }
body[data-dsh-miku] [class*='help'] { cursor: ${cur('help', 'help')}; }
body[data-dsh-miku] :disabled, body[data-dsh-miku] [aria-disabled='true'] { cursor: ${cur('notAllowed', 'not-allowed')}; }
body[data-dsh-miku] [draggable='true'], body[data-dsh-miku] [class*='dragHandle'],
body[data-dsh-miku] [class*='drag-handle'], body[data-dsh-miku] [class*='grab'] { cursor: ${cur('move', 'grab')}; }
body[data-dsh-miku] [class*='crosshair'] { cursor: ${cur('crosshair', 'crosshair')}; }
body[data-dsh-miku] [class*='explorer-handle'], body[data-dsh-miku] [class*='preview-handle'],
body[data-dsh-miku] [class*='resizeHandle'] { cursor: ${cur('hResize', 'col-resize')}; }`

const banner = `/**
 * cursors.ts — GENERATED by scripts/generate-cursors.mjs; do not edit by hand.
 * Inline PNG cursors (48x48, base64 data URIs) extracted from the user's Miku
 * cursor theme (art by Moos柚眠, Bilibili / 米画师; used with permission for
 * this skin, not for redistribution or commercial use). Each theme file is a
 * static 160x160 cursor stored as an .ani, so frame 0 is decoded and scaled.
 */

export const MIKU_CURSOR_CSS: string = ${JSON.stringify(css)}
`

writeFileSync(OUT_FILE, banner)
process.stdout.write(`wrote ${OUT_FILE} (${Math.round(banner.length / 1024)} KiB)\n`)
