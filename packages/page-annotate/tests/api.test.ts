import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInteractiveBrowser } from '../src/client/api.ts'

afterEach(() => vi.unstubAllGlobals())

describe('interactive browser client API', () => {
  it('attaches an abort signal so a stalled host request can recover', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, value: { url: 'https://example.com/' } }) })
    vi.stubGlobal('fetch', fetchMock)

    await openInteractiveBrowser('https://example.com/')

    expect(fetchMock).toHaveBeenCalledWith('/page-annotate/browser/open', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
