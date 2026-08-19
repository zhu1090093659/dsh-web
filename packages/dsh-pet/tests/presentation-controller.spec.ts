import { describe, expect, it, vi } from 'vitest'
import { EmbeddedPetHost } from '../src/adapters/embedded/embedded-host.ts'
import { StandalonePetHost } from '../src/adapters/standalone/standalone-host.ts'
import {
  PET_DESKTOP_HOST_API_VERSION,
  type PetDesktopHost,
  type PetReturnTarget,
  type PetSurfaceHandle,
  type PetSurfaceRequest,
} from '../src/contracts/desktop-host.ts'
import {
  DEFAULT_PET_PLUGIN_SETTINGS,
  type PetPluginSettings,
} from '../src/presentation/config.ts'
import {
  PetPresentationController,
  type PetPresentationAdapter,
  type PetPresentationContext,
} from '../src/presentation/controller.ts'
import type { PetPresentationEnvironment } from '../src/presentation/environment.ts'
import { NullPresentation } from '../src/presentation/null-presentation.ts'

function settings(patch: Partial<PetPluginSettings> = {}): PetPluginSettings {
  return {
    ...DEFAULT_PET_PLUGIN_SETTINGS,
    ...patch,
    activity: { ...DEFAULT_PET_PLUGIN_SETTINGS.activity, ...patch.activity },
    presentation: { ...DEFAULT_PET_PLUGIN_SETTINGS.presentation, ...patch.presentation },
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

function returnTarget(kind: 'web' | 'desktop-host' | 'none' = 'web'): PetReturnTarget {
  if (kind === 'none') return { kind: 'none' }
  if (kind === 'desktop-host') {
    return {
      kind,
      id: 'mock-desktop:main',
      label: '返回 Mock Desktop',
      hostId: 'mock-desktop',
      route: { kind: 'home' },
    }
  }
  return {
    kind,
    id: 'dsh-web',
    label: '打开 DSH Web',
    url: 'http://127.0.0.1:3080',
  }
}

function context(
  currentSettings: PetPluginSettings,
  resolution: PetPresentationContext['resolution'],
  visible: boolean,
): PetPresentationContext {
  return {
    settings: currentSettings,
    resolution,
    visible,
    bridgeOrigin: 'http://127.0.0.1:3080',
    nativeToken: 't'.repeat(43),
    returnTarget: resolution.kind === 'embedded'
      ? returnTarget('desktop-host')
      : returnTarget('web'),
  }
}

function fakeAdapter(kind: PetPresentationAdapter['kind']): PetPresentationAdapter & {
  start: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} {
  return {
    kind,
    host: kind === 'none'
      ? undefined
      : {
          id: kind,
          name: kind,
          embedded: kind === 'embedded',
          ownsTray: true,
        },
    start: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    update: vi.fn(() => undefined),
    stop: vi.fn(async () => undefined),
  }
}

describe('presentation controller and desktop host contract', () => {
  it('preserves the legacy spawn-ready Standalone contract without PID monitoring', async () => {
    const disposeProcess = vi.fn()
    const isProcessAlive = vi.fn(() => false)
    const launch = vi.fn(() => ({
      ready: Promise.resolve(),
      dispose: disposeProcess,
    }))
    const adapter = new StandalonePetHost({
      launch,
      isProcessAlive,
      livenessIntervalMs: 1,
    })
    const controller = new PetPresentationController({
      createAdapter: resolution => resolution.kind === 'standalone' ? adapter : new NullPresentation(),
      createContext: context,
    })

    await controller.reconcile(settings(), environment())
    await controller.reconcile(settings(), environment())

    expect(launch).toHaveBeenCalledOnce()
    expect(controller.state()).toMatchObject({
      resolved: 'standalone',
      phase: 'ready',
      host: { id: 'standalone', embedded: false, ownsTray: true },
      returnTarget: { kind: 'web' },
    })
    await controller.dispose()
    expect(disposeProcess).toHaveBeenCalledOnce()
    expect(isProcessAlive).not.toHaveBeenCalled()
  })

  it('isolates standalone termination listeners from one another', async () => {
    let exit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      exit = resolve
    })
    const adapter = new StandalonePetHost({
      launch: () => ({ ready: Promise.resolve(), pid: 5_200, exited, dispose: vi.fn() }),
      waitForReady: () => ({
        ready: Promise.resolve({ sourceId: 'test:listeners', desktopPid: 5_200 }),
        dispose: vi.fn(),
      }),
      isProcessAlive: () => true,
    })
    const surviving = vi.fn()
    adapter.onTerminated(() => { throw new Error('diagnostic listener failed') })
    adapter.onTerminated(surviving)

    await adapter.start(context(
      settings(),
      { kind: 'standalone', reason: 'auto-standalone', hostId: 'standalone' },
      true,
    ))
    exit({ code: 1, signal: null })
    await vi.waitFor(() => expect(surviving).toHaveBeenCalledOnce())
    await adapter.stop()
  })

  it('uses NullPresentation in a headless environment without starting Standalone', async () => {
    const standalone = fakeAdapter('standalone')
    const nullPresentation = new NullPresentation()
    const controller = new PetPresentationController({
      createAdapter: resolution => resolution.kind === 'none' ? nullPresentation : standalone,
      createContext: context,
    })

    await controller.reconcile(settings(), environment({
      platform: 'linux',
      hasDisplayServer: false,
      appearsInteractive: false,
    }))

    expect(standalone.start).not.toHaveBeenCalled()
    expect(controller.state()).toMatchObject({
      resolved: 'none',
      phase: 'none',
      reason: 'headless',
      available: false,
    })
    await controller.dispose()
  })

  it('backs off a failing adapter before retrying the same presentation', async () => {
    let now = 1_000
    const failing = fakeAdapter('standalone')
    failing.start.mockRejectedValue(new Error('launch failed'))
    const controller = new PetPresentationController({
      createAdapter: () => failing,
      createContext: context,
      now: () => now,
      retryDelayMs: 500,
    })

    await expect(controller.reconcile(settings(), environment())).resolves.toBeUndefined()
    await expect(controller.reconcile(settings(), environment())).resolves.toBeUndefined()
    expect(failing.start).toHaveBeenCalledOnce()
    expect(controller.state()).toMatchObject({ phase: 'failed', errorCode: 'PRESENTATION_START_FAILED' })

    now = 1_500
    await controller.reconcile(settings(), environment())
    expect(failing.start).toHaveBeenCalledTimes(2)
    await controller.dispose()
  })

  it('turns an active adapter termination into a serialized failed state', async () => {
    let terminate: ((reason: string) => void) | undefined
    const adapter: PetPresentationAdapter = {
      ...fakeAdapter('standalone'),
      onTerminated: (listener) => {
        terminate = listener
        return () => { terminate = undefined }
      },
    }
    const controller = new PetPresentationController({
      createAdapter: () => adapter,
      createContext: context,
      retryDelayMs: 10,
    })

    await controller.reconcile(settings(), environment())
    expect(controller.state()).toMatchObject({ phase: 'ready' })
    terminate?.('desktop-exited')
    await vi.waitFor(() => {
      expect(controller.state()).toMatchObject({
        phase: 'failed',
        errorCode: 'PRESENTATION_START_FAILED',
      })
    })
    expect(adapter.stop).toHaveBeenCalledOnce()
    await controller.dispose()
  })

  it('cancels a pending start immediately and never publishes its stale failure', async () => {
    let rejectStart!: (error: Error) => void
    const starting = {
      ...fakeAdapter('standalone'),
      start: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStart = reject })),
      cancelStart: vi.fn(() => { rejectStart(new Error('cancelled')) }),
    }
    const phases: string[] = []
    const controller = new PetPresentationController({
      createAdapter: resolution => resolution.kind === 'standalone' ? starting : new NullPresentation(),
      createContext: context,
    })
    controller.subscribe(state => { phases.push(state.phase) })

    const pending = controller.reconcile(settings(), environment())
    await vi.waitFor(() => expect(starting.start).toHaveBeenCalledOnce())
    const disabled = controller.reconcile(
      settings({ presentation: { mode: 'none', standaloneAutoStart: false } }),
      environment(),
    )
    await Promise.all([pending, disabled])

    expect(starting.cancelStart).toHaveBeenCalledWith('stale-reconcile')
    expect(controller.state()).toMatchObject({ phase: 'none', reason: 'configured-none' })
    expect(phases.at(-1)).toBe('none')
    expect(phases.slice(phases.lastIndexOf('starting') + 1)).not.toContain('failed')
    await controller.dispose()
  })

  it('does not cancel an adapter whose start completed while show is pending', async () => {
    let finishShow!: () => void
    const adapter = {
      ...fakeAdapter('standalone'),
      show: vi.fn(() => new Promise<void>((resolve) => { finishShow = resolve })),
      cancelStart: vi.fn(),
    }
    const controller = new PetPresentationController({
      createAdapter: resolution => resolution.kind === 'standalone' ? adapter : new NullPresentation(),
      createContext: context,
    })

    const starting = controller.reconcile(settings(), environment())
    await vi.waitFor(() => expect(adapter.show).toHaveBeenCalledOnce())
    const disabled = controller.reconcile(
      settings({ presentation: { mode: 'none', standaloneAutoStart: false } }),
      environment(),
    )
    expect(adapter.cancelStart).not.toHaveBeenCalled()
    finishShow()
    await Promise.all([starting, disabled])

    expect(controller.state()).toMatchObject({ phase: 'none', reason: 'configured-none' })
    await controller.dispose()
  })

  it('does not publish a stale visibility failure after a newer reconcile', async () => {
    let rejectHide!: (error: Error) => void
    const adapter = {
      ...fakeAdapter('standalone'),
      hide: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectHide = reject })),
    }
    const phases: string[] = []
    const controller = new PetPresentationController({
      createAdapter: resolution => resolution.kind === 'standalone' ? adapter : new NullPresentation(),
      createContext: context,
    })

    await controller.reconcile(settings(), environment())
    controller.subscribe(state => { phases.push(state.phase) })
    const hiding = controller.reconcile(settings(), environment(), false)
    await vi.waitFor(() => expect(adapter.hide).toHaveBeenCalledOnce())
    const disabled = controller.reconcile(
      settings({ presentation: { mode: 'none', standaloneAutoStart: false } }),
      environment(),
    )
    rejectHide(new Error('surface disappeared'))
    await Promise.all([hiding, disabled])

    expect(phases).not.toContain('failed')
    expect(controller.state()).toMatchObject({ phase: 'none', reason: 'configured-none' })
    await controller.dispose()
  })

  it('lets an Embedded Host create and close the surface without contributing another tray', async () => {
    let onClosed: (() => void) | undefined
    const disposeClosed = vi.fn()
    const surface: PetSurfaceHandle = {
      id: 'mock-pet-surface',
      show: vi.fn(async () => undefined),
      hide: vi.fn(async () => undefined),
      setBounds: vi.fn(async () => undefined),
      getBounds: vi.fn(async () => ({ x: 0, y: 0, width: 228, height: 304 })),
      setAlwaysOnTop: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onClosed: vi.fn((listener) => {
        onClosed = listener
        return { dispose: disposeClosed }
      }),
    }
    const createPetSurface = vi.fn(async (_request: PetSurfaceRequest) => surface)
    const disposeTrayAction = vi.fn()
    const contributeTrayAction = vi.fn(async () => ({ dispose: disposeTrayAction }))
    const host: PetDesktopHost = {
      descriptor: {
        apiVersion: PET_DESKTOP_HOST_API_VERSION,
        id: 'mock-desktop',
        name: 'Mock Desktop',
        capabilities: {
          floatingSurface: true,
          focusMainWindow: true,
          openRoute: true,
          contributesTrayAction: true,
          rendererKinds: ['sprite2d'],
        },
        ownsTray: true,
      },
      createPetSurface,
      focusMainWindow: vi.fn(async () => undefined),
      contributeTrayAction,
    }
    const embedded = new EmbeddedPetHost({
      host,
      surfaceRequest: current => ({
        surfaceId: 'dsh-pet',
        content: {
          kind: 'loopback-url',
          url: `${current.bridgeOrigin}/pet/desktop/index.html`,
          allowedOrigin: current.bridgeOrigin ?? '',
        },
        initial: { width: 228, height: 304, alwaysOnTop: true, visible: true },
        auth: { token: current.nativeToken ?? '' },
        returnTarget: current.returnTarget,
      }),
    })
    const controller = new PetPresentationController({
      createAdapter: resolution => resolution.kind === 'embedded' ? embedded : new NullPresentation(),
      createContext: context,
    })

    await controller.reconcile(settings(), environment({
      embeddedHostAvailable: true,
      embeddedHostHint: 'mock-desktop',
    }))

    expect(createPetSurface).toHaveBeenCalledOnce()
    expect(surface.show).toHaveBeenCalledOnce()
    expect(contributeTrayAction).toHaveBeenCalledOnce()
    expect(contributeTrayAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dsh-pet:show',
      label: '显示桌宠',
    }))
    expect(controller.state()).toMatchObject({
      resolved: 'embedded',
      host: { id: 'mock-desktop', embedded: true, ownsTray: true },
      returnTarget: { kind: 'desktop-host', hostId: 'mock-desktop' },
    })

    await controller.reconcile(
      settings({ presentation: { mode: 'none', standaloneAutoStart: true } }),
      environment({ embeddedHostAvailable: false }),
    )
    expect(disposeClosed).toHaveBeenCalledOnce()
    expect(disposeTrayAction).toHaveBeenCalledOnce()
    expect(surface.close).toHaveBeenCalledOnce()
    onClosed?.()
    await controller.dispose()
  })

  it('uses the adapter identity hook when one Embedded Host id is rebound', async () => {
    let generation = 1
    const first = fakeAdapter('embedded')
    const second = fakeAdapter('embedded')
    const controller = new PetPresentationController({
      createAdapter: () => generation === 1 ? first : second,
      createContext: context,
      adapterKey: resolution => `${resolution.kind}:${resolution.hostId ?? ''}:${String(generation)}`,
    })
    const embeddedEnvironment = environment({
      embeddedHostAvailable: true,
      embeddedHostHint: 'same-host-id',
    })

    await controller.reconcile(settings(), embeddedEnvironment)
    generation = 2
    await controller.reconcile(settings(), embeddedEnvironment)

    expect(first.stop).toHaveBeenCalledOnce()
    expect(second.start).toHaveBeenCalledOnce()
    await controller.dispose()
  })
})
