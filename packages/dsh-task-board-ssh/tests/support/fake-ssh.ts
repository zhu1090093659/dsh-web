/**
 * Two fakes for the `dshSsh` face: one that answers the launcher's own grammar,
 * and one that really runs it.
 *
 * The face is a contract — `exec` hands a command line to a remote shell and
 * returns what it printed — so a fake can honour it two ways. {@link createScriptedSsh}
 * models the launcher's state machine in memory, which is what makes queueing,
 * reconciliation and cancellation deterministic. {@link createLocalSsh} hands the
 * command to this machine's own `sh` inside a scratch directory, so the shipped
 * POSIX launcher really runs, detaches and writes its files — which is the only
 * way to prove that a replayed `start` leaves one process behind.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DshSshExecResult, DshSshHost, DshSshService } from '../../src/core/contract.ts'
import { NOW } from './board.ts'

/** One command a fake received, and the launcher verb it addressed. */
export interface RemoteCall {
  alias: string
  command: string
  verb?: 'start' | 'status' | 'tail' | 'cancel'
  runId?: string
}

/** A host entry this deployment serves. */
export function fakeHost(overrides: Partial<DshSshHost> = {}): DshSshHost {
  return {
    alias: 'build-box',
    host: '10.0.0.10',
    port: 22,
    user: 'runner',
    auth: 'key',
    keyReady: true,
    proxyJump: [],
    tags: ['build'],
    forwardAgent: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/**
 * A host entry carrying the fields a host store really holds and the service
 * face never publishes. A tool result must not contain any of them.
 */
export function hostWithSecrets(): DshSshHost {
  return {
    ...fakeHost(),
    password: 'hunter2-secret',
    keyPath: '/home/runner/.ssh/id_ed25519',
    passphrase: 'keypassphrase-secret',
    proxyCommand: 'ssh -W %h:%p bastion-secret',
  } as DshSshHost
}

/** A successful remote command. */
function ok(stdout: string): DshSshExecResult {
  return { success: true, exitCode: 0, timedOut: false, stdout, stderr: '', durationMs: 1 }
}

/** Byte length of a text, the way the launcher's `wc -c` measures it. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** The launcher verb one composed command addresses. */
const VERB_RE = /runner-[0-9a-f]{8}\.sh' '(start|status|tail|cancel)' '([^']+)'(?: '(\d+)')?/

/**
 * Read the verb out of a command the engine composed.
 * @param command - the shell command line.
 * @returns the verb, the run id and, for `tail`, the offset.
 */
export function launcherCall(command: string): { verb: 'start' | 'status' | 'tail' | 'cancel'; runId: string; offset?: number } | undefined {
  const match = VERB_RE.exec(command)
  if (match === null) return undefined
  return {
    verb: match[1] as 'start' | 'status' | 'tail' | 'cancel',
    runId: match[2] as string,
    ...(match[3] === undefined ? {} : { offset: Number(match[3]) }),
  }
}

/** One run as the scripted host remembers it. */
export interface ScriptedRunState {
  /** What the launcher reports for it. */
  phase: 'running' | 'exited' | 'cancelled' | 'lost'
  /** Exit code it recorded. */
  exitCode: number
  /** Contents of its `stdout.log`. */
  output: string
  /** Agent processes this run really spawned. */
  processes: number
  /** `start` verbs the caller sent for it. */
  startCommands: number
  /** `cancel` verbs the caller sent for it. */
  cancelCommands: number
  /** Whether its remote directory was removed. */
  removed: boolean
}

/** The in-memory host. */
export interface ScriptedSsh {
  /** The face the engine drives. */
  service: DshSshService
  /** Hosts this deployment serves. */
  hosts: DshSshHost[]
  /** Every command the engine sent, in order. */
  calls: RemoteCall[]
  /** Run state, keyed by run id. */
  runs: Map<string, ScriptedRunState>
  /** Let one run report its verdict. */
  finish(runId: string, options?: { exitCode?: number; output?: string }): void
  /** Commands the engine sent that addressed one verb. */
  commands(verb: 'start' | 'status' | 'tail' | 'cancel'): string[]
}

/** How the in-memory host behaves. */
export interface ScriptedSshOptions {
  /** Remote home directory every path is resolved from. */
  home?: string
  /** Hosts to serve; one build host by default. */
  hosts?: DshSshHost[]
  /**
   * Whether the pool replays every command once, the way a reconnect can. A
   * replayed `start` must leave one process behind, exactly as the shipped
   * script does.
   */
  replay?: boolean
}

/**
 * Build the in-memory host.
 * @param options - home directory, hosts and replay behaviour.
 * @returns the fake.
 */
export function createScriptedSsh(options: ScriptedSshOptions = {}): ScriptedSsh {
  const home = options.home ?? '/home/runner'
  const hosts = options.hosts ?? [fakeHost()]
  const calls: RemoteCall[] = []
  const runs = new Map<string, ScriptedRunState>()

  const runOf = (runId: string): ScriptedRunState => {
    const existing = runs.get(runId)
    if (existing !== undefined) return existing
    const created: ScriptedRunState = {
      phase: 'running',
      exitCode: 0,
      output: '',
      processes: 0,
      startCommands: 0,
      cancelCommands: 0,
      removed: false,
    }
    runs.set(runId, created)
    return created
  }

  const statusLine = (run: ScriptedRunState): string => {
    const bytes = byteLength(run.output)
    if (run.phase === 'exited') return 'state=exited exit=' + String(run.exitCode) + ' bytes=' + String(bytes) + '\n'
    if (run.phase === 'cancelled') return 'state=cancelled exit=' + String(run.exitCode) + ' bytes=' + String(bytes) + '\n'
    if (run.phase === 'lost') return 'state=lost bytes=' + String(bytes) + '\n'
    return 'state=running pid=4242 bytes=' + String(bytes) + '\n'
  }

  const applyVerb = (call: { verb: 'start' | 'status' | 'tail' | 'cancel'; runId: string; offset?: number }): DshSshExecResult => {
    const run = runOf(call.runId)
    switch (call.verb) {
      case 'start': {
        run.startCommands += 1
        // A run that already recorded its exit keeps it; one that has a live
        // process is answered for, exactly as the shipped script does.
        if (run.phase === 'exited' || run.phase === 'cancelled') return ok(statusLine(run))
        if (run.processes > 0) return ok('state=running pid=4242 bytes=' + String(byteLength(run.output)) + ' started=0\n')
        run.phase = 'running'
        run.processes += 1
        return ok('state=running pid=4242 bytes=' + String(byteLength(run.output)) + ' started=1\n')
      }
      case 'status':
        return ok(statusLine(run))
      case 'tail':
        return ok(run.output.slice(call.offset ?? 0))
      default: {
        run.cancelCommands += 1
        if (run.phase === 'running') {
          run.phase = 'cancelled'
          run.exitCode = 143
          return ok('state=cancelled pid=4242\n')
        }
        return ok('state=not-running\n')
      }
    }
  }

  const service: DshSshService = {
    apiVersion: 1,
    hosts: {
      list: () => [...hosts],
      find: alias => hosts.find(host => host.alias === alias),
    },
    async exec(alias, command) {
      const call = launcherCall(command)
      calls.push({ alias, command, ...(call === undefined ? {} : { verb: call.verb, runId: call.runId }) })
      if (command === 'printf %s "$HOME"') return ok(home)
      // A directory probe answers "no": nothing exists on a host the run has
      // never touched, which is how a strategy recognises a first run.
      if (command.startsWith('test ')) {
        return { success: false, exitCode: 1, timedOut: false, stdout: '', stderr: '', durationMs: 1 }
      }
      if (command.startsWith('rm -rf ')) {
        const runId = /\/runs\/([A-Za-z0-9._-]+)'$/.exec(command)?.[1]
        if (runId !== undefined) runOf(runId).removed = true
        return ok('')
      }
      if (call === undefined) return ok('')
      const first = applyVerb(call)
      if (options.replay !== true) return first
      const second = applyVerb(call)
      return second.success ? second : first
    },
    async upload(_alias, localPath, remotePath) {
      mkdirSync(dirname(remotePath), { recursive: true })
      copyFileSync(localPath, remotePath)
      return { bytes: 1, files: 1 }
    },
    async download(_alias, remotePath, localPath) {
      mkdirSync(dirname(localPath), { recursive: true })
      copyFileSync(remotePath, localPath)
      return { bytes: 1 }
    },
  }

  return {
    service,
    hosts,
    calls,
    runs,
    finish(runId, finishOptions = {}) {
      const run = runOf(runId)
      run.phase = 'exited'
      run.exitCode = finishOptions.exitCode ?? 0
      if (finishOptions.output !== undefined) run.output = finishOptions.output
    },
    commands: verb => calls.filter(call => call.verb === verb).map(call => call.command),
  }
}

/** The host that really runs the launcher through this machine's `sh`. */
export interface LocalSsh {
  /** The face the engine drives. */
  service: DshSshService
  /** Directory standing in for the remote home. */
  home: string
  /** Hosts this deployment serves. */
  hosts: DshSshHost[]
  /** Every command the engine sent, in order. */
  calls: RemoteCall[]
  /** Run one command exactly as the engine would (a pool replay does this). */
  run(command: string): Promise<DshSshExecResult>
}

/** How the local host behaves. */
export interface LocalSshOptions {
  /** Absolute directory standing in for the remote home. */
  home: string
  /** Hosts to serve; one build host by default. */
  hosts?: DshSshHost[]
}

/**
 * Run one command through this machine's shell, inside the stand-in home.
 * @param home - the directory `$HOME` resolves to.
 * @param command - the command line.
 * @returns the finished command.
 */
function runLocal(home: string, command: string): Promise<DshSshExecResult> {
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn('sh', ['-c', command], {
      cwd: home,
      env: { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      resolve({ success: false, exitCode: null, timedOut: false, stdout, stderr, durationMs: Date.now() - started, error: error.message })
    })
    child.on('close', code => {
      resolve({ success: code === 0, exitCode: code, timedOut: false, stdout, stderr, durationMs: Date.now() - started })
    })
  })
}

/**
 * Build the host that really executes commands on this machine.
 * @param options - the stand-in home directory and the hosts to serve.
 * @returns the fake.
 */
export function createLocalSsh(options: LocalSshOptions): LocalSsh {
  const hosts = options.hosts ?? [fakeHost()]
  const calls: RemoteCall[] = []
  const run = async (command: string): Promise<DshSshExecResult> => {
    const call = launcherCall(command)
    calls.push({ alias: hosts[0]?.alias ?? 'build-box', command, ...(call === undefined ? {} : { verb: call.verb, runId: call.runId }) })
    return await runLocal(options.home, command)
  }
  const service: DshSshService = {
    apiVersion: 1,
    hosts: {
      list: () => [...hosts],
      find: alias => hosts.find(host => host.alias === alias),
    },
    exec: (_alias, command) => run(command),
    async upload(_alias, localPath, remotePath) {
      mkdirSync(dirname(remotePath), { recursive: true })
      copyFileSync(localPath, remotePath)
      return { bytes: 1, files: 1 }
    },
    async download(_alias, remotePath, localPath) {
      mkdirSync(dirname(localPath), { recursive: true })
      copyFileSync(remotePath, localPath)
      return { bytes: 1 }
    },
  }
  return { service, home: options.home, hosts, calls, run }
}
