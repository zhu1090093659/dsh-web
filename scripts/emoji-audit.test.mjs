/**
 * Unit tests for the emoji gate: the code-point rule, the out-of-scope path
 * rules, line/column reporting, and the strict-UTF-8 gate that keeps binary
 * content out of the scan. The end-to-end gate itself is pnpm emoji:check.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { auditTree, decodeText, isEmojiCodePoint, isSkippedPath, scanText } from './emoji-audit.mjs'

/** Built from its code point so this specification file stays pictograph-free. */
const WARNING = String.fromCodePoint(0x26a0)

describe('isEmojiCodePoint', () => {
  it('covers each banned range at its boundaries', () => {
    assert.equal(isEmojiCodePoint(0x1f000), true)
    assert.equal(isEmojiCodePoint(0x1faff), true)
    assert.equal(isEmojiCodePoint(0x1efff), false)
    assert.equal(isEmojiCodePoint(0x2600), true)
    assert.equal(isEmojiCodePoint(0x27bf), true)
    assert.equal(isEmojiCodePoint(0x27c0), false)
    assert.equal(isEmojiCodePoint(0x2b00), true)
    assert.equal(isEmojiCodePoint(0x2bff), true)
    assert.equal(isEmojiCodePoint(0x1f1e6), true)
  })

  it('covers the standalone variation selector and joiner', () => {
    assert.equal(isEmojiCodePoint(0xfe0f), true)
    assert.equal(isEmojiCodePoint(0x200d), true)
  })

  it('leaves ordinary text alone', () => {
    assert.equal(isEmojiCodePoint('a'.codePointAt(0)), false)
    assert.equal(isEmojiCodePoint('中'.codePointAt(0)), false)
    assert.equal(isEmojiCodePoint('→'.codePointAt(0)), false)
  })
})

describe('isSkippedPath', () => {
  it('skips generated, vendored and binary paths', () => {
    assert.equal(isSkippedPath('node_modules/pkg/index.js'), true)
    assert.equal(isSkippedPath('packages/dsh-pet/lib/index.js'), true)
    assert.equal(isSkippedPath('market/dist/index.html'), true)
    assert.equal(isSkippedPath('market/shell/src/app.ts'), true)
    assert.equal(isSkippedPath('pnpm-lock.yaml'), true)
    assert.equal(isSkippedPath('docs/assets/banner.png'), true)
    assert.equal(isSkippedPath('test-results/report.txt'), true)
  })

  it('keeps hand-written sources in scope', () => {
    assert.equal(isSkippedPath('packages/dsh-pet/src/index.ts'), false)
    assert.equal(isSkippedPath('docs/development.md'), false)
    assert.equal(isSkippedPath('market/src/app.ts'), false)
    assert.equal(isSkippedPath('.github/workflows/ci.yml'), false)
  })
})

describe('scanText', () => {
  it('reports the line and column of each hit', () => {
    const found = scanText(['ok', 'a ' + WARNING + ' b', 'plain'].join('\n'))
    assert.equal(found.length, 1)
    assert.deepEqual({ line: found[0].line, column: found[0].column, codePoint: found[0].codePoint }, { line: 2, column: 3, codePoint: 0x26a0 })
  })

  it('counts columns per code point rather than per byte', () => {
    const found = scanText(['中文', '中' + WARNING].join('\n'))
    assert.equal(found.length, 1)
    assert.deepEqual({ line: found[0].line, column: found[0].column }, { line: 2, column: 2 })
  })

  it('finds nothing in clean text', () => {
    assert.deepEqual(scanText('const value = 1 // plain\n'), [])
  })
})

describe('decodeText', () => {
  it('accepts valid UTF-8 including CJK', () => {
    assert.equal(decodeText(Buffer.from('中文 ok', 'utf8')), '中文 ok')
  })

  it('rejects binary content instead of returning replacement characters', () => {
    assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x41])), null)
  })
})

describe('auditTree', () => {
  it('skips unreadable files and counts the ones it read', () => {
    const sources = { 'a.ts': 'clean', 'b.bin': null, 'c.ts': 'x ' + WARNING }
    const { violations, scanned } = auditTree(['a.ts', 'b.bin', 'c.ts'], (file) => sources[file] ?? null)
    assert.equal(scanned, 2)
    assert.equal(violations.length, 1)
    assert.equal(violations[0].file, 'c.ts')
    assert.equal(violations[0].line, 1)
    assert.equal(violations[0].column, 3)
  })
})
