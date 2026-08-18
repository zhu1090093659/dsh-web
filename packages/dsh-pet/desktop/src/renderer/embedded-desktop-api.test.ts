import { describe, expect, it, vi } from 'vitest'
import {
  PET_DESKTOP_HOST_API_VERSION,
  type PetNativeSurfaceApi,
  type PetNativeSurfaceState,
} from '../../../src/contracts/desktop-host.ts'
import { createEmbeddedDesktopApi } from './embedded-desktop-api.ts'

const companion = {
  enabled: true,
  visible: true,
  alwaysOnTop: true,
  locked: false,
  scale: 1.5,
}

const snapshot = {
  animation: 'idle',
  phase: 'idle',
  sessionActive: false,
  affinity: {
    points: 0,
    rank: '幼鲸',
    pets: 0,
    feeds: 0,
    turns: 0,
    petCooldown: false,
    feedCooldown: false,
  },
  companion,
  treats: { stocked: 0, max: 20 },
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function surfaceMock(): PetNativeSurfaceApi & { openReturnTarget: ReturnType<typeof vi.fn> } {
  let state: PetNativeSurfaceState = {
    bounds: { x: 900, y: 100, width: 228, height: 304 },
    visible: true,
    alwaysOnTop: true,
    returnTarget: {
      kind: 'desktop-host',
      id: 'dshcode-main',
      label: '返回 DSHCode',
      hostId: 'dshcode',
      route: { kind: 'home' },
    },
  }
  const listeners = new Set<(value: PetNativeSurfaceState) => void>()
  const update = (next: PetNativeSurfaceState): PetNativeSurfaceState => {
    state = structuredClone(next)
    for (const listener of listeners) listener(structuredClone(state))
    return structuredClone(state)
  }
  return {
    apiVersion: PET_DESKTOP_HOST_API_VERSION,
    getState: vi.fn(async () => structuredClone(state)),
    show: vi.fn(async () => update({ ...state, visible: true })),
    hide: vi.fn(async () => update({ ...state, visible: false })),
    setBounds: vi.fn(async bounds => update({ ...state, bounds })),
    setAlwaysOnTop: vi.fn(async alwaysOnTop => update({ ...state, alwaysOnTop })),
    beginDrag: vi.fn(async () => structuredClone(state)),
    endDrag: vi.fn(async () => ({ state: structuredClone(state), moved: false })),
    openReturnTarget: vi.fn(async () => undefined),
    onStateChanged: vi.fn((listener) => {
      listeners.add(listener)
      return { dispose: () => { listeners.delete(listener) } }
    }),
  }
}

describe('embedded desktop renderer bridge', () => {
  it('keeps business requests in dsh-pet while delegating native surface operations', async () => {
    let currentCompanion = { ...companion }
    const requests: Array<{ url: string, init: RequestInit | undefined }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/state')) return json({ ...snapshot, companion: currentCompanion })
      if (url.endsWith('/models')) return json([{
        schemaVersion: 1,
        id: 'builtin:whale',
        displayName: '鲸鱼娘',
        description: 'dsh-pet 内置像素模型',
        rendererId: 'builtin:sprite2d',
        format: 'petdex-v1',
        entry: 'spritesheet.webp',
        source: { kind: 'builtin' },
        capabilities: {
          motions: ['idle'], expressions: [], lookAt: false, lipSync: false, hitAreas: ['body'],
        },
        bindings: { motions: { idle: 'idle' }, expressions: {} },
        fallback: { motion: 'idle', expression: 'neutral' },
      }])
      if (url.endsWith('/surface-settings')) {
        currentCompanion = { ...currentCompanion, ...JSON.parse(String(init?.body)) as object }
        return json({ ok: true, companion: currentCompanion })
      }
      if (url.endsWith('/interact')) return json({ reaction: '好呀', accepted: true })
      throw new Error(`unexpected request ${url}`)
    })
    const storageValues = new Map<string, string>()
    const storage = {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storageValues.set(key, value) },
    }
    const surface = surfaceMock()
    const api = createEmbeddedDesktopApi(surface, {
      origin: 'http://127.0.0.1:43127',
      fetch: fetchImpl as typeof fetch,
      storage,
    })

    const initial = await api.getState()
    expect(initial).toMatchObject({
      scale: 1.5,
      returnTarget: { kind: 'desktop-host', hostId: 'dshcode' },
      bounds: { x: 786, width: 342, height: 456 },
    })
    const expanded = await api.setDrawerOpen(true)
    expect(expanded.bounds).toEqual({ x: 336, y: 100, width: 792, height: 456 })
    expect(expanded.bounds.x + expanded.bounds.width).toBe(1128)

    await api.setScale(1)
    await api.setAlwaysOnTop(false)
    await api.setLocked(true)
    expect(await api.getState()).toMatchObject({
      scale: 1,
      locked: true,
      alwaysOnTop: false,
      bounds: { width: 528, height: 304 },
    })
    await api.openReturnTarget()
    expect(surface.openReturnTarget).toHaveBeenCalledOnce()
    await expect(api.interact('pet')).resolves.toMatchObject({
      reaction: '好呀', accepted: true, intent: { source: 'interaction', motion: 'pet' },
    })

    expect(await api.getModels()).toEqual([expect.objectContaining({ id: 'builtin:whale' })])
    await api.renameModel('builtin:whale', '小鲸')
    expect((await api.getState()).modelAliases['builtin:whale']).toBe('小鲸')
    expect(storageValues.get('dsh-pet:model-names')).toContain('小鲸')
    await api.setQuality('high')
    expect((await api.getState()).quality).toBe('high')

    expect(requests.some(request => {
      const headers = new Headers(request.init?.headers)
      return headers.has('authorization')
    })).toBe(false)
  })
})
