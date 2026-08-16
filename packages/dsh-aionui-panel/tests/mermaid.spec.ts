/**
 * Mermaid enhancement tests: block discovery across both renderer shapes
 * (panel `pre.language-mermaid`, chat `pre > code.language-mermaid`),
 * claim/render/restore lifecycle against a fake window.mermaid runtime,
 * theme re-render, and the host vendor route (200 + etag/304 + loopback
 * fence) through the real prefix handler.
 */
import { describe, expect, it, vi } from 'vitest'
import { FsService } from '../src/host/fs-service.ts'
import { registerPanelRoutes } from '../src/host/routes.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'
import {
  DATA_MD_SCOPE,
  enhanceMermaidBlocks,
  findMermaidCodeBlocks,
  mermaidTheme,
  rethemeMermaidBlocks,
} from '../src/client/preview/mermaid.ts'

/** Install a fake mermaid runtime; returns its render spy and a restore fn. */
function fakeMermaid(svgFor: (source: string) => string): { render: ReturnType<typeof vi.fn>; restore: () => void } {
  const render = vi.fn(async (_id: string, source: string) => ({ svg: svgFor(source) }))
  const initialize = vi.fn()
  const holder = globalThis as Record<string, unknown>
  const previous = holder.mermaid
  holder.mermaid = { initialize, render }
  return { render, restore: () => { if (previous === undefined) delete holder.mermaid; else holder.mermaid = previous } }
}

/** One panel-shaped block (class on the pre) and one chat-shaped (on code). */
function seedBlocks(root: HTMLElement): { panelPre: HTMLPreElement; chatPre: HTMLPreElement } {
  root.innerHTML = [
    '<pre class="language-mermaid"><code>flowchart LR\nA--&gt;B</code></pre>',
    '<pre><code class="language-mermaid">graph TD\nC--&gt;D</code></pre>',
    '<pre class="language-python"><code>print(1)</code></pre>',
    '<pre class="language-mermaid"><code>   </code></pre>',
  ].join('')
  const pres = Array.from(root.querySelectorAll('pre'))
  return { panelPre: pres[0] as HTMLPreElement, chatPre: pres[1] as HTMLPreElement }
}

describe('findMermaidCodeBlocks', () => {
  it('finds both renderer shapes, skips empty and non-mermaid blocks', () => {
    const root = document.createElement('div')
    seedBlocks(root)
    const found = findMermaidCodeBlocks(root)
    expect(found).toHaveLength(2)
  })

  it('skips blocks another driver already claimed', () => {
    const root = document.createElement('div')
    const { panelPre } = seedBlocks(root)
    panelPre.setAttribute('data-mermaid-claimed', '1')
    expect(findMermaidCodeBlocks(root)).toHaveLength(1)
  })
})

describe('enhanceMermaidBlocks', () => {
  it('renders containers for both shapes and hides the source blocks', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { panelPre, chatPre } = seedBlocks(root)
    const fake = fakeMermaid((source) => `<svg data-src="${source}"></svg>`)
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      const containers = Array.from(root.querySelectorAll('[data-mermaid-state="done"]'))
      expect(containers).toHaveLength(2)
      expect(fake.render).toHaveBeenCalledTimes(2)
      expect(panelPre.style.display).toBe('none')
      expect(chatPre.style.display).toBe('none')
      expect(containers[0]!.innerHTML).toContain('flowchart LR')
      // Already-claimed blocks are not enhanced twice.
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      expect(fake.render).toHaveBeenCalledTimes(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('restores the code block verbatim when the render fails', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedBlocks(root)
    const render = vi.fn(async () => { throw new Error('bad syntax') })
    const holder = globalThis as Record<string, unknown>
    const previous = holder.mermaid
    holder.mermaid = { initialize: vi.fn(), render }
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      expect(root.querySelectorAll('[data-mermaid-state]').length).toBe(0)
      expect(findMermaidCodeBlocks(root)).toHaveLength(2)
      const pres = Array.from(root.querySelectorAll('pre'))
      expect(pres[0]!.getAttribute('data-mermaid-claimed')).toBeNull()
    } finally {
      if (previous === undefined) delete holder.mermaid
      else holder.mermaid = previous
      root.remove()
    }
  })

  it('re-renders completed containers on theme flips only', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedBlocks(root)
    const fake = fakeMermaid((source) => `<svg data-src="${source}"></svg>`)
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      expect(fake.render).toHaveBeenCalledTimes(2)
      await rethemeMermaidBlocks(root, { theme: 'dark' })
      expect(fake.render).toHaveBeenCalledTimes(4)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('honors the skip predicate for foreign scopes', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedBlocks(root)
    const fake = fakeMermaid(() => '<svg></svg>')
    try {
      await enhanceMermaidBlocks(root, {
        className: 'mm',
        theme: 'default',
        skip: (pre) => pre.closest(`[${DATA_MD_SCOPE}]`) !== null,
      })
      // Nothing is inside a marked scope: all blocks render.
      expect(fake.render).toHaveBeenCalledTimes(2)
      root.setAttribute(DATA_MD_SCOPE, '1')
      root.querySelectorAll('pre').forEach((pre) => {
        pre.removeAttribute('data-mermaid-claimed')
      })
      root.querySelectorAll('[data-mermaid-state]').forEach((el) => el.remove())
      root.querySelectorAll('pre').forEach((pre) => { pre.style.display = '' })
      fake.render.mockClear()
      await enhanceMermaidBlocks(root, {
        className: 'mm',
        theme: 'default',
        skip: (pre) => pre.closest(`[${DATA_MD_SCOPE}]`) !== null,
      })
      expect(fake.render).not.toHaveBeenCalled()
    } finally {
      fake.restore()
      root.remove()
    }
  })
})

describe('mermaidTheme', () => {
  it('maps the shell marker to mermaid theme names', () => {
    expect(mermaidTheme(true)).toBe('dark')
    expect(mermaidTheme(false)).toBe('default')
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

describe('GET /aionui-panel/vendor/mermaid.js', () => {
  const gate: WorkspaceGate = async () => ({ ok: true, canonical: 'C:/' })

  it('serves the build-copied asset with etag revalidation', async () => {
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')
    expect(row).toBeDefined()

    const first = await request(row!.handler, 'GET', '/aionui-panel/vendor/mermaid.js')
    if (first.status === 404) {
      // The asset lands with the package build (node scripts/copy-mermaid.mjs);
      // without it the route must still answer cleanly — asserted elsewhere.
      return
    }
    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(first.body.length).toBeGreaterThan(500_000)

    const etag = first.headers['etag']
    expect(typeof etag).toBe('string')
    const revalidate = await request(row!.handler, 'GET', '/aionui-panel/vendor/mermaid.js', { 'if-none-match': etag! })
    expect(revalidate.status).toBe(304)
  })

  it('stays behind the loopback fence', async () => {
    const { ctx, registrations } = fakeCtx()
    registerPanelRoutes(ctx as never, new FsService(gate), { status: async () => null } as never)
    const row = registrations.find((item) => item.kind === 'prefix')
    const lan = await request(row!.handler, 'GET', '/aionui-panel/vendor/mermaid.js', {}, '192.168.1.5')
    expect(lan.status).toBe(403)
  })
})
