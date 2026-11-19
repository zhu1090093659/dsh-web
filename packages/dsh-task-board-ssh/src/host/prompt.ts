/**
 * The text one run's prompt carries: the proxy preamble a local session starts
 * with, and the instruction a resumed (or degraded) run reads.
 *
 * These are model-facing strings, so they live here rather than in a locale
 * dictionary, exactly as the board's own tool descriptions do. Nothing in them
 * is rendered to a person.
 *
 * @module dsh-task-board-ssh/host/prompt
 */
import type { TaskRecord } from '../core/task-record.ts'
import type { SshTarget } from '../core/target.ts'
import type { SshPendingInstruction } from './payload.ts'

/** The tool family a proxy run has to drive the host with. */
export const SSH_TOOL_FAMILY = 'ssh_list, ssh_exec, ssh_upload and ssh_download'

/** Prefix a recorded summary carries when the instruction started a fresh run. */
export const SSH_DEGRADED_SUMMARY_MARKER = '[fresh run: this agent cannot resume, so the previous summary was carried in the prompt]'

/** Where a proxy run's work happens, in the words the model reads. */
function proxyPlacement(target: SshTarget): string {
  const workspace = target.workspace
  if (workspace.kind === 'in-place') {
    return `Remote directory: ${workspace.path}`
  }
  const source = workspace.source
  if (source.kind === 'url') {
    const base = source.base === undefined ? '' : ` (base branch ${source.base})`
    return `Repository: ${source.url}${base}. Create a per-run worktree of it on the host before you edit, and leave the result on the host.`
  }
  return `Repository: the workspace repository ${source.workspaceId}. It has to be sent to the host before the run, so ask the user to pin a repository URL instead when one is reachable there.`
}

/**
 * Build the preamble a proxy card's local session opens with.
 *
 * The board injects it ahead of the card body on the same path it injects tag
 * prefixes, so the session reads what this run IS before it reads the task: the
 * work happens on a pinned host through the `ssh_*` tools, and nothing about the
 * card is local.
 * @param task - the card about to run.
 * @param target - the target the card pins.
 * @returns the preamble text.
 */
export function proxyPreamble(task: TaskRecord, target: SshTarget): string {
  return [
    'Remote execution target (task board SSH provider, proxy mode).',
    `Host alias: ${target.host}`,
    proxyPlacement(target),
    `Run every command and every file operation for this card on that host through the ssh_* tools of the dsh-ssh plugin (${SSH_TOOL_FAMILY}); read the host list with ssh_list before you start if you are unsure of the alias. The paths above exist on the host, not on this machine, so do not do the work locally and do not assume a local path mirrors a remote one.`,
    `Card: ${task.title} (id ${task.id})`,
  ].join('\n')
}

/**
 * Build the prompt one run reads.
 *
 * A start reads the card's own prompt. A follow-up or a rework that continues the
 * agent's session reads the instruction alone, because the session already holds
 * the work. A degraded follow-up — the agent cannot be resumed — reads what the
 * previous run reported before it reads the instruction, which is the whole
 * reason that path exists.
 * @param task - the card being run.
 * @param pending - the instruction this run carries, when it carries one.
 * @param previousSummary - what the previous run reported, when it is known.
 * @param resumed - whether the run continues the agent's session.
 * @returns the text written to the run's prompt file.
 */
export function runPrompt(
  task: TaskRecord,
  pending: SshPendingInstruction | undefined,
  previousSummary: string | undefined,
  resumed: boolean,
): string {
  if (pending === undefined) return task.prompt
  const heading = pending.kind === 'rework' ? 'Rework instructions for the previous run of this card.' : 'Follow-up for the previous run of this card.'
  if (resumed) return `${heading}\n\n${pending.text}`
  const previous = previousSummary === undefined || previousSummary === ''
    ? 'The previous run reported no summary.'
    : `The previous run reported:\n${previousSummary}`
  return [
    heading,
    'The agent cannot be resumed in its earlier session, so this is a fresh run that carries what the previous run reported.',
    previous,
    'Instruction:',
    pending.text,
  ].join('\n\n')
}
