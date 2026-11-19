/**
 * The adapter table: one entry per agent CLI this provider can start.
 *
 * The three built-in CLIs are verified against their help output and recorded
 * runs on this machine, except Codex, which is not installed here and is
 * written from its official documentation until a host that has it confirms the
 * shape. A custom agent is whatever command a deployment configures.
 *
 * @module dsh-task-board-ssh/core/adapters
 */
import { claudeAgentCommand, readClaudeOutput } from './claude.ts'
import { codexAgentCommand, readCodexOutput } from './codex.ts'
import { customAgentCommand } from './custom.ts'
import { dshAgentCommand, readDshOutput } from './dsh.ts'
import type { SshAgentCommand, SshAgentOutput, SshAgentRunInput, SshCustomTemplates } from './types.ts'

export * from './types.ts'
export { DSH_FULL_ACCESS_PRESET, DSH_PROGRAM, dshAgentCommand, readDshOutput } from './dsh.ts'
export { CLAUDE_PROGRAM, claudeAgentCommand, readClaudeOutput } from './claude.ts'
export { CODEX_PROGRAM, codexAgentCommand, readCodexOutput } from './codex.ts'
export {
  CUSTOM_PLACEHOLDERS,
  customAgentCommand,
  customResumeSupported,
  validateCustomTemplate,
} from './custom.ts'

/**
 * Build the command line one run starts with.
 *
 * The prompt reaches the agent through `stdinFile` for the three built-in CLIs,
 * so a long prompt never has to fit in one argument; a custom template decides
 * for itself and usually reads `{prompt_file}`.
 * @param input - run facts; `resumeSessionId` selects the resume form.
 * @param templates - the deployment's custom-agent templates, required for kind `custom`.
 * @returns the quoted command line and the stdin file, when the agent reads one.
 * @throws RangeError when a custom agent is selected without usable templates.
 */
export function buildAgentCommandLine(input: SshAgentRunInput, templates?: SshCustomTemplates): SshAgentCommand {
  switch (input.agent) {
    case 'dsh':
      return dshAgentCommand(input)
    case 'claude':
      return claudeAgentCommand(input)
    case 'codex':
      return codexAgentCommand(input)
    case 'custom':
      if (templates === undefined) throw new RangeError('a custom agent needs a command template')
      return customAgentCommand(input, templates)
    default: {
      const unexpected: never = input.agent
      throw new RangeError(`unknown agent kind: ${String(unexpected)}`)
    }
  }
}

/**
 * Read the session id and the final summary out of one run's output stream.
 * @param input - which agent produced the stream.
 * @param output - captured stdout.
 * @returns whatever the agent's reader found; a custom agent reports nothing.
 */
export function readAgentOutput(input: SshAgentRunInput, output: string): SshAgentOutput {
  switch (input.agent) {
    case 'dsh':
      return readDshOutput(output)
    case 'claude':
      return readClaudeOutput(output)
    case 'codex':
      return readCodexOutput(output)
    default:
      return {}
  }
}
