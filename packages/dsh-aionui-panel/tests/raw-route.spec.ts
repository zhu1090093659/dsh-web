/**
 * Raw-route integration test: the GET /aionui-panel/raw dispatch inside the
 * prefix handler (mime + headers + error statuses), exercised through the
 * real FsService with a fake ctx.webServer registry.
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { FsService } from '../src/host/fs-service.ts'
import { parseRangeHeader, ifNoneMatchSaidFresh, registerPanelRoutes } from '../src/host/routes.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'

/** A minimal ctx fulfilling what registerPanelRoutes touches. */
function fakeCtx(): {
  ctx: Record<string, unknown>
  registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }>
} {
  const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
  const ctx = {
    logger: { warn: () => {} },
    webServer: {
      register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
        registrations.push(row)
        return () => {}
      },
    },
    effect: (fn: () => void) => { fn(); return () => {} },
  }
  return { ctx, registrations }
}

/** Drive one request through the registered prefix handler. */
async function request(
  handler: (req: unknown, res: unknown) => Promise<void>,
  method: string,
  url: string,
  options: { remoteAddress?: string; host?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  let status = 0
  let headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  // A real Writable: the raw route streams with pipeline(), so the fake
  // response must accept backpressured writes, not just end(chunk).
  const res = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk)
      callback()
    },
  }) as Writable & { writeHead: (code: number, head?: Record<string, string | number>) => void }
  res.writeHead = (code: number, head: Record<string, string | number> = {}) => {
    status = code
    headers = head as Record<string, string>
  }
  await handler({
    method,
    url,
    headers: {
      host: options.host ?? '127.0.0.1:3000',
      ...(options.headers ?? {}),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  }, res)
  return { status, headers, body: Buffer.concat(chunks) }
}

