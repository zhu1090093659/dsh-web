/**
 * custom-bash behavior tests (issue #283): the win32 `bash` tool must
 * register the Minimal-compatible schema, spawn `bash -c` through the
 * ordinary cross-platform subprocess seam, and fail with actionable errors
 * instead of silently switching shells. Path assertions are separator-
 * normalized so they hold on win32 runners, and the executable-existence
 * probe is mocked so the suite is hermetic (issue #763): results no longer
 * depend on whether the runner has Git for Windows installed.
 */

import { describe, expect, it, vi } from 'vitest'
import { apply, bashCandidates } from '../presets/liangshen/custom-bash.mjs'

/** Normalize path separators so assertions are runner-platform independent. */
const normSep = (p: string): string => p.replaceAll('\\', '/')

// The implementation probes candidate executables on the real filesystem
// (access resolves when the file exists). Mock the probe to reject like
// ENOENT so tests behave identically with or without Git for Windows on the
// runner (issue #763).
const { accessMock } = vi.hoisted(() => ({
  accessMock: vi.fn(async () => {
    throw new Error('ENOENT')
  }),
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, access: accessMock }
})

type SpawnFace = { argv: readonly string[]; cwd?: string }

/** Fake context: tools registry + subprocess seam. */
function makeCtx() {
  const registered: Array<Record<string, unknown>> = []
  const resolveExecutable = vi.fn(async (name: string) => `/resolved/${name}`)
  let spawnImpl: ((args: Record<string, unknown>) => unknown) | undefined
  const ctx = {
    tools: { register: (spec: Record<string, unknown>) => { registered.push(spec) } },
    subprocess: {
      resolveExecutable,
      spawn: (args: Record<string, unknown>) => {
        if (spawnImpl !== undefined) return spawnImpl(args)
        throw new Error('no spawn stub')
      },
    },
  } as never
  const setSpawn = (impl: (args: Record<string, unknown>) => unknown): void => { spawnImpl = impl }
  return { ctx, registered, resolveExecutable, setSpawn }
}

/** A spawn handle whose done resolves to the given outcome and collectors. */
function spawnHandle(outcome: { exitCode: number }, stdoutText = 'out', stderrText = '') {
  return {
    done: Promise.resolve(outcome),
    collected: {
      stdout: { readFrom: () => ({ text: stdoutText }) },
      stderr: { readFrom: () => ({ text: stderrText }) },
    },
  }
}

function execFace(partial: Record<string, unknown> = {}): never {
  return {
    signal: undefined,
    agent: { session: { header: { cwd: '/workspace' } } },
    ...partial,
  } as never
}

/** The registered tool spec + its execute function. */
function toolOf(ctx: ReturnType<typeof makeCtx>) {
  expect(ctx.registered).toHaveLength(1)
  const tool = ctx.registered[0]
  return { tool, execute: tool.execute as (args: Record<string, unknown>, exec: never) => Promise<{ text: string }> }
}

describe('bashCandidates', () => {
  it('derives Git Bash roots from the git executable path', () => {
    // node:path follows the runner platform, so probe with a POSIX-style
    // git path: <root>/cmd/git.exe -> <root>/bin/bash.exe; separators are
    // normalized before asserting so the expectations hold on win32 too.
    const candidates = bashCandidates({}, '/opt/git/cmd/git.exe').map(normSep)
    expect(candidates).toContain('/opt/git/bin/bash.exe')
    expect(candidates).toContain('/opt/git/cmd/bash.exe')
    expect(candidates).toContain('/opt/bin/bash.exe')
  })

  it('adds the well-known environment-derived roots', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\me',
    }
    const candidates = bashCandidates(env, undefined).map(normSep)
    // Platform-agnostic tails: each well-known root must appear
    // (separators are normalized, so the same tails hold on win32).
    const tails = [
      'Git/bin/bash.exe',
      'Program Files/Git/bin/bash.exe',
      'Program Files (x86)/Git/bin/bash.exe',
      'Local/Programs/Git/bin/bash.exe',
      'scoop/apps/git/current/bin/bash.exe',
    ]
    for (const tail of tails) {
      expect(candidates.some(c => c.includes(tail))).toBe(true)
    }
  })

  it('dedupes overlapping layouts while keeping probe order', () => {
    const candidates = bashCandidates({}, '/opt/git/bin/git.exe')
    expect(new Set(candidates).size).toBe(candidates.length)
  })
});

describe('custom-bash apply', () => {
  it('registers a Minimal-compatible bash tool (command required, no extra props)', () => {
    const m = makeCtx()
    apply(m.ctx as never, {})
    const { tool } = toolOf(m)
    expect(tool.name).toBe('bash')
    const schema = tool.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
    expect(schema.required).toEqual(['command'])
    expect(schema.properties.command).toBeDefined()
    expect(schema.additionalProperties).toBe(false)
  })

  it('spawns [bash, -c, command] in the session cwd and returns the output', async () => {
    const m = makeCtx()
    apply(m.ctx as never, {})
    const { execute } = toolOf(m)
    let spawnArgs: SpawnFace | undefined
    m.setSpawn((args) => {
      spawnArgs = args as unknown as SpawnFace
      return spawnHandle({ exitCode: 0 }, 'line1\nline2', '')
    })
    const result = await execute({ command: 'echo hi' }, execFace())
    expect(spawnArgs?.argv).toEqual(['/resolved/bash', '-c', 'echo hi'])
    expect(spawnArgs?.cwd).toBe('/workspace')
    expect(result.text).toBe('line1\nline2')
  })

  it('honors an explicit bashPath without probing', async () => {
    const m = makeCtx()
    apply(m.ctx as never, { bashPath: 'E:\\Git\\bin\\bash.exe' })
    const { execute } = toolOf(m)
    m.setSpawn((args) => {
      expect((args as unknown as SpawnFace).argv[0]).toBe('/resolved/E:\\Git\\bin\\bash.exe')
      return spawnHandle({ exitCode: 0 }, 'ok')
    })
    const result = await execute({ command: 'echo hi' }, execFace())
    expect(result.text).toBe('ok')
    expect(m.resolveExecutable).toHaveBeenCalledWith('E:\\Git\\bin\\bash.exe', undefined, undefined)
  })

  it('reports a non-zero exit as a thrown failure with the output', async () => {
    const m = makeCtx()
    apply(m.ctx as never, {})
    const { execute } = toolOf(m)
    m.setSpawn(() => spawnHandle({ exitCode: 2 }, 'boom output', 'stderr line'))
    await expect(execute({ command: 'false' }, execFace())).rejects.toThrow(/boom output/)
  })

  it('throws an actionable discovery error when no bash can be resolved', async () => {
    const m = makeCtx()
    apply(m.ctx as never, {})
    const { execute } = toolOf(m)
    m.resolveExecutable.mockRejectedValueOnce(new Error('ENOENT')).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(execute({ command: 'echo hi' }, execFace())).rejects.toThrow(/bash executable not found/)
  })
})
