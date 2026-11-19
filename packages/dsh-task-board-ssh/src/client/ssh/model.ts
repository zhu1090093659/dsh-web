/**
 * What a card's SSH payload means, derived as pure functions.
 *
 * Every predicate the card badge and the detail section consult lives here, and
 * none of them reads a clock, issues a request, or allocates more than the
 * record it was handed: the badge renders on every card of every column on
 * every mirror frame, so "cheap" is a property the tests pin rather than an
 * intention. The reader is deliberately lenient — one unreadable field costs
 * that field, never the card's whole account — because the payload arrives from
 * a host half that may be a version ahead of this browser bundle.
 *
 * @module dsh-task-board-ssh/client/ssh/model
 */
import { SSH_INTEGRATION_KEY } from '../../core/ledger.ts'
import { parseSshRunRecord, parseSshTarget } from '../../core/target.ts'
import type {
  SshAgentKind,
  SshExecutionMode,
  SshRunPhase,
  SshRunRecord,
  SshTarget,
  SshValidationIssue,
  SshWorkspaceKind,
} from '../../core/target.ts'
import type { TaskRecord } from '../../core/task-record.ts'

/** The phase a card shows when it has no run at all. */
export type SshCardPhase = 'idle' | SshRunPhase

/** Everything the seats derive from one card. */
export interface SshCardView {
  /** The target the card pins, absent when it pins none. */
  target?: SshTarget
  /** The run currently in flight, when there is one. */
  activeRun?: SshRunRecord
  /** The newest finished run, when the card has run before. */
  lastRun?: SshRunRecord
  /** Phase the card presents: the active run's, else the newest run's, else idle. */
  phase: SshCardPhase
  /** Run the phase belongs to, absent while the card has never run. */
  runId?: string
}

/** Versions of the stored payload this reader understands. */
const READABLE_PAYLOAD_VERSIONS: readonly number[] = [1]

/** Whether a value is a plain object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One card with nothing pinned. */
const NO_VIEW: SshCardView = { phase: 'idle' }

/**
 * Read a card's SSH payload leniently.
 *
 * The container is accepted at a version this reader knows; a payload stamped
 * with a version it does not know is refused whole, exactly as the ledger's own
 * parser refuses it, because guessing at a future shape is worse than showing
 * an untargeted card. Inside a readable container each record is parsed on its
 * own, so one corrupt run never hides the target or the other runs.
 * @param task - card to read.
 * @returns the parsed pieces, or undefined when the card carries no readable payload.
 */
export function readSshLedger(task: TaskRecord): { target?: SshTarget, activeRun?: SshRunRecord, history: SshRunRecord[] } | undefined {
  const raw = task.integrations?.[SSH_INTEGRATION_KEY]
  if (!isPlainObject(raw)) return undefined
  if (typeof raw.version === 'number' && !READABLE_PAYLOAD_VERSIONS.includes(raw.version)) return undefined
  const target = parseSshTarget(raw.target)
  const activeRun = parseSshRunRecord(raw.activeRun)
  const history: SshRunRecord[] = []
  if (Array.isArray(raw.history)) {
    for (const entry of raw.history) {
      const parsed = parseSshRunRecord(entry)
      if (parsed.ok) history.push(parsed.value)
    }
  }
  return {
    ...(target.ok ? { target: target.value } : {}),
    ...(activeRun.ok ? { activeRun: activeRun.value } : {}),
    history,
  }
}

/**
 * Derive everything the card badge and the detail section show.
 *
 * Pure and allocation-light by contract: at most one record copy from the
 * lenient reader, no request, no clock.
 * @param task - card to derive.
 * @returns the view; {@link NO_VIEW} when the card pins nothing.
 */
export function sshCardView(task: TaskRecord): SshCardView {
  const ledger = readSshLedger(task)
  if (ledger === undefined) return NO_VIEW
  const lastRun = ledger.history.length > 0 ? ledger.history[ledger.history.length - 1] : undefined
  const from = ledger.activeRun ?? lastRun
  const view: SshCardView = { phase: from?.phase ?? 'idle' }
  if (ledger.target !== undefined) view.target = ledger.target
  if (ledger.activeRun !== undefined) view.activeRun = ledger.activeRun
  if (lastRun !== undefined) view.lastRun = lastRun
  if (from !== undefined) view.runId = from.runId
  return view
}

/**
 * Whether a card pins a target at all.
 * @param task - card to test.
 * @returns true when the card's payload carries a readable target.
 */
export function isSshTargeted(task: TaskRecord): boolean {
  return sshCardView(task).target !== undefined
}

/**
 * Whether a phase means a run is under way.
 * @param phase - phase to test.
 * @returns true for queued and running.
 */
export function isSshRunActive(phase: SshCardPhase): boolean {
  return phase === 'queued' || phase === 'running'
}

/** Every field the target form edits, in tab order. */
export type SshDraftField =
  | 'mode'
  | 'host'
  | 'agent'
  | 'agentCommand'
  | 'agentResumeCommand'
  | 'workspaceKind'
  | 'workspacePath'
  | 'gitSource'
  | 'repositoryUrl'
  | 'baseBranch'
  | 'workspaceId'

/** The target form's whole state, as strings: a form holds text, not a target. */
export interface SshTargetDraft {
  mode: SshExecutionMode
  host: string
  agent: SshAgentKind
  agentCommand: string
  agentResumeCommand: string
  workspaceKind: SshWorkspaceKind
  gitSource: 'url' | 'workspace'
  workspacePath: string
  repositoryUrl: string
  baseBranch: string
  workspaceId: string
}

