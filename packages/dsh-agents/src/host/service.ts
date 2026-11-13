/**
 * The squad service: CRUD over team/member definitions, the single-member run,
 * and the whole-squad run that opens the Lead session, all over the one Host
 * ledger.
 *
 * Three invariants own this file:
 * - Definitions are the ledger's. Ids are minted here, timestamps are stamped
 *   here, and a draft never reaches disk unchecked.
 * - A run fails closed BEFORE a session exists whenever its definition cannot be
 *   honoured (unusable model pin, unknown preset, or a pinned workspace this
 *   deployment cannot resolve), and every failure AFTER a session exists is
 *   recorded on a run record, so no session this plugin created can be invisible
 *   to the user. A squad that pins no workspace at all is not a refusal: its
 *   session is created without a workspace id, in the Host's own default
 *   directory, because the registry this Host serves is the user's choice and an
 *   unpinned squad simply made none.
 * - A squad run record is written BEFORE the Lead's first message is queued: the
 *   Lead's own assembly reads that record to learn which squad it leads, and the
 *   Team-mode hook reads the same record to switch the native task board on for
 *   that one session.
 *
 * @module @linxin666/dsh-agents/host/service
 */
import { join } from 'node:path'
import { AgentsError, isAgentsError } from '../core/errors.ts'
import { applyMemberDraft, applyTeamDraft, createMember, createTeam, findMember, findTeam, sortTeams, touchTeam } from '../core/definition.ts'
import { parseModelPin } from '../core/model-pin.ts'
import { AgentsLedger, AGENTS_LEDGER_FILE, AGENTS_LEDGER_LOCK_FILE, RUN_HISTORY_LIMIT, type AgentsLedgerData } from './ledger.ts'
import { agentsHomeDirectory } from './home.ts'
import { DescribeError, type SquadDescriber } from './describe.ts'
import { listOfferedModelCatalog, preferredModelRoute } from './model-catalog.ts'
import { listOfferedPresets, listOfferedWorkspaces, resolvePinnedPreset, type MemberRunGateway, type WorkspaceRegistryFace } from './run-gateway.ts'
import { squadContextText, squadRunFor } from './squad.ts'
import type {
  AgentsStateView,
  DescribeRequestBody,
  MemberDefinition,
  MemberDraft,
  RunRecord,
  RunRequestBody,
  SquadRunRequestBody,
  TeamDefinition,
  TeamDraft,
} from '../protocol.ts'

/** Construction options. */
export interface AgentsHostServiceOptions {
  /** Plugin-owned directory; defaults to `$DSH_HOME/dsh-agents`. */
  dir?: string
  /** The host run gateway. */
  gateway: MemberRunGateway
  /**
   * The host workspace registry, resolved per call rather than captured here.
   * The Host's registry is an async service that activates after this row
   * applies, so a face read once at construction would stay undefined and the
   * panel would never be offered a workspace to pin.
   */
  workspaces?: () => WorkspaceRegistryFace | undefined
  /**
   * Called with the squad run record once it is durable and before the Lead's
   * first message is queued.
   *
   * This is the only moment a Lead can be switched into Team mode: the Host
   * announces `agent/created` INSIDE session creation, which happens before the
   * run record exists, so an announce-time check can never see this run.
   */
  onSquadRun?: (run: RunRecord) => void
  /**
   * Writes one squad description with a model. Absent when this deployment
   * serves no model service, and the description route then answers
   * `describe-unavailable` instead of silently returning nothing.
   */
  describer?: SquadDescriber
  /** Clock seam. */
  now?: () => number
  /** Id minting seam. */
  idFactory?: () => string
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The Host service behind the routes and the member-brief section.
 *
 * A corrupt or foreign-owned ledger is not an exception the caller has to
 * unwrap: the service keeps the failure and refuses every operation with it, so
 * the browser receives `ledger-corrupt` and the bytes on disk stay untouched.
 */
export class AgentsHostService {
  private readonly gateway: MemberRunGateway
  private readonly workspaces: (() => WorkspaceRegistryFace | undefined) | undefined
  private readonly onSquadRun: ((run: RunRecord) => void) | undefined
  private readonly describer: SquadDescriber | undefined
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly directory: string
  private readonly ledger: AgentsLedger | undefined
  private readonly failure: Error | undefined

