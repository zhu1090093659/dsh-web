/**
 * Background execution: run_in_background starts a SEPARATE pinned bash
 * process, registers it with the deployment's job registry, and returns the
 * job id the model collects it by.
 *
 * The registry and the subprocess seam are injected fakes, following the
 * suite's existing practice: what is certified here is this plugin's own
 * decisions — which process it starts, with which argv and environment, what
 * it registers, and what it refuses — not the host registry's implementation.
 * Nothing in this file waits on real time.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  BACKGROUND_JOB_KIND,
  processOutcome,
  startBackgroundJob,
  type JobHandleLike,
  type JobHooksLike,
  type JobRegistryLike,
  type JobSpecLike,
} from '../src/background.ts'
import { resolveConfig } from '../src/config.ts'
import { shellTempDir, type ShellRegistry } from '../src/shell.ts'
import { buildWinBashTool, readJobRegistry } from '../src/tool.ts'

/** One spawn the tool performed, kept for inspection. */
interface Spawned {
  readonly spec: SubprocessSpawnSpec
  /** Terminate calls the job made on this handle. */
  terminates: number
}

/** A subprocess seam that records spawns and settles them on request. */
function fakeSubprocess(options: { failWith?: string } = {}) {
  const spawns: Spawned[] = []
  const settle: ((code: number) => void)[] = []
  const runtime = {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      if (options.failWith !== undefined) throw new Error(options.failWith)
      const record: Spawned = { spec, terminates: 0 }
      spawns.push(record)
      const done = new Promise<{ exitCode: number | null, signal: NodeJS.Signals | null }>((resolve) => {
        settle.push(code => { resolve({ exitCode: code, signal: null }) })
      })
      return {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: {},
        done,
        terminate: () => { record.terminates += 1 },
        waitForExit: async () => true,
      } as unknown as SubprocessHandle
    },
  }
  return {
    runtime: runtime as unknown as SubprocessRuntime,
    spawns,
    settle: (code: number) => { for (const resolve of settle) resolve(code) },
  }
}

/** One job registration, as the fake registry recorded it. */
interface Registered {
  readonly kind: string
  readonly label: string
  readonly owner?: string
  readonly sources: number
  /** The starter's hooks, once the starter ran. */
  hooks?: JobHooksLike
}

/** A job registry that admits everything and records each registration. */
function fakeRegistry(options: { refuseWith?: string } = {}) {
  const registrations: Registered[] = []
  let counter = 0
  const handle: JobHandleLike = { id: 'win-bash-1', append: () => {} }
  const registry: JobRegistryLike = {
    start(spec: JobSpecLike): string {
      if (options.refuseWith !== undefined) throw new Error(options.refuseWith)
      const record: Registered = {
        kind: spec.kind,
        label: spec.label,
        ...(spec.owner === undefined ? {} : { owner: spec.owner }),
        sources: spec.output?.length ?? 0,
      }
      registrations.push(record)
      record.hooks = spec.run(handle)
      return 'win-bash-' + (++counter).toString()
    },
  }
  return { registry, registrations }
}

