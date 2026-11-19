/**
 * The Claude Code adapter.
 *
 * Flags come from this machine's `claude --help` (2.1.319): `-p`/`--print`
 * runs one task without the TUI, `--output-format stream-json` with
 * `--verbose` writes one JSON object per line, `--dangerously-skip-permissions`
 * is the bypass flag, and `--resume <id>` continues a session. The session id
 * arrives twice — on the `system/init` event and on the closing `result` — and
 * the summary is the `result` event's `result` field.
 *
 * @module dsh-task-board-ssh/core/adapters/claude
 */
import { shellJoin } from '../shell.ts'
import { readJsonLines, readString, type SshAgentCommand, type SshAgentOutput, type SshAgentRunInput } from './types.ts'

/** Program named on the remote host. */
export const CLAUDE_PROGRAM = 'claude'

/**
 * Build the Claude Code command line for one run.
 * @param input - run facts.
 * @returns the quoted command line, reading the prompt from stdin.
 */
export function claudeAgentCommand(input: SshAgentRunInput): SshAgentCommand {
  const argv = [
    CLAUDE_PROGRAM,
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ]
  if (input.resumeSessionId !== undefined) argv.push('--resume', input.resumeSessionId)
  return { command: shellJoin(argv), stdinFile: input.promptFile }
}

/**
 * Read the session id and the final summary out of a Claude Code stream.
 * @param output - captured stdout of one run.
 * @returns whatever the stream reported.
 */
export function readClaudeOutput(output: string): SshAgentOutput {
  const result: SshAgentOutput = {}
  for (const event of readJsonLines(output)) {
    const type = readString(event, 'type')
    if (type === 'system' && readString(event, 'subtype') === 'init' && result.sessionId === undefined) {
      result.sessionId = readString(event, 'session_id')
      continue
    }
    if (type === 'result') {
      const sessionId = readString(event, 'session_id')
      if (sessionId !== undefined) result.sessionId = sessionId
      const text = readString(event, 'result') ?? ''
      const isError = event.is_error === true
      result.outcome = isError
        ? { ok: false, error: text.length > 0 ? text : `the run ended with subtype "${readString(event, 'subtype') ?? 'error'}"` }
        : { ok: true, text }
    }
  }
  if (result.outcome === undefined) {
    result.outcome = { ok: false, error: 'the Claude Code stream ended without a result event' }
  }
  return result
}
