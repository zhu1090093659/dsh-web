import { describe, expect, it, vi } from 'vitest'
import { UsageService } from '../src/core/usage.ts'

describe('remote-bridge usage deepseekAuth and deepseekAccount support', () => {
  it('user querying deepseek balance with ctx.deepseekAuth mounted uses authorized headers and caches by authorization fingerprint', async () => {
    // Given a host exposing ctx.deepseekAuth (DSH 0.2.3-alpha.2+) and no legacy credentials store
    let token = 'key-a'
    const authorize = vi.fn(async () => ({
      kind: 'api-key' as const,
      endpoint: 'https://api.deepseek.com/user/balance',
      headers: { Authorization: `Bearer ${token}` },
    }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        balance_infos: [{ currency: 'CNY', total_balance: '100.50', topped_up_balance: '80.50', granted_balance: '20.00' }],
      }),
    }))
    const usage = new UsageService({
      faces: () => ({ deepseekAuth: { authorize } }),
      now: () => 1_000,
      log: () => {},
      fetch: fetchMock,
    })
    // When balance is requested twice with the same key and once after rotating the key
    const first = await usage.balance('deepseek')
    const second = await usage.balance('deepseek')
    token = 'key-b'
    const rotated = await usage.balance('deepseek')
    // Then the first two share one cached upstream probe, and rotating the key probes again
    expect(first).toEqual({
      provider: 'deepseek',
      currency: 'CNY',
      total: 100.5,
      toppedUp: 80.5,
      granted: 20,
      updatedAt: 1_000,
    })
    expect(second).toEqual(first)
    expect(rotated).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('user querying deepseek-account balance reads recharge and bonus wallets from ctx.deepseekAccount', async () => {
    // Given a host exposing ctx.deepseekAccount with signed-in recharge and bonus CNY wallets
    const getBalance = vi.fn(async () => ({
      status: 'ready' as const,
      value: [{ currency: 'CNY', balance: '45.00' }],
      bonusWallets: [{ currency: 'CNY', balance: '5.25' }],
    }))
    const usage = new UsageService({
      faces: () => ({
        deepseekAccount: {
          getState: async () => ({ status: 'credential-stored' as const }),
          getBalance,
        },
      }),
      now: () => 2_000,
      log: () => {},
    })
    // When usage.balance queries the deepseek-account route
    const answer = await usage.balance('deepseek-account')
    // Then recharge and bonus wallets are aggregated cleanly into the wire answer
    expect(answer).toEqual({
      provider: 'deepseek-account',
      currency: 'CNY',
      toppedUp: 45,
      granted: 5.25,
      total: 50.25,
      updatedAt: 2_000,
    })
    expect(getBalance).toHaveBeenCalledOnce()
  })

  it('user querying deepseek-account balance while signed out receives no-credential', async () => {
    // Given a signed-out ctx.deepseekAccount service
    const usage = new UsageService({
      faces: () => ({
        deepseekAccount: {
          getState: async () => ({ status: 'signed-out' as const }),
          getBalance: async () => null,
        },
      }),
      now: () => 3_000,
      log: () => {},
    })
    // When usage.balance queries deepseek-account
    const answer = await usage.balance('deepseek-account')
    // Then it reports no-credential instead of failing
    expect(answer).toEqual({ provider: 'deepseek-account', unsupported: 'no-credential' })
  })
})
