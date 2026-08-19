import { describe, expect, it, vi } from 'vitest'
import type {
  LaunchStandaloneRuntimeOptions,
  StandaloneRuntimeLaunchHandle,
} from '../src/adapters/standalone/launcher.ts'
import type { StandaloneRuntimeView } from '../src/adapters/standalone/runtime-manager.ts'
import type { PetPresentationEnvironment } from '../src/presentation/environment.ts'
import {
  PetPresentationIntegration,
  petPresentationSettings,
  type PetStandaloneRuntime,
} from '../src/presentation/integration.ts'
import type { PetSettingsSection } from '../src/service.ts'

function section(patch: Partial<PetSettingsSection> = {}): PetSettingsSection {
  return {
    visible: true,
    size: 160,
    right: 24,
    bottom: 20,
    enabled: true,
    desktopEnabled: false,
    desktopVisible: true,
    ...patch,
  }
}

function environment(patch: Partial<PetPresentationEnvironment> = {}): PetPresentationEnvironment {
  return {
    platform: 'win32',
    isCi: false,
    isContainer: false,
    isTest: false,
    hasDisplayServer: true,
    appearsInteractive: true,
    standaloneRuntimeAvailable: true,
    webBridgeAvailable: true,
    embeddedHostAvailable: false,
    disabledByEnvironment: false,
    ...patch,
  }
}

class FakeRuntime implements PetStandaloneRuntime {
  private readonly listeners = new Set<(state: StandaloneRuntimeView) => void>()

  constructor(private available = false) {}

  state(): StandaloneRuntimeView {
    return {
      version: '43.4.0',
      platform: 'win32',
      arch: 'x64',
      phase: this.available ? 'ready' : 'not-installed',
      installed: this.available,
      managed: this.available,
      source: 'official',
    }
  }

  executablePath(): string | undefined {
    return this.available ? 'C:\\managed\\electron.exe' : undefined
  }

  subscribe(listener: (state: StandaloneRuntimeView) => void): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => { this.listeners.delete(listener) }
  }

  setAvailable(available: boolean): void {
    this.available = available
    for (const listener of this.listeners) listener(this.state())
  }
}

function launchHandle(
  ready: Promise<void> = Promise.resolve(),
  dispose = vi.fn(),
  pid = 5_100,
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> = new Promise(() => undefined),
): StandaloneRuntimeLaunchHandle {
  return { ready, pid, exited, dispose }
}

function autoReadyLaunch(
  integration: () => PetPresentationIntegration,
  makeHandle: () => StandaloneRuntimeLaunchHandle = () => launchHandle(),
) {
  return vi.fn((options: LaunchStandaloneRuntimeOptions) => {
    const handle = makeHandle()
    queueMicrotask(() => {
      integration().acknowledgeReady(options.sourceId ?? '', handle.pid ?? 5_100)
    })
    return handle
  })
}

