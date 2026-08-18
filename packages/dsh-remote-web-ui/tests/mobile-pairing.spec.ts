import { describe, expect, it, vi } from 'vitest'
import { acceptMobilePair, consumeMobilePairUrl, mobilePairPath, parseMobilePairInput } from '../src/mobile/pairing.ts'

describe('mobile pairing helpers', () => {
  it('parses a copied pairing link and preserves its workspace target', () => {
    expect(parseMobilePairInput('https://phone.example/m/?pair=tok-1&workspace=ws-7')).toEqual({ token: 'tok-1', workspaceId: 'ws-7' })
    expect(parseMobilePairInput('tok-1')).toEqual({ token: 'tok-1' })
    expect(parseMobilePairInput('https://phone.example/m/')).toBeUndefined()
    expect(mobilePairPath('ws-7')).toBe('/m/?workspace=ws-7')
    expect(mobilePairPath()).toBe('/m/')
  })

  it('accepts a QR token and removes it from the next mobile path', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(consumeMobilePairUrl('https://phone.example/m/?pair=tok-1&workspace=ws-7', fetcher)).resolves.toEqual({ kind: 'accepted', path: '/m/?workspace=ws-7' })
    expect(fetcher).toHaveBeenCalledWith('/api/pair/accept', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'tok-1' }),
    }))
  })

  it('returns a clean retry path when the pairing token is refused', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: 'used' }), { status: 409 }))
    await expect(consumeMobilePairUrl('https://phone.example/m/?pair=tok-1', fetcher)).resolves.toEqual({
      kind: 'failed',
      path: '/m/',
      message: '配对链接已被使用。',
    })
  })

  it('maps unavailable pairing service failures without throwing', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(acceptMobilePair('tok-1', fetcher)).resolves.toEqual({ ok: false, message: '无法连接到配对服务。' })
  })
})
