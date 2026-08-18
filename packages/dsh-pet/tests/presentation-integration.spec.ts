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
): StandaloneRuntimeLaunchHandle {
  return { ready, dispose }
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
    const launch = vi.fn((_options: LaunchStandaloneRuntimeOptions) => launchHandle())
    const integration = new PetPresentationIntegration({
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
    const launch = vi.fn((_options: LaunchStandaloneRuntimeOptions) => launchHandle())
    const integration = new PetPresentationIntegration({
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
    const launch = vi.fn((_options: LaunchStandaloneRuntimeOptions) => launchHandle())
    const integration = new PetPresentationIntegration({
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
    const launch = vi.fn((_options: LaunchStandaloneRuntimeOptions) => {
      if (launch.mock.calls.length !== 1) return launchHandle()
      return launchHandle(new Promise<void>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('standalone-launch-failed')) }, 0)
      }))
    })
    const integration = new PetPresentationIntegration({
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
})
