/**
 * The model-facing win_bash tool.
 *
 * Named win_bash and not bash on purpose: the host already mounts its own
 * bash-family tools (bash, pwsh), and a name collision would either be a
 * duplicate-registration failure or, worse, silently replace the host's tool.
 * This tool is additional capability, not a replacement.
 *
 * Permission: the sandbox-policy service is read for the CALLING SESSION, since
 * a session's own mode log outranks the deployment default. A session in a
 * restricted mode is refused outright rather than confined — see
 * {@link assertUnconfined} for the measured reason.
 * @module @linxin666/dsh-win-bash/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JobRegistryLike } from './background.ts'
import { BACKGROUND_STDERR_BYTES, BACKGROUND_STDOUT_BYTES, startBackgroundJob } from './background.ts'
import type { WinBashConfig } from './config.ts'
import { shellArgv, shellEnvironment, shellTempDir, type ShellRegistry } from './shell.ts'

/** The registered tool name. Deliberately not bash. */
export const WIN_BASH_TOOL = 'win_bash'

/** Every sandbox mode a session may run under. */
const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

/** The only mode this tool runs under; every other mode is refused. */
const SUPPORTED_MODE: SandboxMode = 'danger-full-access'

/** The policy read this tool consumes from the sandbox-policy service. */
interface PolicyResolver {
  resolve(request?: { session?: unknown, mode?: SandboxMode }): SandboxExecutionPolicy
}

/**
 * Refuse every session mode but danger-full-access.
 *
 * WHY REFUSAL RATHER THAN CONFINEMENT. A restricted session would have to spawn
 * this payload through the sandbox provider's confine step, and the pinned MSYS2
 * bash cannot start that way. Measured on win32 x64 (Windows 10.0.26200) against
 * the real restricted-token runner: bash.exe, sh.exe, dash.exe and echo.exe all
 * die BEFORE main with
 *   NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-<hash>): 0xC0000022
 * (exit 3221225794 / 0xC0000142), and system Git for Windows fails identically
 * ('couldn't create signal pipe, Win32 error 5'). cmd.exe, node.exe and
 * powershell.exe run confined on that same runner, so the runner is sound and
 * the limitation belongs to the MSYS runtime.
 *
 * So confinement here cannot produce a working shell, and a shell whose every
 * command dies before main is worse than an honest refusal: it would report a
 * boundary that never actually held any command. The refusal names the other
 * shells, which ARE confined, so the caller is not left without a route.
 * @param policy - the session's effective policy.
 * @throws when the session runs under any other mode.
 */
function assertUnconfined(policy: SandboxExecutionPolicy): void {
  if (policy.mode === SUPPORTED_MODE) return
  throw new Error(
    'SANDBOX_UNSUPPORTED: win_bash runs only under ' + SUPPORTED_MODE + ', and this session is in ' + policy.mode
    + ' mode. The pinned MSYS2 bash cannot start under a restricted token (it dies before main with'
    + ' NtCreateDirectoryObject 0xC0000022), so no bash command can run inside that boundary.'
    + ' Run the command with the host pwsh tool instead: it is the native shell for this platform, it IS confined, and it'
    + ' stays on this session surface whenever win_bash cannot serve the session. win_bash is the preferred shell, not the'
    + ' only one. Switching this session to ' + SUPPORTED_MODE + ' brings win_bash back.',
  )
}

