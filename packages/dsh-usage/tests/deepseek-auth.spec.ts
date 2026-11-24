// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { UsageService } from '../src/host/usage-service.ts'

const temps: string[] = []
const originalDshHome = process.env.DSH_HOME

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-usage-auth-'))
  temps.push(dir)
  process.env.DSH_HOME = dir
  return dir
}

describe('official ctx.deepseekAuth integration', () => {
  it('user with ctx.deepseekAuth mounted sees official DeepSeek balance probed via deepseekAuth headers without direct credential store reads', async () => {
    // Given a host exposing llm and ctx.deepseekAuth (DSH 0.2.3-alpha.2+), and no direct credentials service
    makeHome()
    const authorize = vi.fn(async () => ({
      kind: 'api-key' as const,
      endpoint: 'https://api.deepseek.com/user/balance',
      headers: { Authorization: 'Bearer auth-service-key' },
    }))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '88.50', granted_balance: '10.00', topped_up_balance: '78.50' }],
      }),
      headers: init?.headers,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const ctx = {
      on: () => () => {},
      get: (name: string) => {
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
            listConfigurableProviders: () => [],
          }
        }
        if (name === 'deepseekAuth') return { authorize }
        return undefined
      },
    } as unknown as Context

    const svc = new UsageService(ctx, { pollIntervalSec: 300, retainDays: 30 })
    try {
      // When a usage refresh runs
      await svc.pollNow()
      // Then deepseekAuth authorized the request and the official balance landed in the overview
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          consumer: 'dsh-usage',
          accepts: ['api-key'],
          billing: 'api-key',
          route: 'deepseek',
          destination: { path: '/user/balance' },
        }),
        expect.any(AbortSignal),
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
      expect(calledUrl).toBe('https://api.deepseek.com/user/balance')
      expect(new Headers(calledInit?.headers).get('authorization')).toBe('Bearer auth-service-key')
      const provider = svc.overview().providers.find((entry) => entry.provider === 'deepseek')
      expect(provider?.credential).toBe('api-key')
      expect(provider?.balance).toMatchObject({ currency: 'CNY', totalBalance: '88.50' })
    } finally {
      await svc.stop()
    }
  })

  it('user pointing deepseek route at a third-party baseURL never probes the official balance via deepseekAuth', async () => {
    // Given a host with ctx.deepseekAuth mounted, but the deepseek route configured to a third-party origin
    makeHome()
    const authorize = vi.fn(async () => ({
      kind: 'api-key' as const,
      endpoint: 'https://api.deepseek.com/user/balance',
      headers: { Authorization: 'Bearer auth-service-key' },
    }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const ctx = {
      on: () => () => {},
      get: (name: string) => {
        if (name === 'llm') {
          return {
            listProviders: () => [{ id: 'deepseek', name: 'DeepSeek Proxy' }],
            listConfigurableProviders: () => [],
          }
        }
        if (name === 'deepseekAuth') return { authorize }
        if (name === 'settings') {
          return {
            get: (ns: string) => ns === 'llm-deepseek' ? { baseURL: 'https://proxy.example.com/v1' } : undefined,
          }
        }
        return undefined
      },
    } as unknown as Context

    const svc = new UsageService(ctx, { pollIntervalSec: 300, retainDays: 30 })
    try {
      // When a usage refresh runs
      await svc.pollNow()
      // Then neither deepseekAuth nor the official balance endpoint is called for the third-party origin
      expect(authorize).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
      const provider = svc.overview().providers.find((entry) => entry.provider === 'deepseek')
      expect(provider?.balanceSupported).toBe(false)
    } finally {
      await svc.stop()
    }
  })
})