  constructor(options: AgentsHostServiceOptions) {
    this.gateway = options.gateway
    this.workspaces = options.workspaces
    this.onSquadRun = options.onSquadRun
    this.describer = options.describer
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID())
    this.directory = options.dir ?? agentsHomeDirectory()
    try {
      this.ledger = AgentsLedger.open({ dir: this.directory, now: this.now })
    } catch (error) {
      this.ledger = undefined
      this.failure = isAgentsError(error) ? error : new AgentsError('ledger-corrupt', describe(error))
    }
  }

  /** Absolute path of the ledger document this service owns. */
  get ledgerFile(): string {
    return this.ledger?.file ?? join(this.directory, AGENTS_LEDGER_FILE)
  }

  /** Absolute path of the owner lock. */
  get lockFile(): string {
    return this.ledger?.lockFile ?? join(this.directory, AGENTS_LEDGER_LOCK_FILE)
  }

  /** Pid that owns the ledger, or this process when the ledger never opened. */
  get ownerPid(): number {
    return this.ledger?.ownerPid ?? process.pid
  }

  /**
   * The ledger snapshot alone: definitions, run history and the owning pid.
   * @returns teams in served order, runs newest first, and the owning pid.
   */
  get state(): AgentsStateView {
    const data = this.requireLedger().snapshot()
    return { teams: sortTeams(data.teams), runs: data.runs, host: { ownerPid: this.ownerPid } }
  }

  /**
   * The whole `GET /state` body: the ledger snapshot, the agent presets this
   * deployment serves, and the model catalog its own gateway publishes.
   *
   * The preset list comes from the same registry read every preset pin resolves
   * through, and the catalog from the same face a run's model pin is applied
   * through, so a picker can never offer an id or a route a run would then
   * refuse. Each field is OMITTED rather than emptied when this deployment has
   * nothing to offer — no readable registry, no readable catalog, or nothing
   * usable inside one — because an empty list reads as "none exist here", which
   * the panel would then repeat as fact.
   * @returns the served state view; `presets`, `models` and `efforts` are present
   *   only when the host really serves something to offer.
   */
  async stateView(): Promise<AgentsStateView> {
    const state = this.state
    const presets = await listOfferedPresets(this.gateway)
    const catalog = await listOfferedModelCatalog(this.gateway)
    const workspaces = listOfferedWorkspaces(this.workspaces?.())
    return {
      ...state,
      ...(presets === undefined ? {} : { presets }),
      ...(workspaces === undefined ? {} : { workspaces }),
      ...(catalog === undefined ? {} : { models: catalog.models }),
      ...(catalog === undefined || catalog.efforts.length === 0 ? {} : { efforts: catalog.efforts }),
    }
  }

  /**
   * Draft one squad description with this deployment's model.
   *
   * The route is the catalog's own default, or the first route it offers: a
   * description is a convenience, so it spends the model this Host already
   * composes sessions from instead of introducing a second setting that can
   * disagree with it. Every refusal is a typed code the page explains, and the
   * definition is never touched here — the panel decides what to do with the
   * text it gets back.
   * @param request - the squad name and the user's rough intent.
   * @param signal - cancellation from the caller's own request.
   * @returns one bounded description.
   */
  async describe(request: DescribeRequestBody, signal?: AbortSignal): Promise<string> {
    if (this.describer === undefined) {
      throw new AgentsError('describe-unavailable', 'this deployment serves no model service, so no description can be written')
    }
    const route = preferredModelRoute(await listOfferedModelCatalog(this.gateway))
    if (route === undefined) {
      throw new AgentsError('describe-unavailable', 'this deployment publishes no model route, so no description can be written')
    }
    try {
      return await this.describer({ name: request.name, ...(request.intent === undefined ? {} : { intent: request.intent }) }, route, signal)
    } catch (error) {
      // A deployment that serves no model service is the same statement as one
      // that publishes no route: nothing here can write a description.
      if (error instanceof DescribeError && error.code === 'no-model') {
        throw new AgentsError('describe-unavailable', 'this deployment serves no model service, so no description can be written')
      }
      throw new AgentsError('describe-failed', describe(error))
    }
  }

