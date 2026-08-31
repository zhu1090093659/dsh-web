/**
 * Contract tests for the 'pluginManager' cordis service: apply() provides the
 * shared dual-channel face with the contract shape, onChange listeners fire
 * after successful mutations (a throwing listener never breaks the others,
 * and a failed mutation notifies nobody), and the returned unsubscribe stops
 * delivery. The connection RPC and the gateway fetch are mocked; the mode
 * probe rides the fetch stub, so every mutation resolves through the official
 * channel mock.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

// The official primitives are a closure-factory client bundle (not importable
// under vitest); the tab is never rendered here, so an empty stub suffices.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null,
  Modal: () => null,
}))

import { apply, type PluginManagerFace } from '../src/client/index.ts'
import type { InstalledPluginItem } from '../src/core/protocol.ts'

const plugin: InstalledPluginItem = {
  id: 'p1', name: 'p1', version: '1.0.0', source: { kind: 'npm', spec: '@scope/p1' }, installedAt: '2026-08-18T00:00:00.000Z', enabled: true,
}

interface Setup {
  face: PluginManagerFace
  slotFace: () => unknown
  rpcCall: ReturnType<typeof vi.fn>
}

/** Run apply() against a mocked context and capture the provided face. */
function setup(): Setup {
  const rpcCall = vi.fn(async (channel: string, endpoint: string) => {
    if (channel === '/plugin-installer') {
      if (endpoint === 'install' || endpoint === 'update' || endpoint === 'set-enabled') return { ok: true as const, value: { plugin } }
      if (endpoint === 'uninstall') return { ok: true as const, value: { plugins: [] } }
      if (endpoint === 'list') return { ok: true as const, value: { plugins: [plugin] } }
      if (endpoint === 'status') return { ok: true as const, value: { progress: { kind: 'idle', stage: 'fetch' } } }
    }
    if (channel === '/plugin-control') return { ok: true as const, value: { controls: [] } }
    return { ok: false as const, error: { code: 'unknown', message: 'unexpected call' } }
  })
  const connection = { isLoopback: true, rpc: { call: rpcCall } } as unknown as ConnectionHandle

  const provided = new Map<string, unknown>()
  let slotFace: () => unknown = () => undefined
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
    get: (name: string) => name === 'connection' ? connection : undefined,
    provide: vi.fn((name: string, value: unknown) => { provided.set(name, value); return () => {} }),
    slots: {
      inject: vi.fn((_name: string, cb: () => unknown) => { cb() }),
      register: vi.fn((options: { inject: () => unknown }) => { slotFace = options.inject; return () => {} }),
    },
    workspaces: {},
    sessions: {},
  }
  apply(ctx as unknown as ClientContext)

  const face = provided.get('pluginManager') as PluginManagerFace | undefined
  if (face === undefined) throw new Error('apply() did not provide the pluginManager service')
  return { face, slotFace, rpcCall }
}

afterEach(() => { vi.unstubAllGlobals() })

/** Stub the gateway /mode probe so ensureMode picks the official channel. */
function stubOfficialMode(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ official: true }), { status: 200 })))
}

describe('pluginManager cordis service', () => {
  it('apply() provides the pluginManager service with the contract shape', () => {
    const { face, slotFace } = setup()
    expect(typeof face.isLoopback).toBe('boolean')
    expect(typeof face.list).toBe('function')
    expect(typeof face.install).toBe('function')
    expect(typeof face.uninstall).toBe('function')
    expect(typeof face.status).toBe('function')
    expect(typeof face.onChange).toBe('function')
    // The Plugin manager tab receives the same shared face instance.
    expect(slotFace()).toBe(face)
  })

  it('notifies onChange listeners after a successful install and uninstall', async () => {
    stubOfficialMode()
    const { face } = setup()
    const cb = vi.fn()
    face.onChange(cb)
    await face.install('@scope/p1')
    expect(cb).toHaveBeenCalledTimes(1)
    await face.uninstall('p1')
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('probes the in-process official channel when desktop mode is indeterminate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ official: null }), { status: 200 })))
    const { face, rpcCall } = setup()

    await expect(face.list()).resolves.toEqual([plugin])
    expect(rpcCall).toHaveBeenCalledWith('/plugin-installer', 'list', {})
  })

  it('does not notify when a mutation fails, and a throwing listener never breaks the others', async () => {
    stubOfficialMode()
    const { face, rpcCall } = setup()
    const good = vi.fn()
    face.onChange(() => { throw new Error('consumer listener failure') })
    face.onChange(good)

    rpcCall.mockImplementationOnce(async () => ({ ok: false as const, error: { code: 'boom', message: 'install failed' } }))
    await expect(face.install('@scope/p1')).rejects.toThrow('install failed')
    expect(good).not.toHaveBeenCalled()

    await face.install('@scope/p1')
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('stops delivery after the returned unsubscribe runs', async () => {
    stubOfficialMode()
    const { face } = setup()
    const cb = vi.fn()
    const off = face.onChange(cb)
    off()
    await face.install('@scope/p1')
    expect(cb).not.toHaveBeenCalled()
  })
})
