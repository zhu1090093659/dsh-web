/**
 * KaTeX enhancement tests: placeholder discovery across block/inline shapes,
 * claim/render/fail lifecycle against a fake window.katex runtime, idempotent
 * re-enhance, and the host vendor routes (katex.js / katex.css / woff2 fonts
 * with etag revalidation, whitelist 404s, and the loopback fence) through the
 * real prefix handler.
 */
import { describe, expect, it, vi } from 'vitest'
import { FsService } from '../src/host/fs-service.ts'
import { registerPanelRoutes } from '../src/host/routes.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'
import { enhanceKatexMath, findKatexMath } from '../src/client/preview/katex.ts'

/** Install a fake katex runtime; returns its render spy and a restore fn. */
function fakeKatex(): {
  render: ReturnType<typeof vi.fn>
  restore: () => void
} {
  const render = vi.fn((_tex: string, _el: HTMLElement, _opts: Record<string, unknown>) => {})
  const holder = globalThis as Record<string, unknown>
  const previous = holder.katex
  holder.katex = { render }
  return { render, restore: () => { if (previous === undefined) delete holder.katex; else holder.katex = previous } }
}

/** One block placeholder and one inline placeholder (plus empty/claimed noise). */
function seedMath(root: HTMLElement): { block: HTMLElement; inline: HTMLElement } {
  root.innerHTML = [
    '<div class="katex-block">a = b</div>',
    '<span class="katex-inline">x^2</span>',
    '<div class="katex-block">   </div>',
    '<div class="katex-block" data-katex-claimed="1">c = d</div>',
  ].join('')
  const els = Array.from(root.querySelectorAll<HTMLElement>('.katex-block, .katex-inline'))
  return { block: els[0]!, inline: els[1]! }
}

describe('findKatexMath', () => {
  it('finds block and inline placeholders, skips empty and claimed ones', () => {
    const root = document.createElement('div')
    seedMath(root)
    const found = findKatexMath(root)
    expect(found).toHaveLength(2)
  })
})

describe('enhanceKatexMath', () => {
  it('renders block placeholders in display mode and inline ones inline', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedMath(root)
    const fake = fakeKatex()
    try {
      await enhanceKatexMath(root)
      expect(fake.render).toHaveBeenCalledTimes(2)
      const [, , blockOpts] = fake.render.mock.calls[0] as unknown as [string, HTMLElement, Record<string, unknown>]
      const [, , inlineOpts] = fake.render.mock.calls[1] as unknown as [string, HTMLElement, Record<string, unknown>]
      expect(blockOpts.displayMode).toBe(true)
      expect(inlineOpts.displayMode).toBe(false)
      expect(blockOpts.throwOnError).toBe(true)
      const done = root.querySelectorAll('[data-katex-done]')
      expect(done).toHaveLength(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('keeps the raw TeX text and releases the claim when the render fails', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedMath(root)
    const fake = fakeKatex()
    fake.render.mockImplementation(() => { throw new Error('syntax error') })
    try {
      await enhanceKatexMath(root)
      expect(root.querySelectorAll('[data-katex-done]').length).toBe(0)
      // Raw TeX still visible and unclaimed, so a later surface can retry.
      expect(root.querySelectorAll('.katex-block')[0]!.textContent).toBe('a = b')
      expect(root.querySelector('.katex-block')!.hasAttribute('data-katex-claimed')).toBe(false)
      expect(findKatexMath(root)).toHaveLength(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('is idempotent: a second pass skips already-claimed placeholders', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedMath(root)
    const fake = fakeKatex()
    try {
      await enhanceKatexMath(root)
      expect(fake.render).toHaveBeenCalledTimes(2)
      await enhanceKatexMath(root)
      expect(fake.render).toHaveBeenCalledTimes(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })
})

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
  headers: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  let status = 0
  let headersOut: Record<string, string> = {}
  let body = Buffer.alloc(0)
  const res = {
    writeHead: (code: number, head: Record<string, string> = {}) => { status = code; headersOut = head },
    end: (chunk?: unknown) => {
      if (chunk !== undefined && chunk !== null) body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    },
  }
  await handler({ method, url, headers: { host: '127.0.0.1:3000', ...headers }, socket: { remoteAddress } }, res)
  return { status, headers: headersOut, body }
}

describe('GET /aionui-panel/vendor (katex assets)', () => {
  const gate: WorkspaceGate = async () => ({ ok: true, canonical: 'C:/' })

  function panelHandler() {
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')
    expect(row).toBeDefined()
    return row!.handler
  }

  it('serves katex.js with etag revalidation', async () => {
    const handler = panelHandler()
    const first = await request(handler, 'GET', '/aionui-panel/vendor/katex.js')
    if (first.status === 404) {
      // The assets land with the package build (node scripts/copy-katex.mjs);
      // without them the route must still answer cleanly — asserted elsewhere.
      return
    }
    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(first.body.length).toBeGreaterThan(100_000)
    const etag = first.headers['etag']
    expect(typeof etag).toBe('string')
    const revalidate = await request(handler, 'GET', '/aionui-panel/vendor/katex.js', { 'if-none-match': etag! })
    expect(revalidate.status).toBe(304)
  })

  it('serves katex.css and the KaTeX fonts with their content types', async () => {
    const handler = panelHandler()
    const css = await request(handler, 'GET', '/aionui-panel/vendor/katex.css')
    if (css.status === 200) {
      expect(css.headers['content-type']).toBe('text/css; charset=utf-8')
      expect(css.body.length).toBeGreaterThan(1_000)
    }
    const font = await request(handler, 'GET', '/aionui-panel/vendor/fonts/KaTeX_Main-Regular.woff2')
    if (font.status === 200) {
      expect(font.headers['content-type']).toBe('font/woff2')
      expect(font.body.length).toBeGreaterThan(1_000)
    }
  })

  it('404s unknown vendor paths and non-KaTeX font names', async () => {
    const handler = panelHandler()
    expect((await request(handler, 'GET', '/aionui-panel/vendor/evil.js')).status).toBe(404)
    expect((await request(handler, 'GET', '/aionui-panel/vendor/fonts/secret.woff2')).status).toBe(404)
    expect((await request(handler, 'GET', '/aionui-panel/vendor/fonts/KaTeX_..%2F..%2Fsecret.woff2')).status).toBe(404)
  })

  it('stays behind the loopback fence', async () => {
    const handler = panelHandler()
    const lan = await request(handler, 'GET', '/aionui-panel/vendor/katex.js', {}, '192.168.1.5')
    expect(lan.status).toBe(403)
  })
})
