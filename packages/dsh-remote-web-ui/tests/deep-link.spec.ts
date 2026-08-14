// @vitest-environment jsdom
/** The phone-side boot flow: pair accept, deep link params, URL stripping. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAIR_FAILED_MARKER, runPairBootFlow, type PageSurface } from '../src/client/deep-link.ts'
import { readPairParams, stripParam } from '../src/client/pair-api.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

/** A fake page surface with a mutable URL. */
function fakePage(search: string): { page: PageSurface; reload: ReturnType<typeof vi.fn>; replaceState: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> } {
  let href = `http://localhost:3000/${search}`
  const reload = vi.fn()
  const replaceState = vi.fn((url: string) => { href = url })
  const navigate = vi.fn((url: string) => { href = url })
  return {
    reload,
    replaceState,
    navigate,
    page: {
      get href(): string { return href },
      replaceState,
      navigate,
      reload,
    },
  }
}

describe('readPairParams', () => {
  it('extracts pair and workspace, ignoring empty values', () => {
    expect(readPairParams('?pair=tok-1&workspace=ws-7')).toEqual({ pair: 'tok-1', workspace: 'ws-7' })
    expect(readPairParams('?pair=tok-1')).toEqual({ pair: 'tok-1' })
    expect(readPairParams('?workspace=ws-7')).toEqual({ workspace: 'ws-7' })
    expect(readPairParams('?pair=&workspace=')).toEqual({})
    expect(readPairParams('')).toEqual({})
  })
})

describe('stripParam', () => {
  it('returns the search without the named parameter (pure read)', () => {
    window.history.replaceState(null, '', '/?pair=tok-1&workspace=ws-7')
    expect(stripParam('pair')).toBe('?workspace=ws-7')
    expect(stripParam('workspace')).toBe('?pair=tok-1')
  })
})

describe('runPairBootFlow', () => {
  it('accepts the token and reloads (workspace param survives)', async () => {
    const { page, reload, replaceState } = fakePage('?pair=tok-1&workspace=ws-7')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    // A minimal ctx: runPairBootFlow only touches it on the deep-link path.
    const ctx = { get: () => undefined }
    runPairBootFlow(ctx as never, '?pair=tok-1&workspace=ws-7', page)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/pair/accept', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'tok-1' }),
    })))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(replaceState).toHaveBeenCalledWith('/?workspace=ws-7')
    expect(sessionStorage.getItem(PAIR_FAILED_MARKER)).toBeNull()
  })

  it('routes accepted phones to the standalone /m surface instead of reloading', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' })
    const { page, reload, navigate, replaceState } = fakePage('?pair=tok-1')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const ctx = { get: () => undefined }
    runPairBootFlow(ctx as never, '?pair=tok-1', page)
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/m'))
    expect(reload).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalledWith('/')
  })

  it('preserves the workspace target when routing an accepted phone to /m', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Android 16; Mobile)' })
    const { page, navigate, replaceState } = fakePage('?pair=tok-1&workspace=ws-7')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const ctx = { get: () => undefined }

    runPairBootFlow(ctx as never, '?pair=tok-1&workspace=ws-7', page)

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/m?workspace=ws-7'))
    expect(replaceState).toHaveBeenCalledWith('/?workspace=ws-7')
  })

  it('marks the failure instead of reloading when the token is refused', async () => {
    const { page, reload } = fakePage('?pair=tok-1')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'used' }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    runPairBootFlow({ get: () => undefined } as never, '?pair=tok-1', page)
    await vi.waitFor(() => expect(sessionStorage.getItem(PAIR_FAILED_MARKER)).toBe('failed'))
    expect(reload).not.toHaveBeenCalled()
  })

  it('deep-links into the workspace when paired (no pair param)', async () => {
    const { page, replaceState } = fakePage('?workspace=ws-7')
    const opened: string[] = []
    const ctx = {
      get(name: string): unknown {
        if (name === 'workspaces') {
          return {
            list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-7' }] }) },
            connectWorkspace: async (id: string) => { opened.push(id); return 'session-9' },
          }
        }
        if (name === 'sessions') {
          return { list: { getSnapshot: () => ({ current: undefined }) }, open: (id: string) => { opened.push(id) } }
        }
        return undefined
      },
    }
    runPairBootFlow(ctx as never, '?workspace=ws-7', page)
    await vi.waitFor(() => expect(opened).toEqual(['ws-7', 'session-9']))
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalledWith('/'))
  })

  it('waits for the target workspace to appear in the list before connecting', async () => {
    const { page, replaceState } = fakePage('?workspace=ws-7')
    const opened: string[] = []
    let items: Array<{ workspaceId: string }> = []
    const ctx = {
      get(name: string): unknown {
        if (name === 'workspaces') {
          return {
            list: { getSnapshot: () => ({ items }) },
            connectWorkspace: async (id: string) => { opened.push(id); return 'session-9' },
          }
        }
        if (name === 'sessions') {
          return { list: { getSnapshot: () => ({ current: undefined }) }, open: (id: string) => { opened.push(id) } }
        }
        return undefined
      },
    }
    runPairBootFlow(ctx as never, '?workspace=ws-7', page)
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(opened).toEqual([])
    items = [{ workspaceId: 'ws-7' }]
    await vi.waitFor(() => expect(opened).toEqual(['ws-7', 'session-9']))
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalledWith('/'))
  })
})
