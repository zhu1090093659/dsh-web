/**
 * custom-bash — a Windows-capable `bash` tool for the liangshen preset. It
 * registers under the SAME name (`bash`) as the persistent shell so the
 * phase-1 Minimal anchor (bash + str_replace_editor) holds on every platform,
 * but executes through `ctx.subprocess.spawn` instead of a PTY.
 *
 * WHY: DSH's PTY backend is linux/darwin-only — subprocess-local throws
 * "terminal inspection is unsupported on platform win32", so the
 * persistent-shell group (dsh-terminal + dsh-terminal-bash +
 * dsh-tool-bash-persistent) cannot spawn on Windows. agent.cordis.yml disables
 * that group on win32 and enables this tool instead; both platforms end up
 * with exactly one `bash` tool and the byte-exact schema anchor is kept.
 *
 * Executable resolution (config `bashPath`, no hardcoded install path):
 * an explicit non-empty `bashPath` wins unconditionally. Unset, the Git Bash
 * executable is INFERRED in probe order:
 *  1. the `git` executable on PATH — its install root carries `bin\bash.exe`
 *     one level up from `cmd\`, beside `bin\`, or two levels up from
 *     `mingw64\bin\` (the standard installer, choco, and winget all resolve
 *     here);
 *  2. the well-known Git-for-Windows roots derived from environment variables
 *     (ProgramFiles, ProgramFiles(x86), LOCALAPPDATA\Programs\Git, scoop's
 *     ~\scoop\apps\git\current junction);
 *  3. plain `bash` through `ctx.subprocess.resolveExecutable` (PATH lookup —
 *     last resort; on Windows that may pick the WSL shim, which is still true
 *     bash even though paths shift to /mnt/…).
 *
 * If NOTHING resolves the tool fails with an actionable error — it never
 * silently executes under pwsh/cmd, which are different command languages.
 *
 * Semantics mirror the official bash tool: `bash -c <command>` in a fresh
 * process, bounded output, non-zero exit reported not thrown. No sandbox
 * confinement on Windows (the sandbox backend is linux-only); the description
 * says so.
 *
 * Ported from xiaobright/dsh-anchored-standard (MIT) — see NOTICE.
 */

import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'custom-bash'

/** The subprocess and tools services must exist before this tool can register. */
export const inject = ['subprocess', 'tools']

const DEFAULT_TIMEOUT_MS = 120000
const DEFAULT_MAX_OUTPUT_BYTES = 64000

/**
 * Git Bash candidate paths, in probe order (see the header): the `git`
 * executable's install root first, then the well-known env-derived roots.
 * Exported for tests; pure — existence probing happens at the call site.
 */
export function bashCandidates(env, gitExe) {
  const candidates = []
  // git at <root>\cmd\git.exe (installer/scoop) or <root>\bin\git.exe →
  // <root>\bin\bash.exe; <root>\mingw64\bin\git.exe (portable) → two up.
  // A bare relative name means `git` did not actually resolve to a path.
  if (typeof gitExe === 'string' && /[/\\]/.test(gitExe)) {
    const dir = dirname(gitExe)
    const root = dirname(dir)
    candidates.push(
      join(root, 'bin', 'bash.exe'),
      join(dir, 'bash.exe'),
      join(dirname(root), 'bin', 'bash.exe'),
    )
  }
  if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'))
  if (env['ProgramFiles(x86)']) candidates.push(join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'))
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'))
  if (env.USERPROFILE) candidates.push(join(env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'))
  // Layouts overlap (a `bin` git.exe derives the same bash twice) — probe
  // order survives the dedupe, insertion order is preserved.
  return [...new Set(candidates)]
}

/** Tool parameter schema for the model-facing command. */
const commandSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'The bash command to execute (`bash -c` string domain).',
    },
    workdir: {
      type: 'string',
      description: 'Optional working directory; defaults to the session cwd.',
    },
  },
  required: ['command'],
  additionalProperties: false,
}

