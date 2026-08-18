import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PET_PLUGIN_SETTINGS,
  type PetPluginSettings,
} from '../src/presentation/config.ts'
import {
  derivePetPresentationEnvironment,
  type PetPresentationEnvironment,
} from '../src/presentation/environment.ts'
import { resolvePetPresentation } from '../src/presentation/resolver.ts'
import { presentationStateFromResolution } from '../src/presentation/status.ts'

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

describe('presentation resolver', () => {
  it('honors master disable, environment disable, and configured none in order', () => {
    expect(resolvePetPresentation(settings({ enabled: false }), environment())).toEqual({
      kind: 'none', reason: 'disabled',
    })
    expect(resolvePetPresentation(settings({ presentation: { mode: 'standalone', standaloneAutoStart: true } }), environment({
      disabledByEnvironment: true,
    }))).toEqual({ kind: 'none', reason: 'disabled' })
    expect(resolvePetPresentation(settings({ presentation: { mode: 'none', standaloneAutoStart: true } }), environment())).toEqual({
      kind: 'none', reason: 'configured-none',
    })
  })

  it('selects an embedded host and never falls back while a host is pending', () => {
    expect(resolvePetPresentation(settings(), environment({
      embeddedHostAvailable: true,
      embeddedHostHint: 'dshcode',
    }))).toEqual({ kind: 'embedded', reason: 'embedded-host', hostId: 'dshcode' })
    expect(resolvePetPresentation(settings(), environment({ embeddedHostHint: 'dsh-desktop' }))).toEqual({
      kind: 'none', reason: 'embedded-host-pending', hostId: 'dsh-desktop',
    })
    expect(resolvePetPresentation(settings({ presentation: { mode: 'embedded', standaloneAutoStart: true } }), environment())).toEqual({
      kind: 'none', reason: 'embedded-host-pending',
    })
  })

  it('allows explicit standalone in CI but still requires runtime and Web bridge', () => {
    const forced = settings({ presentation: { mode: 'standalone', standaloneAutoStart: true } })
    expect(resolvePetPresentation(forced, environment({ isCi: true, appearsInteractive: false }))).toEqual({
      kind: 'standalone', reason: 'forced-standalone', hostId: 'standalone',
    })
    expect(resolvePetPresentation(forced, environment({ standaloneRuntimeAvailable: false }))).toEqual({
      kind: 'none', reason: 'runtime-missing',
    })
    expect(resolvePetPresentation(forced, environment({ webBridgeAvailable: false }))).toEqual({
      kind: 'none', reason: 'web-bridge-missing',
    })
  })

  it('keeps auto mode off in CI, containers, Linux headless, and Windows services', () => {
    expect(resolvePetPresentation(settings(), environment({ isCi: true }))).toEqual({ kind: 'none', reason: 'ci' })
    expect(resolvePetPresentation(settings(), environment({ isContainer: true }))).toEqual({ kind: 'none', reason: 'container' })

    const linux = derivePetPresentationEnvironment({
      platform: 'linux', env: {}, isContainer: false,
      standaloneRuntimeAvailable: true, webBridgeAvailable: true, embeddedHostAvailable: false,
    })
    expect(resolvePetPresentation(settings(), linux)).toEqual({ kind: 'none', reason: 'headless' })

    const service = derivePetPresentationEnvironment({
      platform: 'win32', env: { SESSIONNAME: 'Services' }, isContainer: false,
      standaloneRuntimeAvailable: true, webBridgeAvailable: true, embeddedHostAvailable: false,
    })
    expect(resolvePetPresentation(settings(), service)).toEqual({ kind: 'none', reason: 'headless' })
  })

  it('auto-starts on interactive Windows, macOS, and display-backed Linux', () => {
    for (const [platform, env] of [
      ['win32', {}],
      ['darwin', {}],
      ['linux', { WAYLAND_DISPLAY: 'wayland-0' }],
    ] as const) {
      const facts = derivePetPresentationEnvironment({
        platform,
        env,
        isContainer: false,
        standaloneRuntimeAvailable: true,
        webBridgeAvailable: true,
        embeddedHostAvailable: false,
      })
      expect(resolvePetPresentation(settings(), facts)).toEqual({
        kind: 'standalone', reason: 'auto-standalone', hostId: 'standalone',
      })
    }
  })

  it('honors environment mode override and auto-start policy', () => {
    expect(resolvePetPresentation(settings(), environment({ presentationOverride: 'none' }))).toEqual({
      kind: 'none', reason: 'configured-none',
    })
    expect(resolvePetPresentation(settings({ presentation: { mode: 'auto', standaloneAutoStart: false } }), environment())).toEqual({
      kind: 'none', reason: 'configured-none',
    })
  })

  it('projects headless and visible standalone decisions into diagnostic state', () => {
    const headless = resolvePetPresentation(settings(), environment({ hasDisplayServer: false, appearsInteractive: false }))
    expect(presentationStateFromResolution(settings(), headless, true)).toEqual({
      mode: 'auto', resolved: 'none', phase: 'none', available: false, visible: false, reason: 'headless',
      errorCode: 'PRESENTATION_HEADLESS',
    })
    const standalone = resolvePetPresentation(settings(), environment())
    expect(presentationStateFromResolution(settings(), standalone, true)).toMatchObject({
      mode: 'auto', resolved: 'standalone', phase: 'ready', available: true, visible: true,
      host: { id: 'standalone', embedded: false, ownsTray: true },
    })
  })
})
