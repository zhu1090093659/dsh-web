import { describe, expect, it, vi } from 'vitest'
import { guardedHandler, runGuarded } from '../host/run-guarded.js'

describe('runGuarded', () => {
  it('consumes rejections of fire-and-forget promises', async () => {
    const log = vi.fn()
    const boom = Promise.reject(new Error('boom'))
    const returned = runGuarded(boom, 'site', log)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('[site] unhandled async failure: Error: boom')
    expect(returned).toBe(boom)
  })

  it('leaves resolved values untouched', async () => {
    const log = vi.fn()
    const value = await runGuarded(Promise.resolve(42), 'site', log)
    expect(value).toBe(42)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('guardedHandler', () => {
  it('guards sync throws per invocation', () => {
    const log = vi.fn()
    const handler = guardedHandler('site', () => {
      throw new Error('sync boom')
    }, log)
    expect(handler()).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('sync failure')
  })

  it('guards async rejections per invocation', async () => {
    const log = vi.fn()
    const handler = guardedHandler('site', async () => {
      throw new Error('async boom')
    }, log)
    expect(handler()).toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('async boom')
  })

  it('passes sync return values through', () => {
    const handler = guardedHandler('site', (a: number) => a * 2, vi.fn())
    expect(handler(21)).toBe(42)
  })

  it('guards each invocation independently', async () => {
    const log = vi.fn()
    const handler = guardedHandler('site', (fail: boolean) => {
      if (fail) throw new Error('no')
      return 'ok'
    }, log)
    expect(handler(false)).toBe('ok')
    expect(handler(true)).toBeUndefined()
    expect(handler(false)).toBe('ok')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]).toBeTruthy()
  })
})