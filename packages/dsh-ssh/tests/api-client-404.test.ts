import { describe, expect, it, vi } from 'vitest'
import { SshApi } from '../src/client/api.ts'
import { tt } from '../src/client/panel/helpers.ts'

describe('SshApi 404 disabled error handling', () => {
  it('translates 404 responses into clear disabled plugin message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => { throw new Error('not json') },
      text: async () => 'not found',
    })
    globalThis.fetch = fetchMock as any

    const api = new SshApi()
    await expect(api.listHosts()).rejects.toThrow(tt('error.disabled'))
  })

  it('translates 404 with JSON error body into clear disabled message if error is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '{}',
    })
    globalThis.fetch = fetchMock as any

    const api = new SshApi()
    await expect(api.listHosts()).rejects.toThrow(tt('error.disabled'))
  })
})