describe('GET /aionui-panel/raw', () => {
  it('streams workspace bytes with the derived mime and no-cache', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-route-')))
    const root = join(dir, 'proj')
    await mkdir(join(root, 'assets'), { recursive: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
    await writeFile(join(root, 'assets', 'pic.png'), png)
    const gate: WorkspaceGate = async () => ({ ok: true, canonical: root })
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')
    expect(row).toBeDefined()

    const result = await request(row!.handler, 'GET', `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=assets/pic.png`)
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('image/png')
    expect(result.headers['cache-control']).toBe('no-cache')
    expect(result.body.equals(png)).toBe(true)

    // A root-relative path with percent-encoded segments resolves the same.
    const encoded = await request(row!.handler, 'GET', `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=assets%2Fpic.png`)
    expect(encoded.status).toBe(200)
    expect(encoded.body.equals(png)).toBe(true)

    await rm(dir, { recursive: true, force: true })
  })

  it('maps missing files to 404, .git and directories to 403, bad params to 400', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-route-')))
    const root = join(dir, 'proj')
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, '.git', 'config'), 'cfg')
    const gate: WorkspaceGate = async () => ({ ok: true, canonical: root })
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')!

    const missing = await request(row.handler, 'GET', `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=nope.png`)
    expect(missing.status).toBe(404)
    const gitPath = await request(row.handler, 'GET', `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=.git/config`)
    expect(gitPath.status).toBe(403)
    const dirPath = await request(row.handler, 'GET', `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=.git`)
    expect(dirPath.status).toBe(403)
    const empty = await request(row.handler, 'GET', `/aionui-panel/raw?root=${encodeURIComponent(root)}`)
    expect(empty.status).toBe(400)
    // Other GET paths are still rejected with 405.
    const other = await request(row.handler, 'GET', '/aionui-panel/list')
    expect(other.status).toBe(405)

    await rm(dir, { recursive: true, force: true })
  })

  it('rejects non-loopback raw reads with 403 before touching the filesystem', async () => {
    const gate: WorkspaceGate = async () => ({ ok: true, canonical: '/tmp/nope' })
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')!

    const result = await request(row.handler, 'GET', '/aionui-panel/raw?root=%2Fw&path=a.png', {
      remoteAddress: '192.168.1.20',
      host: '192.168.1.10:3000',
    })

    expect(result.status).toBe(403)
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(result.body.toString('utf8'))).toEqual({ error: 'forbidden: loopback-only' })
  })

  it('serves single byte ranges (206) and rejects unsatisfiable ones (416)', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-route-')))
    const root = join(dir, 'proj')
    await mkdir(root, { recursive: true })
    const pdf = Buffer.from('%PDF-1.7 fake body for range tests', 'latin1')
    await writeFile(join(root, 'doc.pdf'), pdf)
    const gate: WorkspaceGate = async () => ({ ok: true, canonical: root })
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')!
    const url = `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=doc.pdf`

    // Full body advertises range support so pdf viewers switch to seeking.
    const full = await request(row.handler, 'GET', url)
    expect(full.status).toBe(200)
    expect(full.headers['content-type']).toBe('application/pdf')
    expect(full.headers['accept-ranges']).toBe('bytes')
    expect(full.body.equals(pdf)).toBe(true)

    const part = await request(row.handler, 'GET', url, { headers: { range: 'bytes=0-4' } })
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 0-4/${pdf.length}`)
    expect(part.headers['content-length']).toBe(5)
    expect(part.body.toString('latin1')).toBe('%PDF-')

    const suffix = await request(row.handler, 'GET', url, { headers: { range: 'bytes=-4' } })
    expect(suffix.status).toBe(206)
    expect(suffix.body.toString('latin1')).toBe(pdf.subarray(pdf.length - 4).toString('latin1'))

    const unsatisfiable = await request(row.handler, 'GET', url, { headers: { range: `bytes=${pdf.length + 10}-` } })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${pdf.length}`)

    await rm(dir, { recursive: true, force: true })
  })

  it('answers validators (ETag/Last-Modified), 304 revalidation, and If-Range fallbacks', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'aionui-route-')))
    const root = join(dir, 'proj')
    await mkdir(root, { recursive: true })
    const pdf = Buffer.from('%PDF-1.7 fake body for validator tests', 'latin1')
    await writeFile(join(root, 'doc.pdf'), pdf)
    const gate: WorkspaceGate = async () => ({ ok: true, canonical: root })
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')!
    const url = `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=doc.pdf`

    // 200 full body carries size+mtime validators (content-length is a number).
    const full = await request(row.handler, 'GET', url)
    expect(full.status).toBe(200)
    expect(full.headers.etag).toMatch(/^W\/"\d+-\d+"$/)
    expect(full.headers['last-modified']).toBe(new Date(full.headers['last-modified']).toUTCString())
    expect(full.headers['content-length']).toBe(pdf.length)
    expect(full.body.equals(pdf)).toBe(true)
    const etag = full.headers.etag
    const lastModified = full.headers['last-modified']

    // 206 partial responses carry the same validators.
    const part = await request(row.handler, 'GET', url, { headers: { range: 'bytes=0-4' } })
    expect(part.status).toBe(206)
    expect(part.headers.etag).toBe(etag)
    expect(part.headers['last-modified']).toBe(lastModified)

    // If-None-Match with no Range answers 304 with an empty body and validators.
    const revalidate = await request(row.handler, 'GET', url, { headers: { 'if-none-match': etag } })
    expect(revalidate.status).toBe(304)
    expect(revalidate.headers.etag).toBe(etag)
    expect(revalidate.headers['last-modified']).toBe(lastModified)
    expect(revalidate.body.length).toBe(0)

    // Multi-range requests are ignored per RFC 7233: 200 with the full body.
    const multi = await request(row.handler, 'GET', url, { headers: { range: 'bytes=0-1,3-4' } })
    expect(multi.status).toBe(200)
    expect(multi.body.equals(pdf)).toBe(true)

    // If-Range matching the current validator keeps the range honored (206).
    const ifRangeMatch = await request(row.handler, 'GET', url, {
      headers: { range: 'bytes=0-4', 'if-range': etag },
    })
    expect(ifRangeMatch.status).toBe(206)
    expect(ifRangeMatch.headers['content-range']).toBe(`bytes 0-4/${pdf.length}`)

    // If-Range matching Last-Modified (the date form) is also honored.
    const ifRangeDate = await request(row.handler, 'GET', url, {
      headers: { range: 'bytes=0-4', 'if-range': lastModified },
    })
    expect(ifRangeDate.status).toBe(206)

    // A stale If-Range falls back to the full 200 body instead of a stale slice.
    const ifRangeStale = await request(row.handler, 'GET', url, {
      headers: { range: 'bytes=0-4', 'if-range': 'W/"1-1"' },
    })
    expect(ifRangeStale.status).toBe(200)
    expect(ifRangeStale.body.equals(pdf)).toBe(true)

    // 416 responses carry validators too, so clients can revalidate the size.
    const unsatisfiable = await request(row.handler, 'GET', url, { headers: { range: `bytes=${pdf.length + 10}-` } })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.etag).toBe(etag)
    expect(unsatisfiable.headers['last-modified']).toBe(lastModified)

    await rm(dir, { recursive: true, force: true })
  })
})

