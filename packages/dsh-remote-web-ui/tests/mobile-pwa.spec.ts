import { describe, expect, it, vi } from 'vitest'
import { MOBILE_PWA_SCOPE, MOBILE_SERVICE_WORKER_URL, registerMobilePwa } from '../src/mobile-pwa.ts'

describe('mobile PWA registration', () => {
  it('registers the scoped worker without HTTP cache reuse', async () => {
    const register = vi.fn().mockResolvedValue({})
    await registerMobilePwa({ register })
    expect(register).toHaveBeenCalledWith(MOBILE_SERVICE_WORKER_URL, {
      scope: MOBILE_PWA_SCOPE,
      updateViaCache: 'none',
    })
  })

  it('does nothing when Service Worker is unavailable', async () => {
    await expect(registerMobilePwa(undefined)).resolves.toBeUndefined()
  })

  it('keeps the online mobile client usable when registration fails', async () => {
    const register = vi.fn().mockRejectedValue(new Error('insecure context'))
    await expect(registerMobilePwa({ register })).resolves.toBeUndefined()
  })
})