  /**
   * The definition view the member-brief section reads at assemble time.
   * @returns the raw ledger snapshot, or an empty view while the ledger is
   *   unusable — an unreadable ledger must not fail a user's ordinary turn.
   */
  promptView(): AgentsLedgerData {
    if (this.ledger === undefined) return { teams: [], runs: [] }
    return this.ledger.snapshot()
  }

  /**
   * Create a team, or replace the editable fields of the one its draft names.
   * @param draft - validated draft.
   * @returns the created or replaced team.
   */
  saveTeam(draft: TeamDraft): TeamDefinition {
    const ledger = this.requireLedger()
    if (draft.id === undefined) {
      const team = createTeam(draft, this.now(), this.idFactory())
      ledger.mutate((document) => { document.teams.push(team) })
      return team
    }
    const teamId = draft.id
    const current = findTeam(ledger.snapshot().teams, teamId)
    if (current === undefined) throw new AgentsError('team-not-found', 'no team has the id "' + teamId + '"')
    const next = applyTeamDraft(current, draft, this.now())
    ledger.mutate((document) => {
      document.teams = document.teams.map(candidate => candidate.id === teamId ? next : candidate)
    })
    return next
  }

  /**
   * Delete a team with every member definition it holds. Run records stay: they
   * are the history of sessions this Host opened, not part of the definition.
   * @param teamId - the team to delete.
   */
  deleteTeam(teamId: string): void {
    const ledger = this.requireLedger()
    if (findTeam(ledger.snapshot().teams, teamId) === undefined) {
      throw new AgentsError('team-not-found', 'no team has the id "' + teamId + '"')
    }
    ledger.mutate((document) => {
      document.teams = document.teams.filter(candidate => candidate.id !== teamId)
    })
  }

  /**
   * Create a member in a team, or replace the editable fields of the member its
   * draft names. The request's teamId and the draft's id must both resolve inside
   * that one team, so an edit can never move a member to another squad.
   * @param teamId - the team the member belongs to.
   * @param draft - validated draft.
   * @returns the team after the change.
   */
  saveMember(teamId: string, draft: MemberDraft): TeamDefinition {
    const ledger = this.requireLedger()
    const team = findTeam(ledger.snapshot().teams, teamId)
    if (team === undefined) throw new AgentsError('team-not-found', 'no team has the id "' + teamId + '"')
    const now = this.now()
    let next: TeamDefinition
    if (draft.id === undefined) {
      const member = createMember(draft, teamId, now, this.idFactory())
      next = touchTeam({ ...team, members: [...team.members, member] }, now)
    } else {
      const memberId = draft.id
      const current = findMember(team, memberId)
      if (current === undefined) {
        throw new AgentsError('member-not-found', 'no member has the id "' + memberId + '" in team "' + teamId + '"')
      }
      const replaced = applyMemberDraft(current, draft, now)
      next = touchTeam({ ...team, members: team.members.map(candidate => candidate.id === memberId ? replaced : candidate) }, now)
    }
    ledger.mutate((document) => {
      document.teams = document.teams.map(candidate => candidate.id === teamId ? next : candidate)
    })
    return next
  }

  /**
   * Delete one member definition.
   * @param teamId - the team the member belongs to.
   * @param memberId - the member to delete.
   * @returns the team after the change.
   */
  deleteMember(teamId: string, memberId: string): TeamDefinition {
    const ledger = this.requireLedger()
    const team = findTeam(ledger.snapshot().teams, teamId)
    if (team === undefined) throw new AgentsError('team-not-found', 'no team has the id "' + teamId + '"')
    if (findMember(team, memberId) === undefined) {
      throw new AgentsError('member-not-found', 'no member has the id "' + memberId + '" in team "' + teamId + '"')
    }
    const now = this.now()
    const next = touchTeam({ ...team, members: team.members.filter(candidate => candidate.id !== memberId) }, now)
    ledger.mutate((document) => {
      document.teams = document.teams.map(candidate => candidate.id === teamId ? next : candidate)
    })
    return next
  }

