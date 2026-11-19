/**
 * The Codex adapter.
 *
 * NOT VERIFIED ON A MACHINE THAT HAS CODEX: this repository's host does not
 * install it, so these flags are written from the official documentation
 * (`codex exec` non-interactive mode) and the event names come from its
 * published sample stream. Every assertion about Codex in this package is
 * therefore fixture-tested against that documented shape only, and the first
 * run on a host that has Codex must confirm or correct all of it.
 *
 * What the documentation pins: `codex exec --json` writes newline-delimited
 * events (`thread.started`, `turn.started`, `item.*`, `turn.completed`,
 * `turn.failed`, `error`), the thread id is `thread_id` on `thread.started`,
 * the final message is an `item.completed` with `item.type == "agent_message"`,
 * `--sandbox danger-full-access` is the unrestricted sandbox, `--full-auto` is
 * retired, `--skip-git-repo-check` lifts the "must run inside a git repository"
 * gate an in-place workspace may not satisfy, and `codex exec resume <id>`
 * continues a session.
 *
 * @module dsh-task-board-ssh/core/adapters/codex
 */
import { shellJoin } from '../shell.ts'
import { readJsonLines, readString, type SshAgentCommand, type SshAgentOutput, type SshAgentRunInput } from './types.ts'

/** Program named on the remote host. */
export const CODEX_PROGRAM = 'codex'

/**
 * Build the Codex command line for one run.
 * @param input - run facts.
 * @returns the quoted command line, reading the prompt from stdin.
 */
export function codexAgentCommand(input: SshAgentRunInput): SshAgentCommand {
  const argv = [
    CODEX_PROGRAM,
    'exec',
    '--json',
    '--sandbox',
    'danger-full-access',
    '--skip-git-repo-check',
  ]
  if (input.resumeSessionId !== undefined) argv.push('resume', input.resumeSessionId)
  return { command: shellJoin(argv), stdinFile: input.promptFile }
}

/**
 * Read the thread id and the final message out of a Codex event stream.
 * @param output - captured stdout of one run.
 * @returns whatever the stream reported; unverified against a real binary.
 */
export function readCodexOutput(output: string): SshAgentOutput {
  const result: SshAgentOutput = {}
  let lastMessage: string | undefined
  for (const event of readJsonLines(output)) {
    const type = readString(event, 'type')
    if (type === 'thread.started') {
      result.sessionId = readString(event, 'thread_id')
      continue
    }
    if (type === 'item.completed') {
      const item = event.item
      if (readString(item, 'type') === 'agent_message') {
        const text = readString(item, 'text')
        if (text !== undefined) lastMessage = text
      }
      continue
    }
    if (type === 'turn.completed' && lastMessage !== undefined) {
      result.outcome = { ok: true, text: lastMessage }
      continue
    }
    if (type === 'turn.failed' || type === 'error') {
      const message = readString(event, 'message') ?? readString(event.error, 'message')
      result.outcome = { ok: false, error: message ?? 'the run reported a failure' }
    }
  }
  if (result.outcome === undefined) {
    result.outcome = lastMessage === undefined
      ? { ok: false, error: 'the Codex event stream ended without an agent message' }
      : { ok: true, text: lastMessage }
  }
  return result
}
