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
import { parseRangeHeader, registerPanelRoutes } from '../src/host/routes.ts'
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
  options: { remoteAddress?: string; host?: string; range?: string } = {},
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
      ...(options.range !== undefined ? { range: options.range } : {}),
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

    const part = await request(row.handler, 'GET', url, { range: 'bytes=0-4' })
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 0-4/${pdf.length}`)
    expect(part.headers['content-length']).toBe(5)
    expect(part.body.toString('latin1')).toBe('%PDF-')

    const suffix = await request(row.handler, 'GET', url, { range: 'bytes=-4' })
    expect(suffix.status).toBe(206)
    expect(suffix.body.toString('latin1')).toBe(pdf.subarray(pdf.length - 4).toString('latin1'))

    const unsatisfiable = await request(row.handler, 'GET', url, { range: `bytes=${pdf.length + 10}-` })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${pdf.length}`)

    await rm(dir, { recursive: true, force: true })
  })
})

describe('parseRangeHeader', () => {
  it('returns null without a header and clamps open-ended ranges', () => {
    expect(parseRangeHeader(undefined, 100)).toBeNull()
    expect(parseRangeHeader('bytes=10-', 100)).toEqual({ start: 10, end: 99 })
    expect(parseRangeHeader('bytes=0-999', 100)).toEqual({ start: 0, end: 99 })
  })

  it('handles suffix ranges and rejects malformed/unsatisfiable ones', () => {
    expect(parseRangeHeader('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRangeHeader('bytes=-0', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=-5', 0)).toBe('invalid')
    expect(parseRangeHeader('bytes=', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=0-1,3-4', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=100-', 100)).toBe('invalid')
    expect(parseRangeHeader('bytes=50-40', 100)).toBe('invalid')
    expect(parseRangeHeader('items=0-1', 100)).toBe('invalid')
  })
})
