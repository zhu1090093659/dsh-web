import { spawn, type SpawnOptions } from 'node:child_process'

/** Build the exact cmd.exe argument vector required to execute a trusted .cmd shim. */
export function windowsCmdShimArgs(binary: string, args: readonly string[]): string[] {
  const unsafe = /[&|<>"'`%!\n\r\0]/
  if (/["%\n\r\0]/.test(binary) || args.some(arg => unsafe.test(arg))) {
    throw new Error('doctor: unsafe Windows command argument')
  }
  const commandLine = '""' + binary + '" ' + args.map(arg => '"' + arg + '"').join(' ') + '"'
  return ['/d', '/s', '/c', commandLine]
}

export interface DshSpawnSpec {
  command: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

export function dshSpawnSpec(binary: string, args: readonly string[], platform: NodeJS.Platform = process.platform): DshSpawnSpec {
  if (platform === 'win32') {
    const lower = binary.toLowerCase()
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      return { command: 'cmd.exe', args: windowsCmdShimArgs(binary, args), windowsVerbatimArguments: true }
    }
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
      return { command: process.execPath, args: [binary, ...args] }
    }
    if (lower === 'dsh' || lower.endsWith('\\dsh') || lower.endsWith('/dsh')) {
      return { command: 'cmd.exe', args: windowsCmdShimArgs(binary, args), windowsVerbatimArguments: true }
    }
  }
  return { command: binary, args: [...args] }
}

/** Spawn the official DSH CLI, including the Windows .cmd shim path. */
export function spawnDsh(binary: string, args: readonly string[], options: Pick<SpawnOptions, 'env' | 'stdio'>, platform: NodeJS.Platform = process.platform) {
  const spec = dshSpawnSpec(binary, args, platform)
  return spawn(spec.command, spec.args, {
    ...options,
    ...(spec.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
  })
}
