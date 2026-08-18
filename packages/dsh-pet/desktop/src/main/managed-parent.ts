import { normalizeWebDshUrl } from '../shared/web-dsh-url.ts'

const PARENT_ARGUMENT = '--dsh-parent-pid='
const PARENT_ACTION_ARGUMENT = '--dsh-parent-action='
const SOURCE_ARGUMENT = '--dsh-source-id='
const ORIGIN_ARGUMENT = '--dsh-origin='
const NATIVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export type ManagedParentAction = 'add' | 'remove'

export function managedParentPid(arguments_: readonly string[], ownPid = process.pid): number | undefined {
  for (const argument of arguments_) {
    if (!argument.startsWith(PARENT_ARGUMENT)) continue
    const value = Number(argument.slice(PARENT_ARGUMENT.length))
    if (Number.isSafeInteger(value) && value > 0 && value <= 0x7fff_ffff && value !== ownPid) return value
  }
  return undefined
}

export function managedParentFromData(value: unknown, ownPid = process.pid): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const pid = Reflect.get(value, 'dshParentPid')
  return typeof pid === 'number'
    ? managedParentPid([`${PARENT_ARGUMENT}${pid}`], ownPid)
    : undefined
}

export function managedParentAction(arguments_: readonly string[]): ManagedParentAction {
  return arguments_.includes(`${PARENT_ACTION_ARGUMENT}remove`) ? 'remove' : 'add'
}

export function managedParentActionFromData(value: unknown): ManagedParentAction {
  if (typeof value !== 'object' || value === null) return 'add'
  return Reflect.get(value, 'dshParentAction') === 'remove' ? 'remove' : 'add'
}

/** Identify one plugin source independently from its shared Host process. */
export function managedParentSourceId(arguments_: readonly string[]): string | undefined {
  for (const argument of arguments_) {
    if (!argument.startsWith(SOURCE_ARGUMENT)) continue
    const value = argument.slice(SOURCE_ARGUMENT.length)
    if (SOURCE_PATTERN.test(value)) return value
  }
  return undefined
}

export function managedParentSourceIdFromData(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const sourceId = Reflect.get(value, 'dshSourceId')
  return typeof sourceId === 'string'
    ? managedParentSourceId([`${SOURCE_ARGUMENT}${sourceId}`])
    : undefined
}

/** Stable map identity; two plugin mounts in one process remain independent. */
export function managedParentRegistrationKey(pid: number, sourceId?: string): string {
  return `${String(pid)}:${sourceId ?? `legacy:${String(pid)}`}`
}

export function managedParentOrigin(arguments_: readonly string[]): string | undefined {
  for (const argument of arguments_) {
    if (!argument.startsWith(ORIGIN_ARGUMENT)) continue
    try {
      return normalizeWebDshUrl(argument.slice(ORIGIN_ARGUMENT.length))
    } catch {
      return undefined
    }
  }
  return undefined
}

export function managedParentOriginFromData(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const origin = Reflect.get(value, 'dshOrigin')
  return typeof origin === 'string' ? managedParentOrigin([`${ORIGIN_ARGUMENT}${origin}`]) : undefined
}

/** Validate the 256-bit base64url token delivered through process environment or instance IPC. */
export function managedParentNativeToken(value: unknown): string | undefined {
  return typeof value === 'string' && NATIVE_TOKEN_PATTERN.test(value) ? value : undefined
}

export function managedParentNativeTokenFromData(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return managedParentNativeToken(Reflect.get(value, 'dshNativeToken'))
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}