  /**
   * Launch one member session.
   *
   * Order is the contract: every definition check happens before a session
   * exists, so a rejected run costs no quota; once the session exists, any later
   * failure is recorded on the run and rethrown as a named error.
   * @param request - the validated run body.
   * @returns the run record of the launched session.
   */
  async run(request: RunRequestBody): Promise<RunRecord> {
    const ledger = this.requireLedger()
    const data = ledger.snapshot()
    const team = findTeam(data.teams, request.teamId)
    if (team === undefined) throw new AgentsError('team-not-found', 'no team has the id "' + request.teamId + '"')
    const member = findMember(team, request.memberId)
    if (member === undefined) {
      throw new AgentsError('member-not-found', 'no member has the id "' + request.memberId + '" in team "' + request.teamId + '"')
    }

    const workspaceId = this.resolveWorkspacePin(team)

    // A pin the Host cannot honour is refused before any session exists; a
    // half-parsed route would otherwise select a model the user never chose.
    const route = parseModelPin(member.model)
    if (member.model !== undefined && route === undefined) {
      throw new AgentsError('model-pin-invalid', 'member "' + member.name + '" pins the model "' + member.model + '" which is not a usable route')
    }
    const agentPreset = await resolvePinnedPreset(this.gateway, member.preset)

    let sessionId: string
    try {
      sessionId = (await this.gateway.createSession({ ...(workspaceId === undefined ? {} : { workspaceId }), ...(agentPreset === undefined ? {} : { agentPreset }) })).sessionId
    } catch (error) {
      throw new AgentsError('session-create-failed', 'the host refused to create the member session: ' + describe(error))
    }

    const title = team.name + ' / ' + member.name
    try {
      await this.gateway.renameSession(sessionId, title)
    } catch (error) {
      throw this.failRun(team, member, sessionId, 'session-rename-failed', 'the session could not be renamed to "' + title + '": ' + describe(error))
    }
    try {
      if (member.permission !== undefined) await this.gateway.applyPermission(sessionId, member.permission)
      if (route !== undefined) await this.gateway.selectModel(sessionId, route, member.reasoningEffort)
    } catch (error) {
      throw this.failRun(team, member, sessionId, 'session-pin-failed', 'the session refused the pinned permission or model: ' + describe(error))
    }
    if (request.firstMessage !== undefined) {
      try {
        await this.gateway.prompt({ sessionId, text: request.firstMessage })
      } catch (error) {
        throw this.failRun(team, member, sessionId, 'session-prompt-failed', 'the first message could not be queued: ' + describe(error))
      }
    }
    return this.recordRun(team, member, sessionId, 'running')
  }

  /** Release the owner lock. Idempotent. */
  dispose(): void {
    this.ledger?.dispose()
  }

  /**
   * Resolve the team's pinned workspace for any run.
   *
   * An unpinned squad is not a refusal: the run is created without a workspace id
   * and the Host composes the session in its own default directory. A pin that IS
   * set still fails closed when this deployment cannot validate it, so a run
   * never lands in a directory other than the one the user chose.
   * @param team - the team about to run.
   * @returns the validated workspace id, or undefined when the team pins none.
   * @throws AgentsError `workspace-unavailable` when this deployment serves no
   *   registry, or `workspace-unknown` when it does not serve the pinned id.
   */
  private resolveWorkspacePin(team: TeamDefinition): string | undefined {
    const workspaceId = team.workspaceId
    if (workspaceId === undefined) return undefined
    const registry = this.workspaces?.()
    if (registry === undefined) {
      throw new AgentsError('workspace-unavailable', 'this deployment serves no workspace registry, so the pinned workspace cannot be validated')
    }
    if (!registry.list().some(workspace => workspace.id === workspaceId)) {
      throw new AgentsError('workspace-unknown', 'the host workspace registry has no workspace "' + workspaceId + '"')
    }
    return workspaceId
  }

  /**
   * Whether one live session leads a squad run this Host started.
   *
   * The native Team service switches collaboration on per ROOT session, so only
   * the Lead answers true here; a teammate is a subagent the Lead started.
   * @param sessionId - the session's own id.
   * @returns whether this session is the Lead of a recorded squad run.
   */
  leadsSquadRun(sessionId: string | undefined): boolean {
    return squadRunFor(sessionId, this.promptView()) !== undefined
  }

  /**
   * The `team:squad` system-prompt context text for one assembly.
   * @param sessionId - the assembling session id.
   * @returns the Lead's roster and goal, or '' for every other session.
   */
  squadContext(sessionId: string | undefined): string {
    return squadContextText(sessionId, this.promptView())
  }