/** The structural context the tool reads. */
function context(services: { jobs?: unknown, sandbox?: unknown, subprocess?: unknown, mode?: string } = {}): Context {
  const policy = { mode: services.mode ?? 'danger-full-access', workspaceRoot: process.cwd() } as unknown as SandboxExecutionPolicy
  return {
    get: (name: string) => {
      if (name === 'sandboxPolicy') return { resolve: () => policy }
      if (name === 'jobs') return services.jobs
      if (name === 'sandbox') return services.sandbox
      return undefined
    },
    subprocess: services.subprocess,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as Context
}

/** A shell registry that must never be reached on the background path. */
function forbiddenShells(): ShellRegistry {
  return {
    run: async () => { throw new Error('the background path must not touch the persistent shell') },
  } as unknown as ShellRegistry
}

/** The execution identity the tool reads. */
const exec = () => ({
  agent: { id: 'session-1', session: { header: { cwd: process.cwd() } } },
  signal: undefined,
})

/**
 * Drive one run_in_background call through the shipped tool.
 * @param services - the injected services and the session's mode.
 * @param config - the resolved plugin config.
 * @param args - the tool arguments.
 * @returns what the call returned, or the error it raised.
 */
async function runBackground(
  services: Parameters<typeof context>[0],
  config = resolveConfig(undefined),
  args: Record<string, unknown> = { command: 'echo bg', run_in_background: true },
): Promise<{ value?: Record<string, unknown>, error?: string }> {
  const tool = buildWinBashTool(
    context(services),
    config,
    { bash: 'C:/payload/bash.exe', bin: 'C:/payload/usr/bin' },
    forbiddenShells(),
  )
  try {
    return { value: (await tool.execute(args, exec() as never)) as Record<string, unknown> }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

describe('run_in_background availability', () => {
  it('operator on a deployment with no job registry gets no run_in_background parameter at all', () => {
    // Given a deployment that composes no job registry,
    const tool = buildWinBashTool(
      context(),
      resolveConfig(undefined),
      { bash: 'C:/payload/bash.exe', bin: 'C:/payload/usr/bin' },
      forbiddenShells(),
    )
    // When the advertised parameters are read,
    const names = Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)
    // Then the capability is not advertised, because a tool that offers a
    // surface its deployment cannot honour teaches the model something false.
    expect(names).toContain('command')
    expect(names).not.toContain('run_in_background')
  })

  it('operator on a deployment with a job registry gets run_in_background advertised', () => {
    // Given a deployment that composes a job registry,
    const { registry } = fakeRegistry()
    const tool = buildWinBashTool(
      context({ jobs: registry }),
      resolveConfig(undefined),
      { bash: 'C:/payload/bash.exe', bin: 'C:/payload/usr/bin' },
      forbiddenShells(),
    )
    // When the advertised parameters are read,
    const names = Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)
    // Then the capability is offered.
    expect(names).toContain('run_in_background')
  })

  it('operator turning the switch off gets no run_in_background even with a registry present', () => {
    // Given a deployment with a registry whose row disabled the capability,
    const { registry } = fakeRegistry()
    const tool = buildWinBashTool(
      context({ jobs: registry }),
      resolveConfig({ enableRunInBackground: false }),
      { bash: 'C:/payload/bash.exe', bin: 'C:/payload/usr/bin' },
      forbiddenShells(),
    )
    // When the advertised parameters are read,
    const names = Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)
    // Then the operator's switch wins.
    expect(names).not.toContain('run_in_background')
  })

  it('operator reading a service that refuses the lookup gets no registry rather than a thrown error', () => {
    // Given a context whose service lookup throws for an absent name,
    const throwing = {
      get: () => { throw new Error('service not found') },
    } as unknown as Context
    // When the registry is read,
    // Then an absent optional service is reported as absence.
    expect(readJobRegistry(throwing)).toBeUndefined()
  })
})

