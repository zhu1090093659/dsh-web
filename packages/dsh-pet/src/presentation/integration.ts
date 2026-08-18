import { randomUUID } from 'node:crypto'
import type { StandaloneRuntimeView } from '../adapters/standalone/runtime-manager.ts'
import { launchStandaloneRuntime } from '../adapters/standalone/launcher.ts'
import { StandalonePetHost } from '../adapters/standalone/standalone-host.ts'
import type { PetReturnTarget } from '../contracts/desktop-host.ts'
import type { PetSettingsSection } from '../service.ts'
import type { PetPluginSettings } from './config.ts'
import {
  PetPresentationController,
  type PetPresentationAdapter,
} from './controller.ts'
import {
  readPetPresentationEnvironment,
  type ReadPetPresentationEnvironmentOptions,
} from './environment.ts'
import { NullPresentation } from './null-presentation.ts'
import type { PetResolvedPresentation } from './resolver.ts'
import type { PetPresentationState } from './status.ts'

/** Runtime surface used by the production coordinator and its tests. */
export interface PetStandaloneRuntime {
  state(): StandaloneRuntimeView
  executablePath(): string | undefined
  subscribe(listener: (state: StandaloneRuntimeView) => void): () => void
}

export interface PetPresentationIntegrationOptions {
  runtime: PetStandaloneRuntime
  settings(): PetSettingsSection
  moduleUrl: string
  bridgeOrigin: string
  nativeToken: string
  sourceId?: string
  retryDelayMs?: number
  launch?: typeof launchStandaloneRuntime
  readEnvironment?: (
    options: ReadPetPresentationEnvironmentOptions,
  ) => ReturnType<typeof readPetPresentationEnvironment>
}

/** Map the flat settings-schema compatibility fields onto one policy source. */
export function petPresentationSettings(section: PetSettingsSection): PetPluginSettings {
  const enabled = section.enabled ?? true
  const desktopEnabled = section.desktopEnabled ?? false
  return {
    enabled,
    activity: { enabled },
    presentation: {
      mode: desktopEnabled ? 'auto' : 'none',
      standaloneAutoStart: desktopEnabled,
    },
  }
}

/**
 * Production coordinator joining settings, runtime availability, resolver and
 * the Standalone adapter. Runtime reads are passive: only the explicit HTTP
 * install route is allowed to call the manager's installer.
 */
export class PetPresentationIntegration {
  private readonly controller: PetPresentationController
  private readonly unsubscribeRuntime: () => void
  private readonly unsubscribeController: () => void
  private readonly retryDelayMs: number
  private runtimeAvailable: boolean | undefined
  private retryTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly options: PetPresentationIntegrationOptions) {
    const launch = options.launch ?? launchStandaloneRuntime
    const sourceId = options.sourceId ?? `dsh-pet:web:${String(process.pid)}`
    this.retryDelayMs = options.retryDelayMs ?? 5_000
    const returnTarget: PetReturnTarget = {
      kind: 'web',
      id: 'dsh-web',
      label: 'DSH Web',
      url: options.bridgeOrigin,
    }
    this.controller = new PetPresentationController({
      createAdapter: (resolution) => this.createAdapter(resolution, launch, sourceId),
      createContext: (settings, resolution, visible) => ({
        settings,
        resolution,
        visible,
        returnTarget,
        bridgeOrigin: options.bridgeOrigin,
        nativeToken: options.nativeToken,
      }),
      adapterKey: resolution => [
        resolution.kind,
        resolution.hostId ?? '',
        resolution.kind === 'standalone' ? options.runtime.executablePath() ?? '' : '',
      ].join(':'),
      retryDelayMs: this.retryDelayMs,
    })
    this.unsubscribeController = this.controller.subscribe((state) => {
      if (state.phase === 'failed') this.scheduleRetry()
      else this.clearRetry()
    })
    this.unsubscribeRuntime = options.runtime.subscribe(() => {
      const available = options.runtime.executablePath() !== undefined
      if (this.runtimeAvailable === available) return
      this.runtimeAvailable = available
      void this.reconcile()
    })
  }

  state(): PetPresentationState {
    return this.controller.state()
  }

  reconcile(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const section = this.options.settings()
    const readEnvironment = this.options.readEnvironment ?? readPetPresentationEnvironment
    const environment = readEnvironment({
      standaloneRuntimeAvailable: this.options.runtime.executablePath() !== undefined,
      webBridgeAvailable: true,
      embeddedHostAvailable: false,
    })
    return this.controller.reconcile(
      petPresentationSettings(section),
      environment,
      section.desktopVisible ?? true,
    )
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearRetry()
    this.unsubscribeRuntime()
    this.unsubscribeController()
    await this.controller.dispose()
  }

  private createAdapter(
    resolution: PetResolvedPresentation,
    launch: typeof launchStandaloneRuntime,
    sourceId: string,
  ): PetPresentationAdapter | undefined {
    if (resolution.kind === 'none') return new NullPresentation()
    if (resolution.kind !== 'standalone') return undefined
    // Every adapter generation owns a distinct parent registration. The
    // previous generation's asynchronous remove process can therefore never
    // delete a freshly re-enabled registration from this Host.
    const generationSourceId = `${sourceId.slice(0, 90)}:${randomUUID()}`
    return new StandalonePetHost({
      launch: (origin, nativeToken) => launch({
        moduleUrl: this.options.moduleUrl,
        runtimeExecutable: this.options.runtime.executablePath(),
        origin,
        nativeToken,
        sourceId: generationSourceId,
      }),
    })
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== undefined) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.reconcile()
    }, this.retryDelayMs)
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer === undefined) return
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }
}