  /**
   * Launch the Lead session of one whole squad.
   *
   * The Lead is composed exactly like a member session (resolved workspace pin,
   * optional pinned preset, title, first message). The difference is ordering:
   * the squad run record is written BEFORE the first message is queued, because
   * the Lead's first assembly reads it to learn which squad it leads, and the
   * Team-mode hook reads the same record to switch the native task board on.
   * @param request - the validated squad run body.
   * @returns the squad run record of the launched Lead session.
   */
  async runSquad(request: SquadRunRequestBody): Promise<RunRecord> {
    const ledger = this.requireLedger()
    const team = findTeam(ledger.snapshot().teams, request.teamId)
    if (team === undefined) throw new AgentsError('team-not-found', 'no team has the id "' + request.teamId + '"')
    const workspaceId = this.resolveWorkspacePin(team)
    const agentPreset = await resolvePinnedPreset(this.gateway, team.leadPreset)

    let sessionId: string
    try {
      sessionId = (await this.gateway.createSession({ ...(workspaceId === undefined ? {} : { workspaceId }), ...agentPreset === undefined ? {} : { agentPreset } })).sessionId
    } catch (error) {
      throw new AgentsError('session-create-failed', 'the host refused to create the squad Lead session: ' + describe(error))
    }

    const title = team.name + ' / Lead'
    try {
      await this.gateway.renameSession(sessionId, title)
    } catch (error) {
      const failure = 'the session could not be renamed to "' + title + '": ' + describe(error)
      this.recordSquadRun(team, sessionId, request.goal, 'failed', failure)
      throw new AgentsError('session-rename-failed', failure)
    }

    const run = this.recordSquadRun(team, sessionId, request.goal, 'running')
    this.onSquadRun?.(run)

    if (request.firstMessage !== undefined) {
      try {
        await this.gateway.prompt({ sessionId, text: request.firstMessage })
      } catch (error) {
        const failure = 'the first message could not be queued: ' + describe(error)
        this.settleRun(run.id, 'failed', failure)
        throw new AgentsError('session-prompt-failed', failure)
      }
    }
    return run
  }

  /** Append one squad run record; it carries no member, because it leads the whole team. */
  private recordSquadRun(
    team: TeamDefinition,
    sessionId: string,
    goal: string | undefined,
    status: RunRecord['status'],
    failure?: string,
  ): RunRecord {
    const run: RunRecord = {
      id: this.idFactory(),
      teamId: team.id,
      sessionId,
      createdAt: this.now(),
      status,
      kind: 'squad',
      ...goal === undefined ? {} : { goal },
      ...failure === undefined ? {} : { failure },
    }
    this.requireLedger().mutate((document) => {
      document.runs = [run, ...document.runs].slice(0, RUN_HISTORY_LIMIT)
    })
    return run
  }

  /** Settle one already-recorded run in place, keeping its place in the history. */
  private settleRun(runId: string, status: RunRecord['status'], failure?: string): void {
    this.requireLedger().mutate((document) => {
      document.runs = document.runs.map(run => run.id === runId
        ? { ...run, status, ...failure === undefined ? {} : { failure } }
        : run)
    })
  }

  /**
   * Append a failed run record for a session that exists, and return the error to
   * throw. A session this Host opened is never left without its record.
   */
  private failRun(team: TeamDefinition, member: MemberDefinition, sessionId: string, code: 'session-rename-failed' | 'session-pin-failed' | 'session-prompt-failed', message: string): AgentsError {
    this.recordRun(team, member, sessionId, 'failed', message)
    return new AgentsError(code, message)
  }

  private recordRun(team: TeamDefinition, member: MemberDefinition, sessionId: string, status: RunRecord['status'], failure?: string): RunRecord {
    const run: RunRecord = {
      id: this.idFactory(),
      teamId: team.id,
      memberId: member.id,
      sessionId,
      createdAt: this.now(),
      status,
      ...(failure === undefined ? {} : { failure }),
    }
    this.requireLedger().mutate((document) => {
      document.runs = [run, ...document.runs].slice(0, RUN_HISTORY_LIMIT)
    })
    return run
  }

  private requireLedger(): AgentsLedger {
    if (this.ledger !== undefined) return this.ledger
    const failure = this.failure
    if (failure instanceof AgentsError) throw failure
    throw new AgentsError('ledger-corrupt', failure === undefined ? 'the dsh-agents ledger is unavailable' : describe(failure))
  }
}
