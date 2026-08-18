import { existsSync, readFileSync } from 'node:fs'
import { parsePresentationMode, type PetPresentationMode } from './config.ts'

export interface PetPresentationEnvironment {
  platform: NodeJS.Platform
  isCi: boolean
  isContainer: boolean
  isTest: boolean
  hasDisplayServer: boolean
  appearsInteractive: boolean
  standaloneRuntimeAvailable: boolean
  webBridgeAvailable: boolean
  embeddedHostAvailable: boolean
  embeddedHostHint?: string
  disabledByEnvironment: boolean
  /** Validated `DSH_PET_PRESENTATION`; resolver gives it priority over Host settings. */
  presentationOverride?: PetPresentationMode
}

export interface PetPresentationEnvironmentInput {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  isContainer: boolean
  standaloneRuntimeAvailable: boolean
  webBridgeAvailable: boolean
  embeddedHostAvailable: boolean
}

function enabledFlag(value: string | undefined): boolean {
  if (value === undefined) return false
  return value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

function safeHostHint(value: string | undefined): string | undefined {
  const hint = value?.trim()
  return hint !== undefined && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(hint) ? hint : undefined
}

/** Convert process/platform facts into resolver input without consulting globals. */
export function derivePetPresentationEnvironment(
  input: PetPresentationEnvironmentInput,
): PetPresentationEnvironment {
  const { env, platform } = input
  const isCi = enabledFlag(env.CI)
    || enabledFlag(env.GITHUB_ACTIONS)
    || enabledFlag(env.BUILDKITE)
    || enabledFlag(env.TF_BUILD)
  const isTest = env.NODE_ENV === 'test' || enabledFlag(env.VITEST)
  const hasDisplayServer = platform === 'win32' || platform === 'darwin'
    || (platform === 'linux' && Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.MIR_SOCKET))
  const windowsService = platform === 'win32' && env.SESSIONNAME?.toLowerCase() === 'services'
  const appearsInteractive = hasDisplayServer
    && !windowsService
    && !isCi
    && !input.isContainer
    && !isTest
  const presentationOverride = parsePresentationMode(env.DSH_PET_PRESENTATION)
  const embeddedHostHint = safeHostHint(env.DSH_PET_DESKTOP_HOST_HINT)
  return {
    platform,
    isCi,
    isContainer: input.isContainer,
    isTest,
    hasDisplayServer,
    appearsInteractive,
    standaloneRuntimeAvailable: input.standaloneRuntimeAvailable,
    webBridgeAvailable: input.webBridgeAvailable,
    embeddedHostAvailable: input.embeddedHostAvailable,
    ...(embeddedHostHint === undefined ? {} : { embeddedHostHint }),
    disabledByEnvironment: env.DSH_PET_DISABLE_DESKTOP === '1',
    ...(presentationOverride === undefined ? {} : { presentationOverride }),
  }
}

function detectCurrentContainer(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  if (enabledFlag(env.container)) return true
  if (platform !== 'linux') return false
  if (existsSync('/.dockerenv')) return true
  try {
    return /(?:docker|containerd|kubepods|lxc)/i.test(readFileSync('/proc/1/cgroup', 'utf8'))
  } catch {
    return false
  }
}

export interface ReadPetPresentationEnvironmentOptions {
  standaloneRuntimeAvailable: boolean
  webBridgeAvailable: boolean
  embeddedHostAvailable?: boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Test/host override; omission performs the bounded local container check. */
  isContainer?: boolean
}

/** Read process facts once at the adapter boundary; the resolver itself remains pure. */
export function readPetPresentationEnvironment(
  options: ReadPetPresentationEnvironmentOptions,
): PetPresentationEnvironment {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  return derivePetPresentationEnvironment({
    platform,
    env,
    isContainer: options.isContainer ?? detectCurrentContainer(platform, env),
    standaloneRuntimeAvailable: options.standaloneRuntimeAvailable,
    webBridgeAvailable: options.webBridgeAvailable,
    embeddedHostAvailable: options.embeddedHostAvailable ?? false,
  })
}
