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
  sanitizeSvg,
} from '../src/client/preview/mermaid.ts'

/** Install a fake mermaid runtime; returns its render/initialize spies and a restore fn. */
function fakeMermaid(svgFor: (source: string) => string): {
  render: ReturnType<typeof vi.fn>
  initialize: ReturnType<typeof vi.fn>
  restore: () => void
} {
  const render = vi.fn(async (_id: string, source: string) => ({ svg: svgFor(source) }))
  const initialize = vi.fn()
  const holder = globalThis as Record<string, unknown>
  const previous = holder.mermaid
  holder.mermaid = { initialize, render }
  return { render, initialize, restore: () => { if (previous === undefined) delete holder.mermaid; else holder.mermaid = previous } }
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

/** The shell chat renderer shape: div.md-code-block + banner infostring + plain pre (no language class). */
function seedShellChatBlock(root: HTMLElement, lang: string, code = 'gitGraph\ncommit'): HTMLPreElement {
  const block = document.createElement('div')
  block.className = '_block_178r4_4 md-code-block'
  block.innerHTML = [
    '<div class="_bannerWrap_178r4_8"><div class="_banner_178r4_16">',
    `<div class="_infostring_178r4_42">${lang}</div>`,
    '<button type="button">copy</button>',
    '</div></div>',
    `<pre class="_plain_178r4_94"><code>${code}</code></pre>`,
  ].join('')
  root.appendChild(block)
  return block.querySelector('pre') as HTMLPreElement
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

  it('finds the shell chat shape by its banner infostring (no language class on pre/code)', () => {
    const root = document.createElement('div')
    const pre = seedShellChatBlock(root, 'mermaid')
    const found = findMermaidCodeBlocks(root)
    expect(found).toEqual([pre])
  })

  it('skips shell blocks whose infostring is not mermaid or still empty (streaming)', () => {
    const root = document.createElement('div')
    seedShellChatBlock(root, 'typescript')
    seedShellChatBlock(root, '')
    expect(findMermaidCodeBlocks(root)).toHaveLength(0)
  })

  it('skips shell blocks with empty code text or already claimed', () => {
    const root = document.createElement('div')
    seedShellChatBlock(root, 'mermaid', '   ')
    const claimed = seedShellChatBlock(root, 'mermaid')
    claimed.setAttribute('data-mermaid-claimed', '1')
    expect(findMermaidCodeBlocks(root)).toHaveLength(0)
  })

  it('matches the shell block when the scope is the block element itself', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pre = seedShellChatBlock(root, 'mermaid')
    const block = pre.closest('div.md-code-block') as Element
    try {
      expect(findMermaidCodeBlocks(block)).toEqual([pre])
    } finally {
      root.remove()
    }
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
      // One multi-block enhance batch initializes the runtime exactly once.
      expect(fake.initialize).toHaveBeenCalledTimes(1)
      expect(panelPre.style.display).toBe('none')
      expect(chatPre.style.display).toBe('none')
      expect(containers[0]!.innerHTML).toContain('flowchart LR')
      // Already-claimed blocks are not enhanced twice.
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      expect(fake.render).toHaveBeenCalledTimes(2)
      expect(fake.initialize).toHaveBeenCalledTimes(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('renders the shell chat shape and keeps its banner intact', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pre = seedShellChatBlock(root, 'mermaid')
    const fake = fakeMermaid((source) => `<svg data-src="${source}"></svg>`)
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      expect(fake.render).toHaveBeenCalledTimes(1)
      const container = root.querySelector('[data-mermaid-state="done"]')
      expect(container).not.toBeNull()
      expect(pre.style.display).toBe('none')
      // The banner (infostring + copy button) stays visible above the diagram.
      expect(root.querySelector('[class*="_infostring_"]')?.textContent).toBe('mermaid')
      expect(container!.previousSibling).toBe(pre)
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
      expect(fake.initialize).toHaveBeenCalledTimes(1)
      await rethemeMermaidBlocks(root, { theme: 'dark' })
      expect(fake.render).toHaveBeenCalledTimes(4)
      // A one-call retheme batch still initializes the runtime exactly once.
      expect(fake.initialize).toHaveBeenCalledTimes(2)
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('a multi-container retheme batch initializes the runtime exactly once', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = Array.from({ length: 4 }, (_, i) =>
      `<pre class="language-mermaid"><code>flowchart LR\nN${i}--&gt;M${i}</code></pre>`,
    ).join('')
    const fake = fakeMermaid((source) => `<svg data-src="${source}"></svg>`)
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      expect(fake.render).toHaveBeenCalledTimes(4)
      fake.initialize.mockClear()
      fake.render.mockClear()
      await rethemeMermaidBlocks(root, { theme: 'dark' })
      expect(fake.render).toHaveBeenCalledTimes(4)
      // One retheme batch re-initializes the runtime once, not per container.
      expect(fake.initialize).toHaveBeenCalledTimes(1)
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

  it('never assigns disposable content and restores the code block on a hostile render', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { panelPre } = seedBlocks(root)
    // A hostile render result: script + foreignObject + onload handle + an
    // href=javascript: link, plus a javascript: token in element text that the
    // sanitizer cannot attribute-strip, so it must reject the whole payload.
    const malicious = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<rect width="100" height="100" onload="alert(1)"/>',
      '<script>alert("xss")</script>',
      '<foreignObject><div onclick="evil()">x</div></foreignObject>',
      '<a href="javascript:alert(1)">bad</a>',
      '<text>javascript:alert(2)</text>',
      '</svg>',
    ].join('')
    const fake = fakeMermaid(() => malicious)
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      // sanitizeSvg rejects the payload, so the enhance failure path restores
      // the untouched code block and nothing dangerous ever reaches the DOM.
      expect(root.querySelectorAll('[data-mermaid-state]').length).toBe(0)
      expect(findMermaidCodeBlocks(root)).toHaveLength(2)
      expect(panelPre.getAttribute('data-mermaid-claimed')).toBeNull()
      expect(panelPre.style.display).not.toBe('none')
      expect(root.innerHTML).not.toContain('<script')
      expect(root.innerHTML).not.toContain('foreignObject')
      expect(root.innerHTML).not.toContain('onload')
      expect(root.innerHTML).not.toContain('onclick')
      expect(root.innerHTML).not.toContain('javascript:')
    } finally {
      fake.restore()
      root.remove()
    }
  })

  it('retheme rejects a hostile re-render and keeps the previous clean render', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    seedBlocks(root)
    const fake = fakeMermaid((source) => '<svg data-src="' + source + '"></svg>')
    try {
      await enhanceMermaidBlocks(root, { className: 'mm', theme: 'default' })
      const [container] = Array.from(root.querySelectorAll<HTMLElement>('[data-mermaid-state="done"]'))
      expect(container).toBeDefined()
      const before = container!.innerHTML

      // A hostile re-render: script + foreignObject + onload + an href=javascript:
      // while a javascript: token survives as text, forcing sanitizeSvg to throw
      // so retheme keeps the previous render.
      fake.render.mockImplementationOnce(async function realRender() {
        return {
          svg: '<svg><script>alert("xss")</script><foreignObject onload="evil()">x</foreignObject><a href="javascript:void(0)">x</a><text>javascript:alert(2)</text></svg>',
        }
      })
      await rethemeMermaidBlocks(root, { theme: 'dark' })

      expect(container!.innerHTML).toBe(before)
      expect(container!.innerHTML).not.toContain('<script')
      expect(container!.innerHTML).not.toContain('foreignObject')
      expect(container!.innerHTML).not.toContain('onload')
      expect(container!.innerHTML).not.toContain('javascript:')
    } finally {
      fake.restore()
      root.remove()
    }
  })
})

