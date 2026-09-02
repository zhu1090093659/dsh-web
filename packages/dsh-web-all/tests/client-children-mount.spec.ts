import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountClientChildren } from '../src/client/mount-children.ts'

const MOUNTED_PLUGINS = Symbol.for('dsh-web.mounted-plugins')

vi.mock('../src/client/children.generated.ts', () => ({
  clientChildren: [
    { name: '@linxin666/fake-own-entry', module: { apply: () => {} } },
    { name: '@linxin666/fake-mounts', module: { apply: () => {} } },
    { name: '@linxin666/fake-sync-throw', module: { apply: () => {} } },
    { name: '@linxin666/fake-no-apply', module: {} },
  ],
}))

interface RecordedDefinition {
  name: string
  inject: string[]
  apply: unknown
}

function fakeCtx(outcomes: Record<string, 'ok' | 'reject' | 'throw'> = {}) {
  const mounted: Array<RecordedDefinition> = []
  const ctx = {
    plugin(def: RecordedDefinition) {
      const outcome = outcomes[def.name] ?? 'ok'
      if (outcome === 'throw') throw new Error('sync boom')
      if (outcome === 'reject') return Promise.reject(new Error('async boom'))
      mounted.push(def)
      return Promise.resolve()
    },
  }
  return { ctx: ctx as never, mounted }
}

function bootWith(ids: string[]): void {
  vi.stubGlobal('__DSH_BOOT__', { entries: ids.map((id) => ({ id })) })
}

describe('mountClientChildren', () => {
  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[MOUNTED_PLUGINS]
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(console.error).mockRestore()
  })

  it('skips children the loader serves through their own entries and mounts the rest', () => {
    bootWith(['@linxin666/fake-own-entry'])
    const { ctx, mounted } = fakeCtx()
    mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual(['@linxin666/fake-mounts', '@linxin666/fake-sync-throw'])
    expect(mounted[0].inject).toEqual([])
  })

  it('mounts every child when no boot payload is present', () => {
    const { ctx, mounted } = fakeCtx()
    mountClientChildren(ctx)
    expect(mounted).toHaveLength(3) // every child except the no-apply shape
  })

  it('keeps mounting siblings when one child throws synchronously', () => {
    bootWith([])
    const { ctx, mounted } = fakeCtx({ '@linxin666/fake-mounts': 'throw' })
    expect(() => mountClientChildren(ctx)).not.toThrow()
    expect(mounted.map((def) => def.name)).toEqual(['@linxin666/fake-own-entry', '@linxin666/fake-sync-throw'])
    expect(console.error).toHaveBeenCalledTimes(2) // the throw + the no-apply shape
  })

  it('captures async fiber rejections without escaping', async () => {
    bootWith([])
    const { ctx, mounted } = fakeCtx({ '@linxin666/fake-sync-throw': 'reject' })
    mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual(['@linxin666/fake-own-entry', '@linxin666/fake-mounts'])
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(console.error).toHaveBeenCalledWith(
      '[dsh-web-all] client child degraded: @linxin666/fake-sync-throw',
      expect.any(Error),
    )
  })

  it('honours the shared mount registry across instances', () => {
    bootWith([])
    ;(globalThis as Record<symbol, unknown>)[MOUNTED_PLUGINS] = new Set(['@linxin666/fake-mounts'])
    const { ctx, mounted } = fakeCtx()
    mountClientChildren(ctx)
    expect(mounted.map((def) => def.name)).toEqual(['@linxin666/fake-own-entry', '@linxin666/fake-sync-throw'])
  })
})