/** What a save attempt produced: a target, or the field that refused it. */
export interface SshDraftValidation {
  /** The parsed target, present only when nothing was refused. */
  target?: SshTarget
  /** First refusal per field, keyed by the field the form highlights. */
  errors: Partial<Record<SshDraftField, SshValidationIssue>>
  /** Every refusal, in the parser's order. */
  issues: readonly SshValidationIssue[]
}

/**
 * Map one parser path onto the form field that carries it.
 * @param path - dotted path the core parser reported.
 * @returns the field, or undefined for a path the form cannot address.
 */
function fieldOfIssue(path: string): SshDraftField | undefined {
  if (path === 'mode') return 'mode'
  if (path === 'host') return 'host'
  if (path === 'agent' || path === 'agent.kind') return 'agent'
  if (path === 'agent.command') return 'agentCommand'
  if (path === 'agent.resumeCommand') return 'agentResumeCommand'
  if (path === 'workspace' || path === 'workspace.kind') return 'workspaceKind'
  if (path === 'workspace.path') return 'workspacePath'
  if (path === 'workspace.source' || path === 'workspace.source.kind') return 'gitSource'
  if (path === 'workspace.source.url') return 'repositoryUrl'
  if (path === 'workspace.source.base') return 'baseBranch'
  if (path === 'workspace.source.workspaceId') return 'workspaceId'
  return undefined
}

/**
 * Build the wire shape a draft describes, leaving out the fields the chosen
 * mode and workspace kind do not use.
 *
 * Leaving them out is what makes the parser's verdict match what the form
 * showed: a hidden field can neither pass nor fail.
 * @param draft - the form's state.
 * @returns a candidate target for {@link parseSshTarget}.
 */
export function draftToTarget(draft: SshTargetDraft): Record<string, unknown> {
  const agent: Record<string, unknown> = { kind: draft.agent }
  if (draft.agent === 'custom') {
    agent.command = draft.agentCommand
    if (draft.agentResumeCommand.trim() !== '') agent.resumeCommand = draft.agentResumeCommand
  }
  let workspace: Record<string, unknown>
  if (draft.workspaceKind === 'in-place') {
    workspace = { kind: 'in-place', path: draft.workspacePath }
  } else if (draft.gitSource === 'url') {
    const source: Record<string, unknown> = { kind: 'url', url: draft.repositoryUrl }
    if (draft.baseBranch.trim() !== '') source.base = draft.baseBranch
    workspace = { kind: 'git', source }
  } else {
    workspace = { kind: 'git', source: { kind: 'workspace', workspaceId: draft.workspaceId } }
  }
  return { mode: draft.mode, host: draft.host, agent, workspace }
}

/**
 * Validate a draft through the frozen parser, addressing refusals per field.
 * @param draft - the form's state.
 * @param parse - target parser; defaults to the frozen core parser.
 * @returns the target, or the refusals keyed by field.
 */
export function validateDraft(
  draft: SshTargetDraft,
  parse: (value: unknown) => { ok: true, value: SshTarget } | { ok: false, errors: readonly SshValidationIssue[] } = parseSshTarget,
): SshDraftValidation {
  const parsed = parse(draftToTarget(draft))
  if (parsed.ok) return { target: parsed.value, errors: {}, issues: [] }
  const errors: Partial<Record<SshDraftField, SshValidationIssue>> = {}
  for (const issue of parsed.errors) {
    const field = fieldOfIssue(issue.path)
    if (field !== undefined && errors[field] === undefined) errors[field] = issue
  }
  return { errors, issues: parsed.errors }
}

/**
 * Read a card's form state out of its target, filling the rest from defaults.
 * @param target - the pinned target, when the card has one.
 * @param defaults - the published defaults, when the provider publishes any.
 * @returns the draft the form opens with.
 */
export function draftOf(target: SshTarget | undefined, defaults?: { host?: string, mode?: SshExecutionMode, agent?: SshAgentKind, workspace?: SshWorkspaceKind }): SshTargetDraft {
  const draft: SshTargetDraft = {
    mode: defaults?.mode ?? 'direct',
    host: defaults?.host ?? '',
    agent: defaults?.agent ?? 'dsh',
    agentCommand: '',
    agentResumeCommand: '',
    workspaceKind: defaults?.workspace ?? 'in-place',
    gitSource: 'url',
    workspacePath: '',
    repositoryUrl: '',
    baseBranch: '',
    workspaceId: '',
  }
  if (target === undefined) return draft
  draft.mode = target.mode
  draft.host = target.host
  draft.agent = target.agent.kind
  if (target.agent.command !== undefined) draft.agentCommand = target.agent.command
  if (target.agent.resumeCommand !== undefined) draft.agentResumeCommand = target.agent.resumeCommand
  draft.workspaceKind = target.workspace.kind
  if (target.workspace.kind === 'in-place') {
    draft.workspacePath = target.workspace.path
    return draft
  }
  if (target.workspace.source.kind === 'url') {
    draft.gitSource = 'url'
    draft.repositoryUrl = target.workspace.source.url
    draft.baseBranch = target.workspace.source.base ?? ''
    return draft
  }
  draft.gitSource = 'workspace'
  draft.workspaceId = target.workspace.source.workspaceId
  return draft
}

/**
 * One line describing a pinned target, for the detail summary.
 *
 * The host, the agent and the workspace are three facts of one sentence, so
 * they stay three template values rather than three labelled rows.
 * @param target - the pinned target.
 * @returns the pieces the caller interpolates.
 */
export function targetSummaryParts(target: SshTarget): { host: string, agent: SshAgentKind, workspace: string } {
  const workspace = target.workspace.kind === 'in-place'
    ? target.workspace.path
    : target.workspace.source.kind === 'url'
      ? target.workspace.source.url
      : target.workspace.source.workspaceId
  return { host: target.host, agent: target.agent.kind, workspace }
}
