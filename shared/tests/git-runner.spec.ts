/**
 * Shared git runner tests: argv construction, collected-output mapping,
 * degrade mode (spawn/run failures become exitCode 127 runs), and throw mode.
 */
import { describe, expect, it, vi } from 'vitest'
import { subprocessRunner, type GitRunner, type SubprocessServiceLike } from '../host/git-runner.ts'

interface FakeHandle {
  done: Promise<{ exitCode: number | null }>
  collected: { stdout: { readFrom: (offset: number) => { text: string } }; stderr: { readFrom: (offset: number) => { text: string } } }
}

/** One fake subprocess ctx recording every spec and answering with canned outcomes. */
function fakeCtx(
  answer: (argv: readonly string[], spec: Record<string, unknown>) => Promise<{ exitCode: number | null }> | { exitCode: number | null },
  spawnThrows: unknown | null = null,
): { ctx: { subprocess: SubprocessServiceLike }; specs: Array<Record<string, unknown>>; spawn: ReturnType<typeof vi.fn> } {
  const specs: Array<Record<string, unknown>> = []
  const spawn = vi.fn((spec: Record<string, unknown>): FakeHandle => {
    if (spawnThrows !== null) throw spawnThrows
    specs.push(spec)
    const done = Promise.resolve(answer(spec.argv as readonly string[], spec))
    return {
      done,
      collected: {
        stdout: { readFrom: (_offset: number) => ({ text: 'out' }) },
        stderr: { readFrom: (_offset: number) => ({ text: 'err' }) },
      },
    }
  })
  return { ctx: { subprocess: { spawn } as unknown as SubprocessServiceLike }, specs, spawn }
}

function withRunner(
  ctx: { subprocess: SubprocessServiceLike },
  options: Parameters<typeof subprocessRunner>[1] = {},
): GitRunner {
  return subprocessRunner(ctx, options)
}

describe('subprocessRunner', () => {
  it('spawns git with the default argv and maps collected streams', async () => {
    const { ctx, specs } = fakeCtx(async () => ({ exitCode: 0 }))
    const runner = withRunner(ctx)
    const result = await runner.run(['status'], '/w')
    expect(specs[0]!.argv).toEqual(['git', 'status'])
    expect(specs[0]!.cwd).toBe('/w')
    expect(specs[0]!.graceMs).toBe(10_000)
    expect(result).toEqual({ exitCode: 0, stdout: 'out', stderr: 'err' })
  })

  it('passes cancellation to spawn and never degrades an aborted run', async () => {
    const reason = new Error('git status timed out')
    const controller = new AbortController()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { ctx, specs } = fakeCtx((_argv, spec) => new Promise((resolve) => {
        const signal = spec.signal as AbortSignal
        signal.addEventListener('abort', () => { resolve({ exitCode: null }) }, { once: true })
      }))
      const runner = withRunner(ctx, { failureMode: 'degrade', errorTag: 'dsh-aionui-panel' })
      const pending = runner.run(['status'], '/w', controller.signal)

      expect(specs[0]!.signal).toBe(controller.signal)
      controller.abort(reason)

      await expect(pending).rejects.toBe(reason)
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('does not spawn when cancellation already fired', async () => {
    const reason = new Error('cancelled before spawn')
    const controller = new AbortController()
    controller.abort(reason)
    const { ctx, spawn } = fakeCtx(async () => ({ exitCode: 0 }))
    const runner = withRunner(ctx)

    await expect(runner.run(['status'], '/w', controller.signal)).rejects.toBe(reason)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('uses the custom spawnArgv (win32 git.exe)', async () => {
    const { ctx, specs } = fakeCtx(async () => ({ exitCode: 0 }))
    const runner = withRunner(ctx, { spawnArgv: (argv) => ['git.exe', ...argv] })
    await runner.run(['branch'], '/w')
    expect(specs[0]!.argv).toEqual(['git.exe', 'branch'])
  })

  it('degrades a spawn failure to an exitCode 127 run and logs it', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { ctx } = fakeCtx(async () => ({ exitCode: 0 }), new Error('no git'))
      const runner = withRunner(ctx, { failureMode: 'degrade', errorTag: 'dsh-aionui-panel' })
      const result = await runner.run(['status'], '/w')
      expect(result.exitCode).toBe(127)
      expect(result.stderr).toBe('git: spawn failed: no git')
      expect(consoleSpy).toHaveBeenCalledWith('[dsh-aionui-panel] git spawn failed:', expect.any(Error))
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('degrades a run failure to an exitCode 127 run and logs it', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { ctx, spawn } = fakeCtx(async () => ({ exitCode: 0 }))
      spawn.mockImplementationOnce((spec: Record<string, unknown>) => ({
        done: Promise.reject(new Error('killed')),
        collected: {
          stdout: { readFrom: () => ({ text: '' }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      }))
      const runner = withRunner(ctx, { failureMode: 'degrade', errorTag: 'dsh-aionui-panel' })
      const result = await runner.run(['status'], '/w')
      expect(result.exitCode).toBe(127)
      expect(result.stderr).toBe('git: run failed: killed')
      expect(consoleSpy).toHaveBeenCalledWith('[dsh-aionui-panel] git run failed:', expect.any(Error))
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('propagates failures in throw mode (the default)', async () => {
    const { ctx, spawn } = fakeCtx(async () => ({ exitCode: 0 }))
    spawn.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const runner = withRunner(ctx)
    await expect(runner.run(['status'], '/w')).rejects.toThrow('boom')
  })
})
