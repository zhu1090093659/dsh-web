/**
 * Poll-loop degradation test: with git missing (git.status resolves
 * git-missing), the SSE poll loop logs ONCE, marks git unavailable, and
 * stops calling git.status on subsequent ticks — the 2s log-spam regression
 * from issue #82 must not come back.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerPanelRoutes } from '../src/host/routes.ts'
import type { FsService } from '../src/host/fs-service.ts'
import type { GitService } from '../src/host/git-service.ts'

const ROOT = '/w'

/** A ctx whose logger.warn is recorded; webServer.register captures handlers. */
function fakeCtx() {
  const warn = vi.fn()
  const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
  const ctx = {
    logger: { warn },
    webServer: {
      register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
        registrations.push(row)
        return () => {}
      },
    },
    effect: (fn: () => void) => { fn(); return () => {} },
  }
  return { ctx, registrations, warn }
}

/** A fake SSE exchange: writable response + close trigger. */
function fakeStream() {
  const res = new EventEmitter() as EventEmitter & { writeHead: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  res.writeHead = vi.fn()
  res.write = vi.fn()
  res.end = vi.fn()
  return res
}

describe('poll loop with missing git (issue #82)', () => {
  it('logs once and stops polling after the first git-missing verdict', { timeout: 15_000 }, async () => {
    const { ctx, registrations, warn } = fakeCtx()
    const status = vi.fn(async () => ({ code: 'git-missing', message: 'git is not installed' }))
    const fs: Pick<FsService, 'verify' | 'watch'> = {
      verify: vi.fn(async () => ({ ok: true as const, canonical: ROOT })),
      watch: vi.fn(() => () => {}),
    }
    const git = { status } as unknown as GitService
    registerPanelRoutes(ctx as never, fs as never, git)

    const sse = registrations.find((item) => item.kind === 'exact' && item.path === '/aionui-panel/events')
    expect(sse).toBeDefined()
    const res = fakeStream()
    const req = new EventEmitter() as EventEmitter & { url?: string }
    req.url = `/aionui-panel/events?root=${encodeURIComponent(ROOT)}`
    await sse!.handler(req as never, res as never)

    // First poll tick: one git.status call, one warning, then the loop parks.
    await new Promise((resolve) => setTimeout(resolve, 2_300))
    expect(status).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('git is not installed')

    // Two more ticks: the loop must not touch the subprocess seam again.
    await new Promise((resolve) => setTimeout(resolve, 4_300))
    expect(status).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)

    // Cleanup: close the stream so the timers are cleared.
    req.emit('close')
  })

  it('keeps polling when git is present but the root is not a repository', async () => {
    const { ctx, registrations, warn } = fakeCtx()
    const status = vi.fn(async () => null)
    const fs: Pick<FsService, 'verify' | 'watch'> = {
      verify: vi.fn(async () => ({ ok: true as const, canonical: ROOT })),
      watch: vi.fn(() => () => {}),
    }
    const git = { status } as unknown as GitService
    registerPanelRoutes(ctx as never, fs as never, git)

    const sse = registrations.find((item) => item.kind === 'exact' && item.path === '/aionui-panel/events')!
    const res = fakeStream()
    const req = new EventEmitter() as EventEmitter & { url?: string }
    req.url = `/aionui-panel/events?root=${encodeURIComponent(ROOT)}`
    await sse.handler(req as never, res as never)

    // Non-repository is an ordinary state: polling continues each tick.
    await new Promise((resolve) => setTimeout(resolve, 2_300))
    await new Promise((resolve) => setTimeout(resolve, 2_300))
    expect(status).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()

    req.emit('close')
  })
})