describe('a background call with a registry', () => {
  it('user asking for a background command gets a job id and never the persistent shell', async () => {
    // Given a deployment with a registry and a subprocess seam,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    // When the model runs one command in the background,
    const { value, error } = await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    // Then the call returned the job id the model collects it by, and the
    // persistent shell was not touched at all.
    expect(error).toBeUndefined()
    expect(value?.jobId).toBe('win-bash-1')
    expect(registrations.map(r => r.kind)).toEqual([BACKGROUND_JOB_KIND])
    expect(registrations[0].owner).toBe('session-1')
  })

  it('user asking for a background command gets a process started with the pinned payload absolute path', async () => {
    // Given a deployment with a registry and a subprocess seam,
    const { registry } = fakeRegistry()
    const subprocess = fakeSubprocess()
    // When the model runs one command in the background,
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    // When the spawn is inspected,
    const spec = subprocess.spawns[0].spec
    // Then argv[0] is the payload's own bash by absolute path — never a name
    // resolved through PATH, which is what this package exists to prevent.
    expect(spec.argv[0]).toBe('C:/payload/bash.exe')
    expect(spec.argv).toEqual(['C:/payload/bash.exe', '--norc', '--noprofile', '-s'])
    // And the environment contract matches the foreground shell's.
    expect(spec.env?.MSYSTEM).toBe('MSYS')
    expect(spec.env?.TERM).toBe('dumb')
    expect(String(spec.env?.PATH).startsWith('C:/payload/usr/bin')).toBe(true)
    expect(spec.env?.TMPDIR).toBe(spec.env?.TMP)
    expect(spec.env?.TMP).toBe(spec.env?.TEMP)
  })

  it('user asking for a background command gets its script written to the process stdin', async () => {
    // Given a deployment with a registry and a subprocess seam,
    const { registry } = fakeRegistry()
    const subprocess = fakeSubprocess()
    // When the model runs one command in the background,
    await runBackground({ jobs: registry, subprocess: subprocess.runtime }, resolveConfig(undefined),
      { command: 'echo bg', workdir: 'C:/work', run_in_background: true })
    // Then the command reached the process as its stdin batch, with the
    // workdir prefix this tool's foreground calls use.
    const stdin = subprocess.spawns[0].spec.stdio.stdin as { data: string }
    expect(stdin.data).toContain("cd 'C:/work'")
    expect(stdin.data).toContain('echo bg')
  })

  it('user asking for a background command gets its streams registered as pull sources, not buffered twice', async () => {
    // Given a deployment with a registry and a subprocess seam,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    // When the model runs one command in the background,
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    // Then both streams are registered as registry-pumped sources, so the
    // registry's bounded ring is the only place output accumulates.
    expect(registrations[0].sources).toBe(2)
  })

  it('user asking for a background command gets its private temp directory reclaimed once the job settles', async () => {
    // Given a started background job whose process owns a private temp
    // directory, with a command's leftovers in it,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    const temp = String(subprocess.spawns[0].spec.env?.TMP)
    expect(existsSync(temp)).toBe(true)
    // When that job ends,
    subprocess.settle(0)
    const outcome = await registrations[0].hooks?.done
    // Then the job's outcome is unchanged and the directory it owned is gone:
    // a long session that runs many background commands does not accumulate one
    // directory per command.
    expect(outcome?.status).toBe('completed')
    expect(existsSync(temp)).toBe(false)
  })

  it('operator rendering a background start sees the job id and how to use it', async () => {
    // Given a started background job,
    const { registry } = fakeRegistry()
    const subprocess = fakeSubprocess()
    const tool = buildWinBashTool(
      context({ jobs: registry, subprocess: subprocess.runtime }),
      resolveConfig(undefined),
      { bash: 'C:/payload/bash.exe', bin: 'C:/payload/usr/bin' },
      forbiddenShells(),
    )
    // When that result is rendered for the model,
    const value = await tool.execute({ command: 'echo bg', run_in_background: true }, exec() as never)
    const text = tool.output.render({ command: 'echo bg' }, value as never)
      .map(block => (block as { text: string }).text).join('')
    // Then the model is told the id and the two tools that act on it.
    expect(text).toContain('started background job win-bash-1')
    expect(text).toContain('job_output')
    expect(text).toContain('job_kill')
  })
})

