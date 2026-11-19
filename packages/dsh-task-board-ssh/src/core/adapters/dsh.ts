/**
 * The dsh agent adapter.
 *
 * Flags and event shapes are read from this machine's `dsh headless --help` and
 * from recorded runs, not from memory: `--json` writes newline-delimited run
 * events, `--session-id` adopts a persisted session, and `--permission-mode`
 * selects a configured preset. The preset named here is the fully unattended
 * one, verified against the CLI's own error text, which lists the three presets
 * a deployment always has:
 *
 * ```text
 * dsh: permission: unknown preset "not-a-preset" (known: read-only, workspace-write, danger-full-access)
 * ```
 *
 * @module dsh-task-board-ssh/core/adapters/dsh
 */
import { shellJoin } from '../shell.ts'
import { readJsonLines, readString, type SshAgentCommand, type SshAgentOutput, type SshAgentRunInput } from './types.ts'

/**
 * Permission preset every remote run uses: unrestricted sandbox with approval
 * policy `never`, which is what "fully unattended" means on a host nobody is
 * watching.
 */
export const DSH_FULL_ACCESS_PRESET = 'danger-full-access'

/** Program named on the remote host. */
export const DSH_PROGRAM = 'dsh'

/**
 * Build the dsh command line for one run.
 * @param input - run facts.
 * @returns the quoted command line, reading the prompt from stdin.
 */
export function dshAgentCommand(input: SshAgentRunInput): SshAgentCommand {
  const argv = [
    DSH_PROGRAM,
    'headless',
    '--json',
    '--permission-mode',
    DSH_FULL_ACCESS_PRESET,
  ]
  if (input.resumeSessionId !== undefined) argv.push('--session-id', input.resumeSessionId)
  // A trailing `-` is the CLI's documented way to read the task from stdin, so
  // a multi-megabyte prompt never has to fit in one argument.
  argv.push('-')
  return { command: shellJoin(argv), stdinFile: input.promptFile }
}

/**
 * Read the session id and the final summary out of a dsh event stream.
 * @param output - captured stdout of one run.
 * @returns whatever the stream reported.
 */
export function readDshOutput(output: string): SshAgentOutput {
  const result: SshAgentOutput = {}
  for (const event of readJsonLines(output)) {
    const type = readString(event, 'type')
    if (type === 'session' && result.sessionId === undefined) {
      result.sessionId = readString(event, 'sessionId')
      continue
    }
    if (type === 'final') {
      const sessionId = readString(event, 'sessionId')
      if (sessionId !== undefined) result.sessionId = sessionId
      const reason = event.reason
      const kind = readString(reason, 'kind')
      if (kind === 'completed') {
        result.outcome = { ok: true, text: readString(event, 'text') ?? '' }
      } else {
        const message = readString(reason, 'error') ?? readString(reason, 'message')
        const error = typeof reason === 'object' && reason !== null
          ? readString((reason as Record<string, unknown>).error, 'message')
          : undefined
        result.outcome = { ok: false, error: error ?? message ?? 'the run ended without a completed turn' }
      }
      continue
    }
    if (type === 'error' && result.outcome === undefined) {
      result.outcome = { ok: false, error: readString(event, 'message') ?? 'the run reported a failure' }
    }
  }
  if (result.outcome === undefined) {
    result.outcome = { ok: false, error: 'the dsh event stream ended without a final event' }
  }
  return result
}
