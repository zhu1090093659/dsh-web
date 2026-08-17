/**
 * Host route tests: filename sanitization, upload round-trip, and the
 * loopback fence.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeHeader, makeRoutes, parseMdfindOutput, resolveOriginalPath, safeFileName, FILE_DROP_API } from '../src/routes.ts'

class FakeResponse {
  status: number | undefined
  headers: Record<string, unknown> = {}
  ended = ''
  writeHead(status: number, headers: Record<string, unknown>): void {
    this.status = status
    this.headers = headers
  }
  end(payload?: string): void {
    if (payload !== undefined) this.ended = payload
  }
}

function fakeRequest(options: { body?: Buffer; remoteAddress?: string; host?: string; method?: string; fileName?: string } = {}): IncomingMessage {
  const req = {
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    headers: {
      host: options.host ?? '127.0.0.1:49188',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:49188',
      'x-file-name': options.fileName ?? 'report.pdf',
    },
    method: options.method ?? 'POST',
  } as unknown as IncomingMessage & { [Symbol.asyncIterator](): AsyncIterator<Buffer> }
  const body = options.body ?? Buffer.alloc(0)
  req[Symbol.asyncIterator] = async function* () {
    if (body.length > 0) yield body
  }
  return req
}

describe('safeFileName', () => {
  it('keeps a plain basename', () => {
    expect(safeFileName('report.pdf', 'fallback')).toBe('report.pdf')
  })

  it('strips path separators and traversal', () => {
    expect(safeFileName('../../etc/passwd', 'fallback')).toBe('passwd')
    expect(safeFileName('/absolute/path/a.txt', 'fallback')).toBe('a.txt')
    expect(safeFileName('..', 'fallback')).toBe('fallback')
    expect(safeFileName('', 'fallback')).toBe('fallback')
  })

  it('removes control characters', () => {
    expect(safeFileName('a\u0000b.txt', 'fallback')).toBe('ab.txt')
  })
})

describe('decodeHeader', () => {
  it('decodes URI-encoded filenames (Chinese, spaces)', () => {
    expect(decodeHeader('a%20b.txt')).toBe('a b.txt')
    expect(decodeHeader('%E4%B8%AD%E6%96%87.pdf')).toBe('中文.pdf')
  })

  it('falls back to the raw string on malformed input', () => {
    expect(decodeHeader('%zz')).toBe('%zz')
  })
})

describe('resolveOriginalPath', () => {
  it('finds the unique exact-name match in the common directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-fd-home-'))
    mkdirSync(join(home, 'Downloads'), { recursive: true })
    writeFileSync(join(home, 'Downloads', '报告.pdf'), 'x')
    expect(resolveOriginalPath('报告.pdf', home)).toBe(join(home, 'Downloads', '报告.pdf'))
    rmSync(home, { recursive: true, force: true })
  })

  it('is case-insensitive', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-fd-home-'))
    mkdirSync(join(home, 'Desktop'), { recursive: true })
    writeFileSync(join(home, 'Desktop', 'Notes.TXT'), 'x')
    expect(resolveOriginalPath('notes.txt', home)).toBe(join(home, 'Desktop', 'Notes.TXT'))
    rmSync(home, { recursive: true, force: true })
  })

  it('returns undefined when absent or ambiguous', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-fd-home-'))
    mkdirSync(join(home, 'Downloads'), { recursive: true })
    mkdirSync(join(home, 'Desktop'), { recursive: true })
    writeFileSync(join(home, 'Downloads', 'a.txt'), 'x')
    writeFileSync(join(home, 'Desktop', 'a.txt'), 'x')
    expect(resolveOriginalPath('nope.txt', home)).toBeUndefined()
    expect(resolveOriginalPath('a.txt', home)).toBeUndefined() // ambiguous
    rmSync(home, { recursive: true, force: true })
  })
})

describe('parseMdfindOutput', () => {
  it('keeps only exact-basename matches', () => {
    const stdout = [
      '/Users/qi/Deep/Dir/报告.pdf',
      '/Users/qi/Downloads/报告.pdf',
      '/Users/qi/Other/报告.pdf.backup',
      'not a path',
    ].join('\n')
    expect(parseMdfindOutput(stdout, '报告.pdf')).toEqual([
      '/Users/qi/Deep/Dir/报告.pdf',
      '/Users/qi/Downloads/报告.pdf',
    ])
  })

  it('matches case-insensitively and ignores blanks', () => {
    expect(parseMdfindOutput('\n/Users/qi/DEEP/NOTES.TXT\n\n', 'notes.txt')).toEqual(['/Users/qi/DEEP/NOTES.TXT'])
    expect(parseMdfindOutput('', 'a.txt')).toEqual([])
  })
})

describe('upload route', () => {
  it('builds the upload route path', () => {
    const routes = makeRoutes({ uploadDir: '/tmp/x' })
    expect(routes.map(route => route.path)).toEqual([FILE_DROP_API.upload])
  })

  it('writes the body to the inbox and returns the path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-file-drop-'))
    const [route] = makeRoutes({ uploadDir: dir })
    const res = new FakeResponse()
    await route.handler(
      fakeRequest({ body: Buffer.from('hello file'), fileName: 'notes.txt' }),
      res as unknown as ServerResponse,
    )
    expect(res.status).toBe(200)
    const payload = JSON.parse(res.ended)
    expect(payload.ok).toBe(true)
    expect(payload.bytes).toBe(10)
    expect(readFileSync(payload.path, 'utf8')).toBe('hello file')
    rmSync(dir, { recursive: true, force: true })
  })

  it('decodes a URI-encoded Chinese filename before saving', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-file-drop-'))
    const [route] = makeRoutes({ uploadDir: dir })
    const res = new FakeResponse()
    await route.handler(
      fakeRequest({ body: Buffer.from('x'), fileName: '%E4%B8%AD%E6%96%87.pdf' }),
      res as unknown as ServerResponse,
    )
    const payload = JSON.parse(res.ended)
    expect(payload.ok).toBe(true)
    expect(payload.name).toBe('中文.pdf')
    rmSync(dir, { recursive: true, force: true })
  })

  it('avoids overwriting an existing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-file-drop-'))
    const [route] = makeRoutes({ uploadDir: dir })
    const first = new FakeResponse()
    await route.handler(fakeRequest({ body: Buffer.from('one'), fileName: 'a.txt' }), first as unknown as ServerResponse)
    const second = new FakeResponse()
    await route.handler(fakeRequest({ body: Buffer.from('two'), fileName: 'a.txt' }), second as unknown as ServerResponse)
    expect(JSON.parse(first.ended).path).not.toBe(JSON.parse(second.ended).path)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects non-loopback requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-file-drop-'))
    const [route] = makeRoutes({ uploadDir: dir })
    const res = new FakeResponse()
    await route.handler(
      fakeRequest({ body: Buffer.from('x'), remoteAddress: '10.0.0.5' }),
      res as unknown as ServerResponse,
    )
    expect(res.status).toBe(403)
    rmSync(dir, { recursive: true, force: true })
  })
})
