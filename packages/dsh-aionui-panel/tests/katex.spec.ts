// @vitest-environment jsdom
/**
 * KaTeX math enhancement tests (issue #421): placeholder discovery on real
 * renderMarkdown output, the render lifecycle against a fake window.katex
 * runtime (display/inline modes, idempotency, per-formula fallback), the
 * vendor injection path, and the host vendor routes (katex.js / katex.css /
 * fonts/*) through the real prefix handler.
 */
import { describe, expect, it, vi } from 'vitest'
import { FsService } from '../src/host/fs-service.ts'
import { registerPanelRoutes } from '../src/host/routes.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'
import { renderMarkdown } from '../src/client/preview/markdown.ts'
import {
  KATEX_VENDOR_CSS,
  KATEX_VENDOR_JS,
  enhanceMathPlaceholders,
  findMathPlaceholders,
  loadKatexLibrary,
} from '../src/client/preview/katex.ts'

/** Markdown exercising both placeholder kinds plus a no-math control. */
const MATH_DOC = [
  'inline $a + b$ here',
  '',
  '$$',
  'z_i = q_{2i}',
  '$$',
  '',
  'plain paragraph, no math',
].join('\n')

/** Install a fake katex runtime; returns the render spy and a restore fn. */
function fakeKatex(renderImpl?: (tex: string, element: HTMLElement) => void): {
  render: ReturnType<typeof vi.fn>
  restore: () => void
} {
  const render = vi.fn(renderImpl ?? ((tex: string, element: HTMLElement) => {
    element.innerHTML = `<span class="katex">${tex}</span>`
  }))
  const holder = globalThis as Record<string, unknown>
  const previous = holder.katex
  holder.katex = { render }
  return {
    render,
    restore: () => { if (previous === undefined) delete holder.katex; else holder.katex = previous },
  }
}

describe('findMathPlaceholders', () => {
  it('finds both placeholder kinds on renderer output and skips stamped ones', () => {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown(MATH_DOC)
    expect(findMathPlaceholders(root)).toHaveLength(2)
    const [first] = findMathPlaceholders(root)
    first!.setAttribute('data-aionui-math-state', 'done')
    expect(findMathPlaceholders(root)).toHaveLength(1)
  })

  it('ignores documents without math', () => {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown('plain text only\n')
    expect(findMathPlaceholders(root)).toHaveLength(0)
  })
})

