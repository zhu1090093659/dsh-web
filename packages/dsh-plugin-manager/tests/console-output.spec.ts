import { describe, expect, it } from 'vitest'
import { createOutputCapture, decodeConsoleBytes } from '../src/host/console-output.ts'

/**
 * cp936 bytes for 'pnpm' 不是内部或外部命令，… (the cmd.exe command-not-found
 * stderr a zh-CN console writes); the same fixture update.spec.ts pins.
 */
const GBK_MESSAGE = Buffer.from([
  0x27, 0x70, 0x6e, 0x70, 0x6d, 0x27, 0x20, 0xb2, 0xbb, 0xca, 0xc7, 0xc4, 0xda, 0xb2, 0xbf,
  0xbb, 0xf2, 0xcd, 0xe2, 0xb2, 0xbf, 0xc3, 0xfc, 0xc1, 0xee, 0xa3, 0xac, 0xd2, 0xb2, 0xb2,
  0xbb, 0xca, 0xc7, 0xbf, 0xc9, 0xd4, 0xb4, 0xd0, 0xd0, 0xb5, 0xc4, 0xb3, 0xcc, 0xd0, 0xf2,
  0xbb, 0xf2, 0xc5, 0xfa, 0xb4, 0xa6, 0xc0, 0xed, 0xce, 0xc4, 0xbc, 0xfe, 0xa1, 0xa3, 0x0d, 0x0a,
])

/** Count U+FFFD in a decoded string. */
function replacements(text: string): number {
  return [...text].filter(character => character === '\uFFFD').length
}

describe('decodeConsoleBytes (issue #1600)', () => {
  it('returns valid UTF-8 unchanged', () => {
    const utf8 = Buffer.from('pnpm exited with code 1', 'utf8')
    expect(decodeConsoleBytes(utf8)).toBe('pnpm exited with code 1')
  })

  it('decodes a Windows console GBK payload without replacement characters', () => {
    const text = decodeConsoleBytes(GBK_MESSAGE)
    expect(replacements(text)).toBe(0)
    expect(text).toContain('不是内部或外部命令')
  })

  it('prefers GBK over a lossy UTF-8 fallback for the same bytes', () => {
    const lossy = Buffer.from(GBK_MESSAGE).toString('utf8')
    expect(replacements(lossy)).toBeGreaterThan(0)
    expect(replacements(decodeConsoleBytes(GBK_MESSAGE))).toBeLessThan(replacements(lossy))
  })
})

describe('createOutputCapture (issue #1600)', () => {
  it('restores a multi-byte character split across two reads', () => {
    const capture = createOutputCapture(4096)
    capture.push(GBK_MESSAGE.subarray(0, 5))
    capture.push(GBK_MESSAGE.subarray(5))
    const text = capture.read()
    expect(replacements(text)).toBe(0)
    expect(text).toContain('不是内部或外部命令')
  })

  it('accumulates per chunk so a per-chunk decode no longer loses characters', () => {
    // One character split across two reads: per-chunk decoding yields two
    // replacement characters, the accumulator yields the character itself.
    const character = Buffer.from('不是', 'utf16le')
    const gbk = Buffer.from([0xb2, 0xbb, 0xca, 0xc7])
    const perChunk = Buffer.from(gbk.subarray(0, 3)).toString('utf8') + Buffer.from(gbk.subarray(3)).toString('utf8')
    expect(replacements(perChunk)).toBeGreaterThan(0)
    const capture = createOutputCapture(64)
    capture.push(gbk.subarray(0, 3))
    capture.push(gbk.subarray(3))
    expect(capture.read()).toBe('不是')
    expect(character.length).toBeGreaterThan(0)
  })

  it('keeps the tail under the byte budget and stays free of replacement characters', () => {
    const capture = createOutputCapture(24)
    capture.push(Buffer.from('prefix '.repeat(10), 'utf8'))
    capture.push(GBK_MESSAGE)
    const text = capture.read()
    expect(replacements(text)).toBe(0)
    expect(text.endsWith('\r\n')).toBe(true)
  })
})
