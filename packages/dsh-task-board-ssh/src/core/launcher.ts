/**
 * The launcher's command construction and its output grammar.
 *
 * The remote side is one POSIX `sh` script ({@link LAUNCHER_SCRIPT}) installed
 * once per host. This module builds every command the provider sends it, writes
 * a run's files, and reads the one status line each verb answers, so nothing on
 * this side concatenates a path or a run id into a command by hand.
 *
 * @module dsh-task-board-ssh/core/launcher
 */
import type { SshAgentCommand } from './adapters/types.ts'
import { LAUNCHER_SCRIPT } from './launcher-script.ts'
import { shellEnsureDir, shellJoin, shellQuote, shellWriteFile } from './shell.ts'

/** Verbs the installed script accepts. */
export const LAUNCHER_VERBS = ['start', 'status', 'tail', 'cancel'] as const

/** One launcher verb. */
export type LauncherVerb = (typeof LAUNCHER_VERBS)[number]

/**
 * State directory the provider owns on a host, relative to the remote `$HOME`.
 * The provider resolves the absolute path once per host and passes it in, so no
 * command depends on the remote shell expanding a tilde.
 */
export const REMOTE_STATE_SUFFIX = '.dsh/task-board-ssh'

/** Every file a run directory holds, in the order the provider writes them. */
export const RUN_FILE_NAMES = [
  'spec.json',
  'prompt.txt',
  'cmd.sh',
  'cwd',
  'stdout.log',
  'stderr.log',
  'pid',
  'exit',
  'session',
  'cancelled',
] as const

/** One file inside a run directory. */
export type RunFileName = (typeof RUN_FILE_NAMES)[number]

/** Run id grammar the script enforces, restated here so a bad id never leaves the host. */
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,128}$/

/**
 * Resolve the absolute state directory for a host's home directory.
 * @param home - absolute remote home directory.
 * @returns the state directory the provider installs the launcher under.
 */
export function stateDirForHome(home: string): string {
  return `${home.replace(/\/+$/, '')}/${REMOTE_STATE_SUFFIX}`
}

/**
 * Short content digest of a launcher script, used in its file name.
 *
 * A digest rather than a version number: an installed script is replaced
 * exactly when its text changes, so a host that already runs the current one is
 * left alone. FNV-1a over UTF-16 code units is enough for a file name and keeps
 * this module free of a platform crypto dependency.
 * @param script - launcher source; defaults to the shipped script.
 * @returns eight lower-case hex digits.
 */
