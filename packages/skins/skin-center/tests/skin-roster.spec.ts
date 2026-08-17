/** Client roster loading: dynamic host metadata with a static compatibility fallback. */
import { describe, expect, it } from 'vitest'
import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from '../src/client/generated/skins.ts'
import { loadSkinRoster } from '../src/client/skin-roster.ts'

const customSkin: SkinCenterEntry = {
  id: 'custom-wallpaper',
  name: '自定义壁纸',
  nameEn: 'Custom Wallpaper',
  tagline: 'Local wallpaper skin',
  accent: '#336699',
  bodyAttr: 'data-dsh-custom-wallpaper',
  package: '@local/dsh-client-ui-skin-custom-wallpaper',
  order: 42,
}

describe('loadSkinRoster', () => {
  it('uses the dynamic roster returned by the host', async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({
      ok: true,
      skins: [customSkin],
    }), { status: 200, headers: { 'content-type': 'application/json' } })

    await expect(loadSkinRoster(fetcher)).resolves.toEqual([customSkin])
  })

  it('keeps the generated roster when the host endpoint is unavailable', async () => {
    const fetcher = async (): Promise<Response> => { throw new Error('old host') }

    await expect(loadSkinRoster(fetcher)).resolves.toBe(SKIN_CENTER_ENTRIES)
  })

  it('keeps the generated roster for a non-success response', async () => {
    const fetcher = async (): Promise<Response> => new Response('not found', { status: 404 })

    await expect(loadSkinRoster(fetcher)).resolves.toBe(SKIN_CENTER_ENTRIES)
  })

  it('keeps the generated roster when any dynamic entry is malformed', async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({
      ok: true,
      skins: [customSkin, { ...customSkin, bodyAttr: 'onclick' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })

    await expect(loadSkinRoster(fetcher)).resolves.toBe(SKIN_CENTER_ENTRIES)
  })
})
