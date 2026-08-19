import { describe, expect, it } from 'vitest'
import { attachmentMarkdown, attachmentNote, validateAttachPayload } from '../src/attach-routes.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

const REF: ImageAttachmentRef = {
  attachmentId: 'sha256:abc123' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png',
  bytes: 4,
  width: 10,
  height: 10,
  name: 'page.png',
}

describe('attachmentMarkdown / attachmentNote', () => {
  it('builds the note and a self-contained markdown reference', () => {
    expect(attachmentNote(REF)).toBe('[image attachment ' + JSON.stringify(REF) + ']')
    const markdown = attachmentMarkdown(REF)
    expect(markdown.startsWith('![图片](/page-annotate/raw/')).toBe(true)
    expect(markdown).toContain('ref=')
  })
})

describe('validateAttachPayload', () => {
  it('accepts a valid png payload', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const result = validateAttachPayload({ data: png.toString('base64'), mediaType: 'image/png' })
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.mediaType).toBe('image/png')
    }
  })

  it('rejects mismatched media type and malformed base64', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const jpeg = validateAttachPayload({ data: png.toString('base64'), mediaType: 'image/jpeg' })
    expect('error' in jpeg ? jpeg.error.code : undefined).toBe('rejected')
    const bad = validateAttachPayload({ data: 'not-base64!', mediaType: 'image/png' })
    expect('error' in bad ? bad.error.code : undefined).toBe('rejected')
  })
})
