/**
 * The squad-run seam: which sessions belong to a whole-squad run this Host
 * started, and what the Lead is told about the squad it leads.
 *
 * The native Agent Teams runtime owns collaboration: its task board is the plan,
 * its policy section is the rule, and its members are ordinary subagents. This
 * file therefore owns exactly two facts:
 * - Which live Session leads a squad run this Host launched, so that session's
 *   Team mode is switched on and no other session is touched.
 * - What the Lead must know about its members BEFORE it spawns anything: each
 *   member's name, preset, model route and brief. It arrives as a system-prompt
 *   CONTEXT, not a section: a preset that registers a `complete` section drops
 *   every untagged section (docs/member-prompt.md), and contexts survive it.
 *
 * @module @linxin666/dsh-agents/host/squad
 */
import type { RunRecord, TeamDefinition } from '../protocol.ts'

/** A squad run and the definition it launched. */
export interface SquadRunView {
  readonly run: RunRecord
  readonly team: TeamDefinition
}

/** The ledger facts these decisions read. */
export interface SquadLedgerView {
  readonly teams: readonly TeamDefinition[]
  readonly runs: readonly RunRecord[]
}

/**
 * The newest squad run recorded for one session.
 * @param sessionId - the session to look up.
 * @param view - the ledger snapshot.
 * @returns the squad run and its team, or undefined when this session leads none.
 */
export function squadRunFor(sessionId: string | undefined, view: SquadLedgerView): SquadRunView | undefined {
  if (sessionId === undefined) return undefined
  let newest: RunRecord | undefined
  for (const run of view.runs) {
    if (run.kind !== 'squad' || run.sessionId !== sessionId) continue
    if (newest === undefined || run.createdAt > newest.createdAt) newest = run
  }
  if (newest === undefined) return undefined
  const team = view.teams.find(candidate => candidate.id === newest.teamId)
  return team === undefined ? undefined : { run: newest, team }
}

/**
 * One member's brief, flattened to a single line.
 *
 * The whole brief travels, not a summary: the Lead opens its spawn prompt with
 * this text verbatim, so a truncated brief is a member that never learns its own
 * operating instructions.
 * @param brief - the member's brief, when it has one.
 * @returns the collapsed brief, or a placeholder for a member without one.
 */
export function briefText(brief: string | undefined): string {
  const single = (brief ?? '').replace(/\s+/gu, ' ').trim()
  return single === '' ? 'none; state the task in the spawn prompt' : single
}

/**
 * The `team:squad` system-prompt context text for one assembly.
 *
 * The Lead must know who exists and what each member runs as BEFORE it spawns
 * anything: a member preset with a `complete` section drops untagged sections,
 * so the roster cannot ride a section and cannot ride the member briefs either
 * (those are the Lead's own spawn prompts).
 * @param sessionId - the assembling session id.
 * @param view - the ledger snapshot.
 * @returns the roster and goal for a squad Lead, or '' for every other session.
 */
export function squadContextText(sessionId: string | undefined, view: SquadLedgerView): string {
  const squad = squadRunFor(sessionId, view)
  if (squad === undefined) return ''
  const { run, team } = squad
  const lines = [
    'You lead the agent squad "' + team.name + '".',
    run.goal === undefined
      ? 'Squad goal: not stated yet; ask the user what the squad must achieve before splitting the work.'
      : 'Squad goal: ' + run.goal,
    'This run asks the Host to switch Team mode on for this session. When it did, the shared task board (team_task_create, team_task_list, team_task_get, team_task_update) and the team collaboration policy are available to you and to every teammate you start, and the board is the plan: a step that is not on it does not exist. If this session has no team_task_* tool, the switch did not happen — say so and plan without a board instead of inventing one.',
    '',
    'Members (' + String(team.members.length) + '):',
  ]
  for (const member of team.members) {
    lines.push('- ' + member.name
      + ' | preset ' + (member.preset ?? 'deployment default')
      + ' | permission ' + (member.permission ?? 'deployment default') + ', inherited from you: a teammate always runs with its parent session permission'
      + ' | model ' + (member.model ?? 'deployment default')
      + ' | brief: ' + briefText(member.brief))
  }
  lines.push(
    '',
    'Start each member with the subagent tool:',
    '- description: the member name exactly as listed above; it becomes that teammate label.',
    '- agent_preset: the member preset id. Like the model parameters it appears only when this deployment offers a selectable preset list; when it is missing, say in your reply which pin this deployment cannot honour instead of dropping it silently.',
    '- provider, model and reasoning_effort: the member model pin. A session that offers no subagent model selection does not show these parameters; when one is missing, say in your reply which pin this deployment cannot honour instead of dropping it silently.',
    '- prompt: begin with that member brief verbatim, then the concrete task. A teammate system prompt belongs to its preset, so the brief travels in this first message.',
    'Put one task per work item on the board, use blockedBy for dependencies, and let each teammate claim and finish its own task. Steer a running teammate with send_message and collect it with wait_agent.',
  )
  return lines.join('\n')
}