describe('parseRangeHeader', () => {
  it('returns null without a header and clamps open-ended ranges', () => {
    expect(parseRangeHeader(undefined, 100)).toBeNull()
    expect(parseRangeHeader('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
    expect(parseRangeHeader('bytes=0-999', 100)).toEqual({ start: 0, end: 99 })
  })

  it('handles suffix ranges and ignores unsupported shapes per RFC 7233', () => {
    expect(parseRangeHeader('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    // Unknown units, malformed headers and multi-range requests return null:
    // the caller ignores the Range and answers 200 with the full body.
    expect(parseRangeHeader('bytes=', 100)).toBeNull()
    expect(parseRangeHeader('bytes=0-1,3-4', 100)).toBeNull()
    expect(parseRangeHeader('items=0-1', 100)).toBeNull()
    expect(parseRangeHeader('garbage', 100)).toBeNull()
  })

  it('rejects unsatisfiable single ranges as invalid (416)', () => {
    expect(parseRangeHeader('bytes=-0', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=-5', 0)).toBe('invalid')
    expect(parseRangeHeader('bytes=100-', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=50-40', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=0-1', 0)).toBe('invalid')
  })
})

describe('ifNoneMatchSaidFresh', () => {
  const etag = 'W/"1000-1692000000000"'

  it('matches a single exact or strong-form tag', () => {
    expect(ifNoneMatchSaidFresh(etag, etag)).toBe(true)
    // Weak comparison: the W/ prefix and quoting are ignored on both sides.
    expect(ifNoneMatchSaidFresh('"1000-1692000000000"', etag)).toBe(true)
    expect(ifNoneMatchSaidFresh('W/"1000-1692000000000"', '"1000-1692000000000"')).toBe(true)
  })

  it('matches comma-separated lists and the star form', () => {
    expect(ifNoneMatchSaidFresh('W/"1-1", W/"1000-1692000000000"', etag)).toBe(true)
    expect(ifNoneMatchSaidFresh('  "5-5" ,  W/"1000-1692000000000" ', etag)).toBe(true)
    expect(ifNoneMatchSaidFresh('*', etag)).toBe(true)
  })

  it('rejects missing headers and non-matching tags', () => {
    expect(ifNoneMatchSaidFresh(undefined, etag)).toBe(false)
    expect(ifNoneMatchSaidFresh('W/"1-1"', etag)).toBe(false)
    expect(ifNoneMatchSaidFresh('"1000-1692000000001"', etag)).toBe(false)
    expect(ifNoneMatchSaidFresh('', etag)).toBe(false)
  })
})