describe('production pet presentation integration', () => {
  it('maps the compatibility switch onto one presentation policy source', () => {
    expect(petPresentationSettings(section())).toMatchObject({
      enabled: true,
      activity: { enabled: true },
      presentation: { mode: 'none', standaloneAutoStart: false },
    })
    expect(petPresentationSettings(section({ desktopEnabled: true }))).toMatchObject({
      presentation: { mode: 'auto', standaloneAutoStart: true },
    })
  })

  it('never launches before the user-enabled runtime becomes available', async () => {
    let current = section({ desktopEnabled: true })
    const runtime = new FakeRuntime(false)
    let integration!: PetPresentationIntegration
    const launch = autoReadyLaunch(() => integration)
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => current,
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    expect(launch).not.toHaveBeenCalled()
    expect(integration.state()).toMatchObject({ resolved: 'none', reason: 'runtime-missing' })

    runtime.setAvailable(true)
    await integration.reconcile()
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]?.[0]).toMatchObject({
      runtimeExecutable: 'C:\\managed\\electron.exe',
      origin: 'http://127.0.0.1:3080',
    })

    const disposeProcess = launch.mock.results[0]?.value.dispose
    current = section({ desktopEnabled: false })
    await integration.reconcile()
    expect(disposeProcess).toHaveBeenCalledTimes(1)
    await integration.dispose()
  })

  it('does not launch in CI even when desktop is enabled and runtime is ready', async () => {
    const runtime = new FakeRuntime(true)
    let integration!: PetPresentationIntegration
    const launch = autoReadyLaunch(() => integration)
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => section({ desktopEnabled: true }),
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      readEnvironment: options => environment({
        isCi: true,
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    expect(launch).not.toHaveBeenCalled()
    expect(integration.state()).toMatchObject({ resolved: 'none', reason: 'ci' })
    await integration.dispose()
  })

  it('uses a distinct parent registration for every rapid re-enable generation', async () => {
    let current = section({ desktopEnabled: true })
    const runtime = new FakeRuntime(true)
    let integration!: PetPresentationIntegration
    const launch = autoReadyLaunch(() => integration)
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => current,
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    current = section({ desktopEnabled: false })
    await integration.reconcile()
    current = section({ desktopEnabled: true })
    await integration.reconcile()

    expect(launch).toHaveBeenCalledTimes(2)
    const first = launch.mock.calls[0]?.[0].sourceId
    const second = launch.mock.calls[1]?.[0].sourceId
    expect(first).toMatch(/^dsh-pet:web:\d+:/)
    expect(second).toMatch(/^dsh-pet:web:\d+:/)
    expect(second).not.toBe(first)
    await integration.dispose()
  })

  it('retries an asynchronously reported spawn failure without another settings event', async () => {
    const runtime = new FakeRuntime(true)
    let attempts = 0
    let integration!: PetPresentationIntegration
    const launch = autoReadyLaunch(() => integration, () => {
      attempts += 1
      if (attempts !== 1) return launchHandle()
      return launchHandle(new Promise<void>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('standalone-launch-failed')) }, 0)
      }))
    })
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => section({ desktopEnabled: true }),
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      retryDelayMs: 10,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    expect(integration.state()).toMatchObject({ phase: 'failed' })
    await vi.waitFor(() => {
      expect(launch).toHaveBeenCalledTimes(2)
      expect(integration.state()).toMatchObject({ phase: 'ready' })
    })
    await integration.dispose()
  })

  it('cancels a pending native-ready waiter immediately when desktop is disabled', async () => {
    let current = section({ desktopEnabled: true })
    const runtime = new FakeRuntime(true)
    const disposeProcess = vi.fn()
    const launch = vi.fn((_options: LaunchStandaloneRuntimeOptions) => launchHandle(
      Promise.resolve(),
      disposeProcess,
    ))
    const integration = new PetPresentationIntegration({
      runtime,
      settings: () => current,
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      readyTimeoutMs: 30_000,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    const pending = integration.reconcile()
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce())
    const oldSourceId = launch.mock.calls[0]?.[0].sourceId ?? ''
    current = section({ desktopEnabled: false })
    const disabled = integration.reconcile()
    await expect(Promise.race([
      Promise.all([pending, disabled]),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('cancel timed out')), 250)),
    ])).resolves.toBeDefined()

    expect(disposeProcess).toHaveBeenCalled()
    expect(integration.acknowledgeReady(oldSourceId, 7_000)).toBe(false)
    expect(integration.state()).toMatchObject({ phase: 'none', reason: 'configured-none' })
    await integration.dispose()
  })

  it('stops automatic crash retries after the configured exponential-backoff budget', async () => {
    const runtime = new FakeRuntime(true)
    const onRetryExhausted = vi.fn()
    let integration!: PetPresentationIntegration
    const launch = autoReadyLaunch(() => integration, () => launchHandle(
      Promise.reject(new Error('spawn failed')),
    ))
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => section({ desktopEnabled: true }),
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      retryDelayMs: 5,
      retryBackoffMaxMs: 20,
      maxAutoRetries: 2,
      onRetryExhausted,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(3))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(launch).toHaveBeenCalledTimes(3)
    expect(integration.state()).toMatchObject({ phase: 'failed' })
    expect(onRetryExhausted).toHaveBeenCalledOnce()
    await integration.reconcile()
    expect(onRetryExhausted).toHaveBeenCalledOnce()
    await integration.dispose()
  })

  it('retries only the exhausted-budget notification after a transient persistence failure', async () => {
    const runtime = new FakeRuntime(true)
    const onRetryExhausted = vi.fn()
      .mockRejectedValueOnce(new Error('settings file is temporarily locked'))
      .mockResolvedValue(undefined)
    let integration!: PetPresentationIntegration
    const launch = autoReadyLaunch(() => integration, () => launchHandle(
      Promise.reject(new Error('spawn failed')),
    ))
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => section({ desktopEnabled: true }),
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      retryDelayMs: 5,
      maxAutoRetries: 0,
      onRetryExhausted,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    await vi.waitFor(() => expect(onRetryExhausted).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(launch).toHaveBeenCalledOnce()
    expect(onRetryExhausted).toHaveBeenCalledTimes(2)
    await integration.dispose()
  })

  it('ignores a normal single-instance proxy exit and retries when the acknowledged desktop dies', async () => {
    const runtime = new FakeRuntime(true)
    const alive = new Map<number, boolean>([[9_000, true], [9_001, true]])
    const exitResolvers: Array<(exit: { code: number | null; signal: NodeJS.Signals | null }) => void> = []
    let integration!: PetPresentationIntegration
    const launch = vi.fn((options: LaunchStandaloneRuntimeOptions) => {
      const attempt = launch.mock.calls.length
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        exitResolvers.push(resolve)
      })
      const handle = launchHandle(Promise.resolve(), vi.fn(), 6_000 + attempt, exited)
      queueMicrotask(() => {
        integration.acknowledgeReady(options.sourceId ?? '', 8_999 + attempt)
      })
      return handle
    })
    integration = new PetPresentationIntegration({
      runtime,
      settings: () => section({ desktopEnabled: true }),
      moduleUrl: import.meta.url,
      bridgeOrigin: 'http://127.0.0.1:3080',
      nativeToken: 't'.repeat(43),
      launch,
      retryDelayMs: 10,
      readyTimeoutMs: 100,
      livenessIntervalMs: 5,
      isProcessAlive: pid => alive.get(pid) ?? true,
      readEnvironment: options => environment({
        standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
      }),
    })

    await integration.reconcile()
    expect(integration.state()).toMatchObject({ phase: 'ready' })
    exitResolvers[0]?.({ code: 0, signal: null })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(launch).toHaveBeenCalledOnce()
    expect(integration.state()).toMatchObject({ phase: 'ready' })

    alive.set(9_000, false)
    await vi.waitFor(() => {
      expect(launch).toHaveBeenCalledTimes(2)
      expect(integration.state()).toMatchObject({ phase: 'ready' })
    })
    await integration.dispose()
  })
})
