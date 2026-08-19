import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getAllDisplays: vi.fn(() => []),
    getPrimaryDisplay: vi.fn(),
    getDisplayMatching: vi.fn(),
    getCursorScreenPoint: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}))

import { ConfigStore, DEFAULT_DESKTOP_CONFIG } from './config-store.ts'
import { WindowManager } from './window-manager.ts'

interface FakeRecoveryWindow {
  isDestroyed: ReturnType<typeof vi.fn>
  webContents: EventEmitter & {
    isDestroyed: ReturnType<typeof vi.fn>
    reloadIgnoringCache: ReturnType<typeof vi.fn>
  }
}

function recoveryManager(onUnrecoverable: () => void): {
  manager: WindowManager
  window: FakeRecoveryWindow
} {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    reloadIgnoringCache: vi.fn(),
  })
  const window = { isDestroyed: vi.fn(() => false), webContents }
  const manager = new WindowManager(
    structuredClone(DEFAULT_DESKTOP_CONFIG),
    new ConfigStore('unused.json'),
    () => undefined,
    undefined,
    onUnrecoverable,
  )
  ;(manager as unknown as { window: FakeRecoveryWindow }).window = window
  return { manager, window }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WindowManager renderer recovery', () => {
  it('remains recovery-scoped until did-finish-load', () => {
    vi.useFakeTimers()
    const onUnrecoverable = vi.fn()
    const { manager, window } = recoveryManager(onUnrecoverable)

    expect(manager.recoverRenderer()).toBe(true)
    vi.advanceTimersByTime(50)
    expect(window.webContents.reloadIgnoringCache).toHaveBeenCalledOnce()

    expect(manager.recoverRenderer()).toBe(false)
    expect(onUnrecoverable).not.toHaveBeenCalled()

    window.webContents.emit('did-finish-load')
    expect(manager.recoverRenderer()).toBe(false)
    expect(onUnrecoverable).toHaveBeenCalledOnce()
  })

  it('reports a main-frame load failure as unrecoverable', () => {
    vi.useFakeTimers()
    const onUnrecoverable = vi.fn()
    const { manager, window } = recoveryManager(onUnrecoverable)

    expect(manager.recoverRenderer()).toBe(true)
    vi.advanceTimersByTime(50)
    window.webContents.emit('did-fail-load', {}, -105, 'name not resolved', 'https://dsh.invalid', true)

    expect(onUnrecoverable).toHaveBeenCalledOnce()
    expect(window.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(window.webContents.listenerCount('did-fail-load')).toBe(0)
  })

  it('reports a renderer reload timeout as unrecoverable', () => {
    vi.useFakeTimers()
    const onUnrecoverable = vi.fn()
    const { manager, window } = recoveryManager(onUnrecoverable)

    expect(manager.recoverRenderer()).toBe(true)
    vi.advanceTimersByTime(50 + 14_999)
    expect(onUnrecoverable).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(onUnrecoverable).toHaveBeenCalledOnce()
    expect(window.webContents.listenerCount('did-finish-load')).toBe(0)
    expect(window.webContents.listenerCount('did-fail-load')).toBe(0)
  })
})