describe('background refusal and cancellation', () => {
  it('user asking for a background command on a registry-less deployment is refused, not run in the foreground', async () => {
    // Given a deployment that composes no job registry, whose row still allows
    // the parameter (a row authored for a deployment that later lost it),
    // When the model asks for a background command,
    const { error } = await runBackground({}, resolveConfig({ enableRunInBackground: true }))
    // Then the call is refused with a reason naming the missing capability, and
    // the persistent shell was never reached — a silent foreground run would
    // hang the caller and then die with that shell.
    expect(error).toContain('BACKGROUND_UNAVAILABLE')
    expect(error).toContain('ctx.jobs')
    expect(error).toContain('not run in the foreground instead')
  })

  it('user asking for a background command with the switch off is refused by name', async () => {
    // Given a row that turned the capability off,
    const { registry } = fakeRegistry()
    // When the model asks for a background command anyway,
    const { error } = await runBackground(
      { jobs: registry, subprocess: fakeSubprocess().runtime },
      resolveConfig({ enableRunInBackground: false }),
    )
    // Then the refusal names the setting, so an operator can find it.
    expect(error).toContain('run_in_background is disabled')
    expect(error).toContain('enableRunInBackground')
  })

  it('operator cancelling a background job terminates its process', async () => {
    // Given a registered background job whose process is running,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    // When the model stops that job,
    registrations[0].hooks?.cancel('model stopped it')
    subprocess.settle(143)
    await registrations[0].hooks?.done
    // Then the managed process range was terminated, so the job stops owning a
    // live process rather than being forgotten while it runs.
    expect(subprocess.spawns[0].terminates).toBe(1)
  })

  it('operator cancelling a job twice terminates its process once', async () => {
    // Given a registered background job,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    // When cancellation arrives twice, as a kill racing an owner disposal does,
    registrations[0].hooks?.cancel()
    registrations[0].hooks?.cancel()
    subprocess.settle(143)
    await registrations[0].hooks?.done
    // Then the termination stayed idempotent.
    expect(subprocess.spawns[0].terminates).toBe(1)
  })

  it('operator reading a killed job sees it reported as killed, not as a failed command', async () => {
    // Given a job whose process this tool terminated,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    registrations[0].hooks?.cancel()
    subprocess.settle(143)
    // When the job's outcome is read,
    const outcome = await registrations[0].hooks?.done
    // Then it is a cancellation rather than a command failure.
    expect(outcome?.status).toBe('killed')
  })

  it('operator reading a finished job sees its real exit code in the detail line', async () => {
    // Given a job whose process exited with a nonzero status of its own,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    await runBackground({ jobs: registry, subprocess: subprocess.runtime })
    subprocess.settle(3)
    // When the job's outcome is read,
    const outcome = await registrations[0].hooks?.done
    // Then a nonzero command exit is reported as completed with that code,
    // exactly as a foreground call reports it.
    expect(outcome?.status).toBe('completed')
    expect(outcome?.detail).toBe('exit code: 3')
  })

  it('user asking for a background command on a process that cannot start gets a failed job, not a hang', () => {
    // Given a subprocess seam that refuses to spawn,
    const subprocess = fakeSubprocess({ failWith: 'spawn refused by the provider' })
    const { registry, registrations } = fakeRegistry()
    // When a background job is registered against it,
    const id = startBackgroundJob({
      subprocess: subprocess.runtime,
      jobs: registry,
      owner: 'session-1',
      script: 'echo bg',
      argv: ['C:/payload/bash.exe'],
      cwd: process.cwd(),
      env: {},
      label: 'echo bg',
      stdoutBytes: 1024,
      stderrBytes: 1024,
    })
    // Then the id is still issued — the registry owns the record — and its
    // outcome names the failure instead of leaving the model waiting.
    expect(id).toBe('win-bash-1')
    return expect(registrations[0].hooks?.done).resolves.toMatchObject({ status: 'failed' })
  })

  it('user asking for a background command on a process that cannot start gets its temp directory reclaimed anyway', async () => {
    // Given a private temp directory created for a job whose process will never
    // be spawned,
    const temp = shellTempDir()
    const subprocess = fakeSubprocess({ failWith: 'spawn refused by the provider' })
    const { registry, registrations } = fakeRegistry()
    startBackgroundJob({
      subprocess: subprocess.runtime,
      jobs: registry,
      owner: 'session-1',
      script: 'echo bg',
      argv: ['C:/payload/bash.exe'],
      cwd: process.cwd(),
      env: { TMP: temp, TEMP: temp, TMPDIR: temp },
      temp,
      label: 'echo bg',
      stdoutBytes: 1024,
      stderrBytes: 1024,
    })
    // When the failed job settles,
    const outcome = await registrations[0].hooks?.done
    // Then nothing is left on disk for a command that never ran.
    expect(outcome?.status).toBe('failed')
    expect(existsSync(temp)).toBe(false)
  })

  it('operator reading an outcome with no exit facts sees a completed-zero rather than an undefined code', () => {
    // Given a process that settled without publishing an exit code,
    // When its outcome is projected,
    const outcome = processOutcome(undefined, undefined, false)
    // Then the detail line still carries a readable code.
    expect(outcome).toEqual({ status: 'completed', detail: 'exit code: 0' })
  })
})

describe('a background command in a restricted session', () => {
  it('operator on a restricted session is refused before any process starts', async () => {
    // Given a session under a restricted mode and a working job registry,
    const { registry, registrations } = fakeRegistry()
    const subprocess = fakeSubprocess()
    // When the model runs one command in the background,
    const { error } = await runBackground(
      { jobs: registry, subprocess: subprocess.runtime, mode: 'read-only' },
    )
    // Then the refusal names the unsupported mode, and nothing was spawned and
    // no job was registered: the mode is refused, never silently confined or
    // silently run unconfined.
    expect(error).toContain('SANDBOX_UNSUPPORTED')
    expect(error).toContain('read-only')
    expect(subprocess.spawns).toEqual([])
    expect(registrations).toEqual([])
  })

  it('operator on a workspace-write session is refused by the same rule', async () => {
    // Given a session in the other restricted mode,
    const { registry } = fakeRegistry()
    const subprocess = fakeSubprocess()
    // When a background command is asked for,
    const { error } = await runBackground(
      { jobs: registry, subprocess: subprocess.runtime, mode: 'workspace-write' },
    )
    // Then it is refused for the same measured reason, not a different one.
    expect(error).toContain('SANDBOX_UNSUPPORTED')
    expect(error).toContain('0xC0000022')
    expect(subprocess.spawns).toEqual([])
  })
})
