// @vitest-environment jsdom
/**
 * Live2D runtime loader tests (pet-center M3) — globals short-circuit, probe
 * injection success/failure, and the runtime-route URLs the host serves.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ensureCubismCore, ensureLive2dVendor, resetLive2dRuntime, type Live2dVendor } from './runtime.ts'

afterEach(() => {
  resetLive2dRuntime()
  delete window.Live2DCubismCore
  delete window.__dshPetLive2d
})

describe('ensureCubismCore', () => {
  it('short-circuits when the global already exists', async () => {
    window.Live2DCubismCore = {}
    await expect(ensureCubismCore({ inject: () => Promise.reject(new Error('must not inject')) })).resolves.toBe(true)
  })
  it('injects the runtime-route core URL and checks the global afterwards', async () => {
    const seen: string[] = []
    const ok = await ensureCubismCore({
      inject: (src) => {
        seen.push(src)
        window.Live2DCubismCore = {}
        return Promise.resolve()
      },
    })
    expect(ok).toBe(true)
    expect(seen).toEqual(['/api/pet/runtime/live2dcubismcore.min.js'])
  })
  it('resolves false when the user has not installed the core', async () => {
    await expect(ensureCubismCore({ inject: () => Promise.reject(new Error('404')) })).resolves.toBe(false)
    // Even a successful script load without the global means absence.
    await expect(ensureCubismCore({ inject: () => Promise.resolve() })).resolves.toBe(false)
  })
})

describe('ensureLive2dVendor', () => {
  it('short-circuits on the existing global', async () => {
    const vendor = { marker: true } as unknown as Live2dVendor
    window.__dshPetLive2d = vendor
    await expect(ensureLive2dVendor({ inject: () => Promise.reject(new Error('must not inject')) })).resolves.toBe(vendor)
  })
  it('injects the vendor URL and returns the global it sets', async () => {
    const seen: string[] = []
    const vendor = { marker: true } as unknown as Live2dVendor
    const loaded = await ensureLive2dVendor({
      inject: (src) => {
        seen.push(src)
        window.__dshPetLive2d = vendor
        return Promise.resolve()
      },
    })
    expect(loaded).toBe(vendor)
    expect(seen).toEqual(['/api/pet/runtime/live2d-vendor.js'])
  })
  it('resolves undefined when the vendor file is unavailable', async () => {
    await expect(ensureLive2dVendor({ inject: () => Promise.reject(new Error('404')) })).resolves.toBeUndefined()
  })
})
