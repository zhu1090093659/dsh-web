import { describe, expect, it } from 'vitest'
import { decodeBase64, sniffMimeType } from '../src/core/media.ts'

describe('sniffMimeType', () => {
  it('detects PNG from magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    expect(sniffMimeType(png)).toBe('image/png')
  })

  it('detects JPEG', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg')
  })

  it('rejects unknown bytes', () => {
    expect(sniffMimeType(Buffer.from('hello world'))).toBeUndefined()
  })
})

describe('decodeBase64', () => {
  it('decodes valid base64 and rejects malformed input', () => {
    expect(Buffer.from(decodeBase64('aGVsbG8=') as Uint8Array).toString()).toBe('hello')
    expect(decodeBase64('aGVsbG8')).toBeUndefined() // wrong padding
    expect(decodeBase64('!!!not-base64!!!')).toBeUndefined()
    expect(decodeBase64('')).toBeUndefined()
  })
})