export function launcherScriptHash(script: string = LAUNCHER_SCRIPT): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < script.length; index += 1) {
    hash ^= script.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Absolute remote path of the installed launcher.
 * @param stateDir - absolute state directory.
 * @param hash - script digest; defaults to the shipped script's.
 * @returns `<stateDir>/runner-<hash>.sh`.
 */
export function launcherScriptPath(stateDir: string, hash: string = launcherScriptHash()): string {
  return `${stateDir}/runner-${hash}.sh`
}

/**
 * Refuse a run id the remote script would refuse.
 * @param runId - candidate id.
 * @returns whether it matches the script's grammar.
 */
export function isRunId(runId: string): boolean {
  return RUN_ID_RE.test(runId)
}

/**
 * Absolute remote directory of one run.
 * @param stateDir - absolute state directory.
 * @param runId - run identifier.
 * @returns `<stateDir>/runs/<runId>`.
 */
export function runDirectory(stateDir: string, runId: string): string {
  if (!isRunId(runId)) throw new RangeError(`invalid run id: ${runId}`)
  return `${stateDir}/runs/${runId}`
}

/**
 * Absolute remote path of one run file.
 * @param stateDir - absolute state directory.
 * @param runId - run identifier.
 * @param name - which file.
 * @returns its absolute path.
 */
export function runFilePath(stateDir: string, runId: string, name: RunFileName): string {
  return `${runDirectory(stateDir, runId)}/${name}`
}

/**
 * Build the command that installs (or refreshes) the launcher on a host.
 * @param stateDir - absolute state directory.
 * @param script - launcher source; defaults to the shipped script.
 * @returns one shell command that is safe to replay.
 */
export function buildLauncherInstallCommand(stateDir: string, script: string = LAUNCHER_SCRIPT): string {
  const path = launcherScriptPath(stateDir, launcherScriptHash(script))
  return [shellEnsureDir(stateDir), shellWriteFile(path, script), `chmod 700 ${shellQuote(path)}`].join(' && ')
}

/**
 * Build the command that invokes one verb.
 * @param input - state directory, verb, run id and, for `tail`, the byte offset.
 * @returns one shell command.
 */
export function buildLauncherCommand(input: {
  /** Absolute state directory. */
  stateDir: string
  /** Verb to invoke. */
  verb: LauncherVerb
  /** Run the verb addresses. */
  runId: string
  /** Byte offset for `tail`; ignored by every other verb. */
  offset?: number
}): string {
  if (!isRunId(input.runId)) throw new RangeError(`invalid run id: ${input.runId}`)
  const scriptPath = launcherScriptPath(input.stateDir)
  const words = ['sh', scriptPath, input.verb, input.runId]
  if (input.verb === 'tail') {
    const offset = input.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError(`invalid byte offset: ${String(offset)}`)
    words.push(String(offset))
  }
  return shellJoin(words)
}

/** The command body a run executes, as `cmd.sh` holds it. */
export function agentScript(command: SshAgentCommand): string {
  const redirect = command.stdinFile === undefined
    ? '< /dev/null'
    : `< ${shellQuote(command.stdinFile)}`
  return `${command.command} ${redirect}`
}

/**
 * Build the commands that write one run's files before `start`.
 *
 * The provider writes the run directory, the prompt, the agent command, the
 * working directory and the spec; the launcher writes only the files it owns
 * (logs, pid, exit, cancelled), so neither side overwrites the other's state.
 * @param input - state directory, run id and the run's content.
 * @returns one shell command per write, in order.
 */
export function buildRunFileCommands(input: {
  /** Absolute state directory. */
  stateDir: string
  /** Run identifier. */
  runId: string
  /** Prompt text the agent reads. */
  prompt: string
  /** Command line the run executes. */
  command: SshAgentCommand
  /** Absolute remote directory the run works in. */
  cwd: string
  /** Opaque spec the provider keeps for its own reconciliation. */
  spec: unknown
}): string[] {
  const directory = runDirectory(input.stateDir, input.runId)
  return [
    shellEnsureDir(directory),
    shellWriteFile(runFilePath(input.stateDir, input.runId, 'prompt.txt'), input.prompt),
    shellWriteFile(runFilePath(input.stateDir, input.runId, 'cmd.sh'), agentScript(input.command)),
    shellWriteFile(runFilePath(input.stateDir, input.runId, 'cwd'), input.cwd),
    shellWriteFile(runFilePath(input.stateDir, input.runId, 'spec.json'), JSON.stringify(input.spec)),
  ]
}

/** State one verb reported. */
export type LauncherRunState = 'running' | 'exited' | 'cancelled' | 'lost' | 'missing' | 'not-running' | 'unknown'

/** One parsed status line. */
export interface LauncherStatus {
  /** State the launcher reported. */
  state: LauncherRunState
  /** Process group id the run owns, while it is running. */
  pid?: number
  /** Exit code the run recorded, once it settled. */
  exitCode?: number
  /** Bytes of `stdout.log` the launcher has seen. */
  bytes?: number
  /** Whether `start` spawned the agent on this call. */
  started?: boolean
}

/** States a verb may report, as the grammar's vocabulary. */
const LAUNCHER_STATES: readonly LauncherRunState[] = [
  'running',
  'exited',
  'cancelled',
  'lost',
  'missing',
  'not-running',
]

/**
 * Read a verb's status line.
 *
 * The grammar is `key=value` pairs separated by spaces, one line. Anything
 * else parses as `unknown` with the raw text preserved, because a shell that
 * printed something unexpected is a fact the caller should record, not an
 * exception.
 * @param output - captured stdout of a `status` or `start` invocation.
 * @returns the parsed state.
 */
export function parseLauncherStatus(output: string): LauncherStatus {
  const line = output.trim().split('\n').find(text => text.trim().length > 0) ?? ''
  const fields = new Map<string, string>()
  for (const token of line.split(/\s+/)) {
    const separator = token.indexOf('=')
    if (separator <= 0) continue
    fields.set(token.slice(0, separator), token.slice(separator + 1))
  }
  const state = fields.get('state')
  if (state === undefined || !(LAUNCHER_STATES as readonly string[]).includes(state)) {
    return { state: 'unknown' }
  }
  const status: LauncherStatus = { state: state as LauncherRunState }
  const pid = Number(fields.get('pid'))
  if (Number.isInteger(pid) && pid > 0) status.pid = pid
  const exitCode = Number(fields.get('exit'))
  if (fields.has('exit') && Number.isInteger(exitCode)) status.exitCode = exitCode
  const bytes = Number(fields.get('bytes'))
  if (fields.has('bytes') && Number.isInteger(bytes)) status.bytes = bytes
  if (fields.get('started') === '1') status.started = true
  if (fields.get('started') === '0') status.started = false
  return status
}