describe('sanitizeSvg', () => {
  it('removes disallowed elements and strips dangerous attributes', () => {
    const input = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<rect width="10" height="10" onload="alert(1)"/>',
      '<path d="M0 0"/>',
      '<text>hi</text>',
      '<script>alert("xss")</script>',
      '<foreignObject><div onclick="evil()">x</div></foreignObject>',
      '<a href="javascript:alert(1)">bad</a>',
      '<a xlink:href="JaVaScRiPt:evil()">bad2</a>',
      '</svg>',
    ].join('')
    const out = sanitizeSvg(input)
    expect(out).not.toContain('<script')
    expect(out).not.toContain('foreignObject')
    expect(out).not.toContain('onload')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<path')
    expect(out).toContain('<text')
    expect(out).toContain('<rect')
  })

  it('passes benign markup through unchanged', () => {
    const benign = ['<svg xmlns="http://www.w3.org/2000/svg">', '<rect width="10" height="10" fill="red"/>', '<path d="M0 0H10"/>', '<text x="2" y="4">hello</text>', '</svg>'].join('')
    expect(sanitizeSvg(benign)).toContain('<rect')
    expect(sanitizeSvg(benign)).toContain('<path')
    expect(sanitizeSvg(benign)).toContain('<text')
  })

  it('throws when a dangerous raw token survives cleaning', () => {
    // A javascript: token inside element text is not an attribute the user
    // can strip, so the fail-closed guard rejects the whole payload rather
    // than letting a raw token through.
    expect(() => sanitizeSvg('<svg><text>href=\"javascript:alert(1)\"</text></svg>')).toThrow()
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