/** One agent session's working directory, read structurally. */
function sessionCwd(agent: unknown): string | undefined {
  const session = (agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session
  const cwd = session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/**
 * Single-quote one value for the shell, escaping embedded single quotes.
 * @param value - the raw value.
 * @returns a POSIX single-quoted literal.
 */
export function shellQuote(value: string): string {
  return "'" + value.split("'").join("'\\''") + "'"
}

/**
 * Normalize a Windows path into the spelling MSYS accepts without escaping:
 * a backslash is also the shell's escape character, so a path handed to cd is
 * converted to forward slashes before it is quoted.
 * @param path - the caller-supplied working directory.
 * @returns the same path with backslashes replaced.
 */
export function normalizeWorkdir(path: string): string {
  return path.split('\\').join('/')
}

/**
 * Clamp a per-call deadline to the configured ceiling.
 * @param requested - the model's timeoutMs, if any.
 * @param configured - the plugin's configured default and ceiling.
 * @returns the effective deadline in milliseconds.
 * @throws when the requested value is not a positive whole number.
 */
export function clampTimeout(requested: number | undefined, configured: number): number {
  if (requested === undefined) return configured
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new Error('win_bash: timeoutMs must be a positive whole number of milliseconds.')
  }
  return Math.min(requested, configured)
}

/** The truncation facts a rendered result reports to the model. */
export interface RenderFacts {
  /** Visible stdout, already cut to its byte budget. */
  stdout: string
  /** Visible stderr, already cut to its byte budget. */
  stderr: string
  /** The command's exit status. */
  exitCode: number
  /** True when visible stdout hit its byte budget. */
  stdoutTruncated?: boolean
  /** True when visible stderr hit its byte budget. */
  stderrTruncated?: boolean
  /** True when the retained stdout lost its head. */
  stdoutLostHead?: boolean
  /** True when the retained stderr lost its head. */
  stderrLostHead?: boolean
  /** True when the frame watch window dropped the middle of stdout. */
  frameOverflow?: boolean
  /** Host path of the complete stdout, when the provider spilled it. */
  stdoutSpillPath?: string
  /** Host path of the complete stderr, when the provider spilled it. */
  stderrSpillPath?: string
}

/** UTF-8 byte length of a string. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * The CSI escape sequences a Windows child process emits with no terminal
 * attached: colour (SGR) and the cursor/erase families a progress renderer
 * uses. OSC, which Windows Terminal uses for JSON semantic-prompt marks, is
 * matched as a whole so its embedded JSON never leaks into the text.
 *
 * WHY THIS IS STRIPPED HERE AND NOWHERE ELSE. The colour libraries a build
 * tool uses (`picocolors`, `tinyrainbow`) short-circuit the "no TTY means no
 * colour" rule on Windows itself — `platform === 'win32' ||` is one of their
 * disjuncts — so `TERM=dumb`, which {@link shellEnvironment} already sets, does
 * not turn them off, and neither does piping. The bytes below arrive in
 * ordinary vitest and pnpm output on this very platform. This tool passes raw
 * bytes through on purpose (that is what the pipe model buys); rendering them
 * as text is the step that makes ``\u001b[33m`` and ``\u001b[1m`` legible to
 * nobody. Both streams go through it, since a red error message is as
 * unreadable as a red test summary. The loss is confined to this rendered view:
 * the byte budgets, the exit code and any spill file still describe the exact
 * stream, because colour is not information the text was carrying.
 */
// eslint-disable-next-line no-control-regex -- matching control characters IS the job
const ANSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g

/**
 * Keep only the frame a repainting line ended on.
 *
 * A progress renderer overwrites one line with carriage returns instead of
 * writing new ones, so the raw stream holds every frame glued together. A
 * terminal shows the last one; text shows all of them. CRLF is not a repaint —
 * it is how a Windows command ends a line — so a pair is left exactly as it
 * was written.
 * @param text - the text whose lines may have been repainted in place.
 * @returns the text where each line shows the frame it finished on.
 */
function collapseRepaints(text: string): string {
  if (!text.includes('\r')) return text
  const lines = text.split('\n')
  return lines.map((line, index) => {
    const endsLine = index < lines.length - 1 && line.endsWith('\r')
    const body = endsLine ? line.slice(0, -1) : line
    const cut = body.lastIndexOf('\r')
    const kept = cut === -1 ? body : body.slice(cut + 1)
    return endsLine ? kept + '\r' : kept
  }).join('\n')
}

/**
 * Make a rendered string readable: drop the escape sequences, then let each
 * repainted line show the frame it ended on.
 * @param text - the string about to be shown to a caller.
 * @returns the text with escapes stripped and overwritten frames collapsed.
 */
export function stripTerminalEscapes(text: string): string {
  const unescaped = text.includes('\u001b') ? text.replace(ANSI_SEQUENCE, '') : text
  return collapseRepaints(unescaped)
}

/**
 * The line that tells the model its view of one stream is incomplete.
 *
 * WHY THIS IS NOT DECORATION. The visible text is the TAIL of the stream: the
 * head was already cut to fit the byte budget, so the first thing the model
 * reads can be the middle of a line with nothing marking the cut. Without this
 * line a partial result is indistinguishable from a short one, and a model
 * reading a truncated listing draws conclusions from data it never saw.
 * @param stream - stream label.
 * @param visible - the bytes actually shown.
 * @param flags - which cuts happened.
 * @param spillPath - complete-stream file, when the provider kept one.
 * @returns the notice, or undefined when that stream was shown in full.
 */
export function truncationNotice(
  stream: 'stdout' | 'stderr',
  visible: string,
  flags: { truncated: boolean, lostHead: boolean, overflow: boolean },
  spillPath?: string,
): string | undefined {
  if (!flags.truncated && !flags.lostHead && !flags.overflow) return undefined
  const parts = [
    '[win_bash: ' + stream + ' was truncated, only the last ' + byteLength(visible).toString() + ' bytes are shown',
  ]
  if (flags.lostHead || flags.truncated) parts.push('; the beginning was dropped')
  if (flags.overflow) parts.push('; a middle window was dropped by the frame watch limit')
  if (spillPath !== undefined) parts.push('. The complete stream is at ' + spillPath)
  parts.push(']')
  return parts.join('')
}

/**
 * Render one result the way the host's own shell tools render theirs.
 *
 * This is where the raw stream becomes something a caller can read: escape
 * sequences are stripped (see {@link stripTerminalEscapes}), so a Windows build
 * tool that colours its piped output does not hand back a wall of ``\u001b[1m``
 * to the model and to the terminal card. The truncation notices below are this
 * tool's own text and are appended AFTER stripping, so they survive intact.
 */
export function renderResult(value: RenderFacts): string {
  let body = stripTerminalEscapes(value.stdout)
  if (value.stderr !== '') {
    if (body !== '' && !body.endsWith('\n')) body += '\n'
    body += '[stderr]\n' + stripTerminalEscapes(value.stderr)
  }
  if (body === '') body = '(no output)'
  const parts = [body]
  // The truncation notices come FIRST, before the exit line: a model that reads
  // only the head of a long result still learns that the output was cut, which
  // is the one fact it cannot recover from the text.
  const outNotice = truncationNotice('stdout', value.stdout, {
    truncated: value.stdoutTruncated === true,
    lostHead: value.stdoutLostHead === true,
    overflow: value.frameOverflow === true,
  }, value.stdoutSpillPath)
  if (outNotice !== undefined) parts.push(outNotice)
  const errNotice = truncationNotice('stderr', value.stderr, {
    truncated: value.stderrTruncated === true,
    lostHead: value.stderrLostHead === true,
    overflow: false,
  }, value.stderrSpillPath)
  if (errNotice !== undefined) parts.push(errNotice)
  if (value.exitCode !== 0) parts.push('[exit code: ' + value.exitCode.toString() + ']')
  return parts.join('\n')
}

/**
 * The deployment's background job registry, read without letting a refused
 * lookup escape: a cordis service proxy throws for a name it cannot resolve,
 * and "this deployment composes no job registry" is an ordinary state here,
 * not an error.
 * @param ctx - the plugin context.
 * @returns the registry, or undefined when this deployment has none.
 */
export function readJobRegistry(ctx: Context): JobRegistryLike | undefined {
  let candidate: unknown
  try {
    candidate = ctx.get('jobs')
  } catch {
    return undefined
  }
  if (candidate === null || typeof candidate !== 'object') return undefined
  if (typeof (candidate as { start?: unknown }).start !== 'function') return undefined
  return candidate as JobRegistryLike
}

/**
 * The calling session's effective policy, or undefined when the service is absent.
 *
 * The SESSION goes into the request on purpose: the service resolves a session's
 * own mode log before the deployment default, so a read without it answers for
 * the deployment and would let a session the user restricted run here.
 * @param ctx - the plugin context.
 * @param agent - the calling agent, carrying the session whose mode applies.
 * @returns the policy, or undefined when no service is composed.
 * @throws when the service answers with a policy this tool cannot read.
 */
function resolvePolicy(ctx: Context, agent: unknown): SandboxExecutionPolicy | undefined {
  const service = ctx.get('sandboxPolicy') as PolicyResolver | undefined
  if (service === undefined || typeof service.resolve !== 'function') return undefined
  const session = (agent as { session?: unknown } | undefined)?.session
  const policy = service.resolve(session === undefined ? {} : { session })
  if (!SANDBOX_MODES.includes(policy.mode) || typeof policy.workspaceRoot !== 'string') {
    throw new Error('win_bash: the sandbox policy service returned an invalid policy; no command was started.')
  }
  return policy
}

/**
 * Build the win_bash tool bound to one payload and one shell registry.
 * @param ctx - host context carrying the optional sandbox and job services.
 * @param config - the resolved plugin configuration.
 * @param runtime - absolute shell and payload paths.
 * @param shells - the registry owning this plugin instance's shells.
 * @returns the tool definition, ready for the tools registry.
 */
export function buildWinBashTool(
  ctx: Context,
  config: WinBashConfig,
  runtime: { bash: string, bin: string },
  shells: ShellRegistry,
): ToolDefinition {
  // The background surface follows the registry, read once at build time: the
  // entry registers the foreground-only variant when this deployment composes
  // no job registry, so run_in_background is not advertised where it could
  // never be honoured.
  const jobs = config.enableRunInBackground ? readJobRegistry(ctx) : undefined
  return defineTool({
    name: WIN_BASH_TOOL,
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description:
          "The bash command to run in this session's persistent shell. Any number of lines; the working directory and exported variables from earlier win_bash calls are still in effect.",
      },
      workdir: {
        type: 'string',
        description:
          "Working directory for this command. Omitted keeps the shell's current directory, which is the session workspace until a command cds elsewhere. A relative path resolves against that directory.",
      },
      timeoutMs: {
        type: 'integer',
        description:
          'Wall-clock limit for this command in milliseconds (default '
          + config.timeoutMs.toString()
          + '). On expiry the shell is stopped and the next call starts a fresh one.',
      },
      ...jobs === undefined ? {} : {
        run_in_background: {
          type: 'boolean' as const,
          description:
            'Run in a separate pinned bash process and return a job id immediately; collect it with job_output and stop it with job_kill. '
            + 'No timeout applies, the persistent shell is not used, and this process survives this call.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          exitCode: { type: 'integer', required: true },
          // The truncation facts ./shell.ts already computes. They are declared
          // here because an undeclared output member is not part of the
          // canonical value the model's rendering is projected from.
          stdoutTruncated: { type: 'boolean' },
          stderrTruncated: { type: 'boolean' },
          stdoutLostHead: { type: 'boolean' },
          stderrLostHead: { type: 'boolean' },
          frameOverflow: { type: 'boolean' },
          stdoutSpillPath: { type: 'string' },
          stderrSpillPath: { type: 'string' },
          jobId: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text' as const,
        text: value.jobId === undefined
          ? renderResult(value)
          : 'started background job ' + value.jobId
            + ' (collect it with job_output, stop it with job_kill)',
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('win_bash needs an owning agent session: the persistent shell belongs to the session that calls it.')
      }
      const cwd = sessionCwd(agent)
      if (cwd === undefined) {
        throw new Error('win_bash needs a calling session with a working directory.')
      }
      const policy = resolvePolicy(ctx, agent)
      if (policy === undefined) {
        throw new Error(
          'win_bash: the deployment serves no sandbox policy service, so this command has no authoritative permission mode'
          + ' and will not run. Use the host pwsh tool instead: it is the native shell for this platform and remains available'
          + ' whenever win_bash cannot serve a call.',
        )
      }
      // Before anything is spawned or registered: a restricted session is told
      // so, rather than handed a shell that dies before running its command.
      assertUnconfined(policy)
      const timeoutMs = clampTimeout(args.timeoutMs, config.timeoutMs)
      const command = args.workdir === undefined || args.workdir === ''
        ? args.command
        : 'cd ' + shellQuote(normalizeWorkdir(args.workdir)) + ' && ' + args.command

      // A background job owns its own pinned process. It must be refused
      // BEFORE any decision to run it in the foreground: silently running the
      // command in this session's persistent shell would hang the caller for
      // the command's whole lifetime and then die with that shell, which is
      // the opposite of what was asked for.
      if (args.run_in_background === true) {
        if (!config.enableRunInBackground) {
          throw new Error(
            'win_bash: run_in_background is disabled for this deployment (enableRunInBackground: false),'
            + ' so this call was not started.',
          )
        }
        const registry = readJobRegistry(ctx)
        if (registry === undefined) {
          throw new Error(
            'BACKGROUND_UNAVAILABLE: this deployment composes no background job registry (ctx.jobs), so win_bash cannot'
            + ' register a background command. This call was not run in the foreground instead. Run it without'
            + ' run_in_background, or start it in the background with the host pwsh tool, which is the native shell for'
            + ' this platform and stays available whenever win_bash cannot serve a call.',
          )
        }
        const temp = shellTempDir()
        const jobId = startBackgroundJob({
          subprocess: ctx.subprocess,
          jobs: registry,
          owner: agent.id,
          script: command,
          argv: shellArgv(runtime),
          cwd,
          env: shellEnvironment(runtime, temp),
          temp,
          label: args.command,
          stdoutBytes: BACKGROUND_STDOUT_BYTES,
          stderrBytes: BACKGROUND_STDERR_BYTES,
        })
        return { stdout: '', stderr: '', exitCode: 0, jobId }
      }

      const result = await shells.run(agent, runtime, cwd, command, {
        stdoutBytes: config.maxStdoutBytes,
        stderrBytes: config.maxStderrBytes,
        timeoutMs,
        signal: exec.signal,
      })
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        stdoutLostHead: result.stdoutLostHead,
        stderrLostHead: result.stderrLostHead,
        frameOverflow: result.frameOverflow,
        ...(result.stdoutSpillPath === undefined ? {} : { stdoutSpillPath: result.stdoutSpillPath }),
        ...(result.stderrSpillPath === undefined ? {} : { stderrSpillPath: result.stderrSpillPath }),
      }
    },
    presentCall: (args) => args.run_in_background === true
      ? {
          card: 'generic' as const,
          title: args.command,
          kind: 'execute' as const,
          rawInput: args.command,
          content: [{ type: 'text' as const, text: 'background command (win_bash)' }],
        }
      : {
          card: 'terminal' as const,
          title: args.command,
          description: 'persistent bash (win_bash)',
        },
  })
}
