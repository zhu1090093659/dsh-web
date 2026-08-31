// @vitest-environment jsdom
/** The pair boot flow: accept the QR token, then reload into the official UI. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAIR_FAILED_MARKER, runPairBootFlow, type PageSurface } from '../src/client/deep-link.ts'
import { readPairParams } from '../src/client/pair-api.ts'

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
  it('extracts the pair token, ignoring empty values', () => {
    expect(readPairParams('?pair=tok-1&workspace=ws-7')).toEqual({ pair: 'tok-1' })
    expect(readPairParams('?pair=tok-1')).toEqual({ pair: 'tok-1' })
    expect(readPairParams('?pair=')).toEqual({})
    expect(readPairParams('')).toEqual({})
  })
})

describe('runPairBootFlow', () => {
  it('accepts the token, strips it from the URL, and reloads (any device)', async () => {
    const { page, reload, replaceState, navigate } = fakePage('?pair=tok-1&workspace=ws-7')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    runPairBootFlow({ get: () => undefined } as never, '?pair=tok-1&workspace=ws-7', page)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/pair/accept', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'tok-1' }),
    })))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(replaceState).toHaveBeenCalledWith('/?workspace=ws-7')
    // The official UI is the only surface: no /m/ navigation on any device.
    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PAIR_FAILED_MARKER)).toBeNull()
  })

  it('marks the failure instead of reloading when the token is refused', async () => {
    const { page, reload } = fakePage('?pair=tok-1')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'used' }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    runPairBootFlow({ get: () => undefined } as never, '?pair=tok-1', page)
    await vi.waitFor(() => expect(sessionStorage.getItem(PAIR_FAILED_MARKER)).toBe('failed'))
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing without a pair param', () => {
    const { page, reload, navigate } = fakePage('')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    runPairBootFlow({ get: () => undefined } as never, '', page)
    expect(fetch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