/** Register the model-facing `bash` tool. */
export function apply(ctx, config) {
  const explicitBashPath = typeof config?.bashPath === 'string' && config.bashPath.length > 0 ? config.bashPath : undefined
  const timeoutMs = Number.isSafeInteger(config?.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxOutputBytes = Number.isSafeInteger(config?.maxOutputBytes) && config.maxOutputBytes > 0 ? config.maxOutputBytes : DEFAULT_MAX_OUTPUT_BYTES

  // The inferred executable is memoized per plugin instance: candidate probing
  // walks the filesystem, and the answer cannot change within a mount. A
  // failed inference is NOT memoized — the plain `bash` fallback resolves
  // fresh on every execute until some probe succeeds.
  let inferredShell
  const exists = (path) => access(path).then(() => true, () => false)
  const resolveShell = async (signal) => {
    if (explicitBashPath !== undefined) {
      // A misconfigured explicit path must fail as itself, not as a
      // discovery miss — the raw resolution error says which path failed.
      return ctx.subprocess.resolveExecutable(explicitBashPath, undefined, signal)
    }
    if (inferredShell !== undefined) {
      return ctx.subprocess.resolveExecutable(inferredShell, undefined, signal)
    }
    let gitExe
    try {
      gitExe = await ctx.subprocess.resolveExecutable('git', undefined, signal)
    } catch {
      // git unresolvable → the env-derived candidates below still apply
    }
    for (const candidate of bashCandidates(process.env, gitExe)) {
      if (!(await exists(candidate))) continue
      try {
        inferredShell = await ctx.subprocess.resolveExecutable(candidate, undefined, signal)
        return inferredShell
      } catch {
        // Exists but unresolvable (EPERM, a broken scoop junction): keep
        // probing — one bad root must not block the rest of the chain, and
        // nothing is memoized so later executes can still find a good one.
        continue
      }
    }
    try {
      return await ctx.subprocess.resolveExecutable('bash', undefined, signal)
    } catch (error) {
      // Total discovery failure (no Git Bash root, no env root, no bash on
      // PATH): name the remedies instead of leaking a raw ENOENT. Never
      // fall back to pwsh/cmd here — the schema promises `bash -c`
      // semantics; a different shell would silently break every command.
      throw new Error(`bash executable not found — install Git for Windows, expose a bash on PATH, or set the custom-bash \`bashPath\` config (${String((error && error.message) || error)})`)
    }
  }

  ctx.tools.register({
    name: 'bash',
    description: [
      'Run commands in a bash shell (Git Bash on Windows)',
      '* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.',
      "* You don't have access to the internet via this tool.",
      '* You do have access to a mirror of common linux and python packages via apt and pip.',
      '* State does NOT persist across command calls: each call runs in a fresh shell.',
      "* To inspect a particular line range of a file, e.g. lines 10-25, try 'sed -n 10,25p /path/to/the/file'.",
      '* Please avoid commands that may produce a very large amount of output.',
      '* NOTE: runs without OS sandbox confinement on Windows (no landlock); treat output as untrusted.',
    ].join('\n'),
    parameters: commandSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const shell = await resolveShell(exec?.signal)
      const workdir = typeof args.workdir === 'string' && args.workdir.length > 0
        ? args.workdir
        : exec?.agent?.session?.header?.cwd
      const signal = exec?.signal
      const handle = ctx.subprocess.spawn({
        argv: [shell, '-c', args.command],
        ...workdir !== undefined ? { cwd: workdir } : {},
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: maxOutputBytes },
          stderr: { maxBytes: maxOutputBytes },
        },
        ...signal !== undefined ? { signal } : {},
        graceMs: 3000,
      })
      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        // A spawn-level failure (bad executable, EPERM) surfaces as a throw,
        // which the runtime turns into an isError result.
        throw new Error(`bash spawn failed: ${String(error)}`)
      }
      let stdout = ''
      let stderr = ''
      try {
        stdout = handle.collected.stdout.readFrom(0).text
        stderr = handle.collected.stderr.readFrom(0).text
      } catch {
        // Collected readers may be unavailable on some backends; tolerate.
      }
      const text = [stdout, stderr].filter((part) => part.length > 0).join('\n')
      const tail = text.length > 0 ? text : `exit code: ${outcome.exitCode} (no output)`
      if (outcome.exitCode !== 0) {
        // Non-zero exit is a reported failure, not a throw: the model sees the
        // command output plus the exit code.
        throw new Error(tail)
      }
      return { text: tail }
    },
  })
}