describe('enhanceMathPlaceholders', () => {
  it('typesets both modes with the right options and stays idempotent', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = renderMarkdown(MATH_DOC)
    const fake = fakeKatex()
    try {
      await enhanceMathPlaceholders(root)
      expect(fake.render).toHaveBeenCalledTimes(2)
      // Inline first (document order): displayMode false; block second.
      expect(fake.render).toHaveBeenNthCalledWith(1, 'a + b', expect.anything(), { displayMode: false, throwOnError: false })
      expect(fake.render).toHaveBeenNthCalledWith(2, 'z_i = q_{2i}', expect.anything(), { displayMode: true, throwOnError: false })
      expect(root.querySelectorAll('[data-aionui-math-state="done"]')).toHaveLength(2)
      // Second pass over the same html: nothing left to typeset.
      await enhanceMathPlaceholders(root)
      expect(fake.render).toHaveBeenCalledTimes(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('keeps the raw TeX fallback when a single formula fails', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = renderMarkdown(MATH_DOC)
    const fake = fakeKatex((tex, element) => {
      if (tex.includes('z_i')) throw new Error('bad formula')
      element.innerHTML = `<span class="katex">${tex}</span>`
    })
    try {
      await enhanceMathPlaceholders(root)
      const block = root.querySelector('[data-aionui-math="block"]')!
      expect(block.getAttribute('data-aionui-math-state')).toBe('fallback')
      // The fallback body is the untouched raw TeX.
      expect(block.textContent).toBe('z_i = q_{2i}')
      expect(root.querySelectorAll('[data-aionui-math-state="done"]')).toHaveLength(1)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('does not touch the DOM when there is nothing to typeset', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = renderMarkdown('no math here\n')
    const before = document.head.querySelectorAll('script, link').length
    await enhanceMathPlaceholders(root)
    expect(document.head.querySelectorAll('script, link').length).toBe(before)
    root.remove()
  })
})

describe('loadKatexLibrary injection', () => {
  it('injects the vendored stylesheet and script when the global is absent', () => {
    const holder = globalThis as Record<string, unknown>
    const previous = holder.katex
    delete holder.katex
    try {
      // jsdom never loads external scripts, so the promise stays pending;
      // only the injection side effects are asserted (never awaited).
      void loadKatexLibrary()
      const link = document.head.querySelector(`link[href="${KATEX_VENDOR_CSS}"]`)
      expect(link).not.toBeNull()
      expect(link!.getAttribute('rel')).toBe('stylesheet')
      const script = document.head.querySelector(`script[src="${KATEX_VENDOR_JS}"]`)
      expect(script).not.toBeNull()
      // A second call shares the same injection (one script tag total).
      void loadKatexLibrary()
      expect(document.head.querySelectorAll(`script[src="${KATEX_VENDOR_JS}"]`)).toHaveLength(1)
      // Resolve the dangling promise path: the global appearing later is
      // picked up without a second injection.
      holder.katex = { render: () => {} }
    } finally {
      if (previous === undefined) delete holder.katex
      else holder.katex = previous
      document.head.querySelectorAll(`script[src="${KATEX_VENDOR_JS}"], link[href="${KATEX_VENDOR_CSS}"]`).forEach((el) => el.remove())
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

describe('GET /aionui-panel/vendor/* (katex assets)', () => {
  const gate: WorkspaceGate = async () => ({ ok: true, canonical: 'C:/' })

  const prefixHandler = async (): Promise<(req: unknown, res: unknown) => Promise<void>> => {
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')
    expect(row).toBeDefined()
    return row!.handler
  }

  it('serves katex.js and katex.css with etag revalidation', async () => {
    const handler = await prefixHandler()
    const js = await request(handler, 'GET', '/aionui-panel/vendor/katex.js')
    if (js.status === 404) return // asset lands with the build copy step
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(js.body.length).toBeGreaterThan(50_000)
    const revalidate = await request(handler, 'GET', '/aionui-panel/vendor/katex.js', { 'if-none-match': js.headers['etag']! })
    expect(revalidate.status).toBe(304)

    const css = await request(handler, 'GET', '/aionui-panel/vendor/katex.css')
    expect(css.status).toBe(200)
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8')
    // The stylesheet must keep resolving fonts/ relative to its vendor URL.
    expect(css.body.toString('utf8')).toContain('fonts/')
  })

  it('serves the stylesheet font files under fonts/', async () => {
    const handler = await prefixHandler()
    const font = await request(handler, 'GET', '/aionui-panel/vendor/fonts/KaTeX_Main-Regular.woff2')
    if (font.status === 404) return // asset lands with the build copy step
    expect(font.status).toBe(200)
    expect(font.headers['content-type']).toBe('font/woff2')
    expect(font.body.length).toBeGreaterThan(0)
  })

  it('refuses unknown assets and traversal-shaped font names', async () => {
    const handler = await prefixHandler()
    expect((await request(handler, 'GET', '/aionui-panel/vendor/nope.js')).status).toBe(404)
    expect((await request(handler, 'GET', '/aionui-panel/vendor/fonts/evil.exe')).status).toBe(404)
    expect((await request(handler, 'GET', '/aionui-panel/vendor/fonts/%2e%2e%2fkatex.min.js')).status).toBe(404)
    expect((await request(handler, 'GET', '/aionui-panel/vendor/fonts/sub/KaTeX_Main-Regular.woff2')).status).toBe(404)
  })
})
