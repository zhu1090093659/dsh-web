/**
 * The provider's hub synchronization: registration, heartbeat, claiming, leases
 * and write-back.
 *
 * The division of authority runs through every method here. The hub decides
 * which issues exist, who owns them and what collaboration status they carry;
 * this Host decides whether it may take one, how it runs it locally and what the
 * run produced. A claim is the only moment the two meet: the hub hands over a
 * lease and an attempt id, this Host materializes the issue as a board card and
 * reports back when that card's execution settles.
 *
 * Reconnection is the interesting path, so it is written as one: the attempt
 * credentials live on the card's own payload, and a re-claim presents them. A
 * hub that recognizes them re-establishes the lease and creates nothing new, and
 * this Host in turn never creates a second card for an issue it already mirrors
 * and never starts a second execution for an attempt it already ran.
 *
 * @module dsh-task-board-team/host/service
 */
import {
  type HubAgentDefinition,
  type HubClaim,
  type HubComment,
  type HubIssue,
  type HubIssueStatus,
  HOST_CLIENT_VERSION,
  LEASE_RENEW_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  SWEEP_INTERVAL_MS,
  readServerFrame,
  type HubServerFrame,
} from '../core/hub-protocol.ts'
import type { TaskBoardExtensionHost, TaskBoardCapabilities, TaskBoardLinkedTask } from '../core/contract.ts'
import {
  findLinkedTask,
  readTaskIssueLink,
  readTeamIssueLink,
  toPayload,
  type TeamIssueLink,
} from '../core/identity.ts'
import { buildMirrorDraft, type MirrorAgent } from '../core/mirror.ts'
import { buildSettleRequest, type SettleRequestBody } from '../core/settlement.ts'
import type { TaskRecord } from '../core/task-record.ts'
import type { HostTimerFace } from '../core/timers.ts'
import type { BoundAgent, TeamAgentBinding } from './bindings.ts'
import { HubError, type HubClient } from './hub-client.ts'
import { QuestionRouter, type PendingQuestionView } from './questions.ts'
import type { SocketHandlers, SocketLike } from './channel.ts'

/** Live settings of one mount, read at use time. */
export interface TeamRuntimeSettings {
  /** Whether this extension is switched on. */
  enabled: boolean
  /** Hostname this Host registers under. */
  hostname: string
  /** Configured member bindings. */
  bindings: readonly TeamAgentBinding[]
  /** Workspace this mount runs its cards in; empty falls back to the member's team. */
  workspaceId?: string
  /** Optional local fallback wait for a claimed question, in minutes; 0 means none. */
  questionWaitMinutes?: number
}

/** One comment, as the browser renders it. */
export interface TeamCommentView {
  id: string
  author: string
  content: string
  createdAt: number
}

/** One activity entry, as the browser renders it. */
export interface TeamActivityView {
  id: string
  type: string
  text: string
  createdAt: number
}

/** The collaboration half of one mirrored card. */
export interface TeamCardView {
  issueId: string
  issueNumber?: number
  hubStatus?: HubIssueStatus
  assignee?: string
  reviewer?: string
  /** Member id behind `assignee`, when the hub named one. */
  assigneeMemberId?: string
  /** Member id behind `reviewer`, when the hub named one. */
  reviewerMemberId?: string
  agentName?: string
  comments: TeamCommentView[]
  activity: TeamActivityView[]
  lastError?: string
}

/** How the row's connection to the hub currently stands. */
export type TeamConnectionState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'error'

/** The summary this extension publishes into the board snapshot. */
export interface TeamExtensionSummary {
  connection: {
    state: TeamConnectionState
    hostId?: string
    lastHeartbeatAt?: number
    reconnects: number
    lastError?: string
  }
  capabilities: TaskBoardCapabilities
  agents: Array<{ memberId: string; name: string; preset?: string; hubAgentId?: string }>
  problems: string[]
  /**
   * Whether this board pins a draft preset, model and effort when it creates a
   * card.
   *
   * `unknown` until the first mirror card proves it either way: the verdict comes
   * from reading the created card back, because a board revision without the
   * draft targets drops them silently.
   */
  presetPin: 'unknown' | 'supported' | 'missing'
  cards: Record<string, TeamCardView>
  pendingQuestions: PendingQuestionView[]
  /**
   * Non-secret configuration, added by the mounting row rather than by the
   * service: the settings block renders the configured hub, team and bindings
   * from the same document it reads everything else from.
   */
  configuration?: {
    hubUrl?: string
    teamId?: string
    hostname?: string
    tokenConfigured?: boolean
    /** Optional local fallback wait for a claimed question, in minutes; 0 means none. */
    questionWaitMinutes?: number
  }
}

/** The problem line published when the board serves no draft preset. */
export const DRAFT_PIN_PROBLEM = 'this board revision cannot pin an agent preset, model or reasoning effort on a new card, so a claimed issue becomes a mirror card that is left for a human to start'

/** The problem line published while this Host has no workspace to run a card in. */
export const WORKSPACE_PROBLEM = 'no run workspace is bound to this Host, so no team issue is claimed: a mirror card without a workspace cannot be started, and the hub would keep its issue running'

/** Longest comment or activity text one summary carries. */
const VIEW_TEXT_LIMIT = 2_000
/** Most comments and activity entries one summary carries per card. */
const VIEW_ENTRY_LIMIT = 20

export interface TeamSyncServiceOptions {
  /** The board's capability face. */
  host: TaskBoardExtensionHost
  /** Hub REST client. */
  hub: HubClient
  /** Live settings. */
  settings: () => TeamRuntimeSettings
  /** Resolve the bound members out of the dsh-agents ledger. */
  resolveAgents: () => Promise<{ agents: BoundAgent[]; problems: string[] }>
  /** Open the team channel; undefined means this deployment cannot. */
  connect: (sinceSeq: number, handlers: SocketHandlers) => Promise<SocketLike | undefined>
  /** Which optional capabilities the board really serves. */
  capabilities: TaskBoardCapabilities
  /** Ask the board to run one card; absent means this Host cannot start executions. */
  requestRun?: (taskId: string) => void
  timers: HostTimerFace
  now: () => number
  uuid: () => string
  log?: (message: string, detail?: unknown) => void
}

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= VIEW_TEXT_LIMIT ? trimmed : trimmed.slice(0, VIEW_TEXT_LIMIT - 3) + '...'
}

/** The synchronization service of one mounted extension. */
export class TeamSyncService {
  readonly #options: TeamSyncServiceOptions
  readonly #questions: QuestionRouter
  readonly #leases = new Map<string, () => void>()
  readonly #cards = new Map<string, TeamCardView>()
  /** Hub agent records by their hub id, learned at registration. */
  readonly #hubAgents = new Map<string, BoundAgent>()
  #agents: BoundAgent[] = []
  #problems: string[] = []
  #hostId: string | undefined
  #seq = 0
  #socket: SocketLike | undefined
  #stopHeartbeat: (() => void) | undefined
  #stopReconnect: (() => void) | undefined
  #started = false
  #connection: TeamConnectionState = 'idle'
  #lastError: string | undefined
  #lastHeartbeatAt: number | undefined
  #reconnects = 0
  #reconnectAttempt = 0
  #starting: Promise<void> | undefined
  #presetPin: 'unknown' | 'supported' | 'missing' = 'unknown'
  /** Instant of the last sweep, so a burst of events coalesces into one pass. */
  #lastSweepAt: number | undefined
  /** A sweep scheduled for the next cadence boundary, while one is pending. */
  #pendingSweep: (() => void) | undefined
  /** Issues with a claim in flight: one claim per issue at a time, whoever asks. */
  readonly #claiming = new Set<string>()
  /** Agent names the hub reported another Host already owns, by name. */
  readonly #agentConflicts = new Map<string, string>()
  /** Issues whose owed settlement the current pass already retried. */
  readonly #settledThisPass = new Set<string>()

  constructor(options: TeamSyncServiceOptions) {
    this.#options = options
    this.#questions = new QuestionRouter({
      hub: options.hub,
      host: options.host,
      linked: () => this.#linked(),
      timers: options.timers,
      now: options.now,
      uuid: options.uuid,
      onChange: () => { this.#publish() },
      fallbackWaitMs: () => {
        const minutes = options.settings().questionWaitMinutes ?? 0
        return minutes > 0 ? minutes * 60_000 : undefined
      },
      ...(options.log === undefined ? {} : { log: options.log }),
    })
  }

  /** Republish the summary, e.g. after a configuration write changed what it shows. */
  publishNow(): void {
    this.#publish()
  }

  /** The question router this service routes the Host waterfall through. */
  get questions(): QuestionRouter {
    return this.#questions
  }

  /** Start registration, heartbeat, the channel and the first claim sweep. */
  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    this.#starting = this.#bootstrap()
    await this.#starting
  }

  /**
   * Resolve once this mount finished registering, or immediately when it has not
   * started at all.
   *
   * A sweep requested before registration completes must wait for the host id
   * instead of silently claiming nothing, which is what a caller racing the
   * bootstrap would otherwise get.
   * @returns a promise resolved when the bootstrap settles.
   */
  async whenStarted(): Promise<void> {
    await this.#starting
  }

  /** Release every timer, the socket and every pending question claim. */
  stop(): void {
    this.#started = false
    this.#stopHeartbeat?.()
    this.#stopHeartbeat = undefined
    this.#stopReconnect?.()
    this.#stopReconnect = undefined
    this.#pendingSweep?.()
    this.#pendingSweep = undefined
    this.#socket?.close()
    this.#socket = undefined
    for (const cancel of this.#leases.values()) cancel()
    this.#leases.clear()
    this.#questions.dispose()
    this.#connection = 'idle'
  }

  /** The summary the browser renders, built fresh from the live state. */
  summary(): TeamExtensionSummary {
    const cards: Record<string, TeamCardView> = {}
    for (const [taskId, view] of this.#cards) cards[taskId] = { ...view }
    for (const entry of this.#linked()) {
      const link = readTaskIssueLink(entry.task)
      if (link === undefined) continue
      const existing = cards[entry.task.id]
      cards[entry.task.id] = {
        issueId: link.issueId,
        ...(link.issueNumber === undefined ? {} : { issueNumber: link.issueNumber }),
        ...(link.hubStatus === undefined ? {} : { hubStatus: link.hubStatus }),
        ...(link.assignee === undefined ? {} : { assignee: link.assignee }),
        ...(link.reviewer === undefined ? {} : { reviewer: link.reviewer }),
        comments: existing?.comments ?? [],
        activity: existing?.activity ?? [],
        ...(link.lastError === undefined ? {} : { lastError: link.lastError }),
        ...(existing?.agentName === undefined ? {} : { agentName: existing.agentName }),
      }
    }
    const agents = this.#agents.map(agent => {
      const hubAgentId = this.#hubAgentIdOf(agent.memberId)
      return {
        memberId: agent.memberId,
        name: agent.name,
        ...(agent.preset === undefined ? {} : { preset: agent.preset }),
        ...(hubAgentId === undefined ? {} : { hubAgentId }),
      }
    })
    return {
      connection: {
        state: this.#connection,
        ...(this.#hostId === undefined ? {} : { hostId: this.#hostId }),
        ...(this.#lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt: this.#lastHeartbeatAt }),
        reconnects: this.#reconnects,
        ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      },
      capabilities: this.#options.capabilities,
      agents,
      problems: [...this.#problems, ...this.#conflictProblems()],
      presetPin: this.#presetPin,
      cards,
      pendingQuestions: [...this.#questions.pending()],
    }
  }

  /**
   * Report one settled execution back to the hub.
   * @param event - the board's settlement notification.
   */
  async handleExecutionSettled(event: {
    taskId: string
    executionId: string
    outcome: 'succeeded' | 'failed' | 'cancelled'
    error?: string
  }): Promise<void> {
    const task = this.#options.host.tasks.get(event.taskId)
    if (task === undefined) return
    const link = readTaskIssueLink(task)
    if (link === undefined) return
    this.#releaseLease(task.id)
    const attemptId = link.attemptId
    if (attemptId === undefined) {
      // Every write-back names the attempt that ran, so the hub can refuse a late
      // one from an earlier round (protocol section 5, review R2). A card that
      // carries no attempt cannot report an outcome at all, and sending one
      // anyway would let it land under whatever attempt the hub holds now.
      this.#recordError(task.id, new Error(
        'this card carries no execution attempt, so its outcome cannot be attributed and was not written back',
      ))
      return
    }
    const body = buildSettleRequest({
      task,
      executionId: event.executionId,
      outcome: event.outcome,
      ...(event.error === undefined ? {} : { error: event.error }),
      attemptId,
    })
    // The write-back is recorded on the card BEFORE it is sent, so a refusal this
    // Host may retry keeps what the run produced instead of dropping it.
    this.#writeLink(task.id, { pendingSettle: body })
    await this.#writeSettlement(task.id, link.issueId, body)
    this.#publish()
  }

  /**
   * Send one recorded settlement and, once the hub takes it, release everything
   * the hub now owns.
   *
   * The attempt and its lease belong to a finished run: settling is the last
   * thing this Host does with them, so a later claim of the same issue is fresh
   * instead of a reconnect that would ask the hub to re-establish a dead attempt.
   * @param taskId - the card the settlement belongs to.
   * @param issueId - the issue it settles.
   * @param body - the settlement body, as the card recorded it.
   */
  async #writeSettlement(taskId: string, issueId: string, body: SettleRequestBody): Promise<void> {
    const attemptId = body.execution_attempt_id
    if (attemptId === undefined) {
      this.#writeLink(taskId, { pendingSettle: undefined })
      this.#recordError(taskId, new Error('a settlement without an execution attempt is never sent to the hub'))
      return
    }
    try {
      const settled = await this.#options.hub.settle(issueId, body)
      this.#writeLink(taskId, {
        pendingSettle: undefined,
        attemptId: undefined,
        leaseToken: undefined,
        hubStatus: readStatus(settled.status),
      })
    } catch (error) {
      if (!isSettlementFinal(error)) {
        // Every refusal that may pass (a network failure, a timeout, a 5xx, a rate
        // limit) leaves the outcome on the card for the next sweep or reconnect to
        // place, and the hub's own gates still decide whether it lands.
        this.#recordError(taskId, error)
        return
      }
      // A final refusal can never be accepted again: the attempt it names is gone
      // or the hub forbids it outright, so a retry would only spend this Host's
      // request budget. The card forgets the write-back.
      const card = this.#options.host.tasks.get(taskId)
      const current = card === undefined ? undefined : readTaskIssueLink(card)
      if (current?.attemptId !== undefined && current.attemptId !== attemptId) {
        // The card has since moved to a newer attempt (a rework or a retry minted
        // one): this settlement belongs to the round that replaced it, so nothing
        // of the current run may be released and the operator sees no error for a
        // result the next run is about to report anyway.
        this.#writeLink(taskId, { pendingSettle: undefined })
        this.#options.log?.('dropped the settlement of a replaced attempt for ' + issueId, error)
        return
      }
      this.#writeLink(taskId, { pendingSettle: undefined, attemptId: undefined, leaseToken: undefined })
      this.#recordError(taskId, new Error(
        'the hub refused this settlement for good (' + describe(error) + '); it was dropped instead of retried, '
        + 'so start the card again to report a new outcome',
      ))
    }
  }

  /**
   * Retry every settlement the hub has not accepted yet.
   *
   * A refusal is not permission to decide the outcome locally: the retry presents
   * the same body and the hub's own gates still decide whether it lands. A
   * settlement an expired attempt made impossible was already dropped by
   * {@link TeamSyncService.#writeSettlement}, so only a retryable refusal is
   * carried into this pass.
   */
  async #retryPendingSettlements(): Promise<void> {
    for (const entry of this.#linked()) {
      const link = readTeamIssueLink(entry.payload)
      const pending = link?.pendingSettle
      if (link === undefined || pending === undefined) continue
      this.#settledThisPass.add(link.issueId)
      await this.#writeSettlement(entry.task.id, link.issueId, pending)
    }
  }

  /**
   * Claim every issue the hub offers this Host, for the agents bound to it.
   * @returns how many issues this pass turned into a new card.
   */
  async sweep(): Promise<number> {
    if (!this.#started) return 0
    await this.whenStarted()
    return await this.#runSweep()
  }

  /**
   * Ask for a sweep, coalesced to at most one pass per cadence window.
   *
   * A burst of channel events (a reviewer rejecting, a status moving, an issue
   * appearing) asks for the same work, and the hub counts Host requests per
   * minute (protocol amendment A4 point 6), so the asks collapse into one pass:
   * the current window's pass or the single pass scheduled at its boundary.
   */
  requestSweep(): void {
    if (!this.#started) return
    if (this.#pendingSweep !== undefined) return
    const now = this.#options.now()
    const last = this.#lastSweepAt
    if (last === undefined || now - last >= SWEEP_INTERVAL_MS) {
      void this.#runSweep()
      return
    }
    this.#pendingSweep = this.#options.timers.timeout(() => {
      this.#pendingSweep = undefined
      void this.#runSweep()
    }, SWEEP_INTERVAL_MS - (now - last))
  }

  /**
   * One claim sweep over what the hub currently offers this Host.
   * @returns how many issues this pass turned into a new card.
   */
  async #runSweep(): Promise<number> {
    if (this.#hostId === undefined) return 0
    this.#lastSweepAt = this.#options.now()
    // A pass first finishes what the last one could not hand over: a settlement
    // the hub refused is retried once, before any new work is claimed.
    this.#settledThisPass.clear()
    await this.#retryPendingSettlements()
    // A card the board cannot start is worse than no card: the claim moves the
    // issue to `running` on the hub, this Host keeps renewing the lease, and
    // nothing ever settles it. The board resolves a card's workspace from the
    // card itself and refuses the run when there is none, so a mount with no
    // workspace for any bound member asks for nothing and says why.
    if (this.#agents.length > 0 && !this.#agents.some(agent => this.#workspaceFor(agent) !== '')) {
      this.#raiseProblem(WORKSPACE_PROBLEM)
      this.#publish()
      return 0
    }
    this.#dropProblem(WORKSPACE_PROBLEM)
    let issues: readonly HubIssue[]
    try {
      issues = await this.#options.hub.listClaimableIssues(this.#hostId)
    } catch (error) {
      this.#lastError = describe(error)
      this.#publish()
      return 0
    }
    let claimed = 0
    for (const issue of issues) {
      // Only an agent bound to THIS machine may be executed here. The hub's own
      // filter is the first gate; this is the second, and it is the one that
      // keeps a wrongly listed issue from being run on the wrong machine.
      const agent = this.#agentFor(issue)
      if (agent === undefined) continue
      // A member with no workspace to run in is skipped for the reason the whole
      // pass above is skipped: its card would be created here and never start.
      if (this.#workspaceFor(agent) === '') continue
      try {
        if (await this.#claimIssue(issue, agent)) claimed += 1
      } catch (error) {
        this.#lastError = describe(error)
        this.#options.log?.('claim failed for ' + issue.id, error)
      }
    }
    this.#publish()
    return claimed
  }

  /** The agents whose hub records were synchronized at registration. */
  boundAgents(): readonly BoundAgent[] {
    return this.#agents
  }

  async #bootstrap(): Promise<void> {
    const resolved = await this.#options.resolveAgents()
    // A member whose definition pins no preset is not registered (protocol
    // amendment A4 point 1): running it would silently fall back to the
    // deployment default, which is exactly what this provider must not do.
    const runnable = resolved.agents.filter(agent => agent.preset !== undefined && agent.preset !== '')
    const skipped = resolved.agents
      .filter(agent => agent.preset === undefined || agent.preset === '')
      .map(agent => agent.name + ' is not registered: its dsh-agents definition pins no agent preset, so this Host '
        + 'would have to run it under the deployment default')
    this.#agents = runnable
    this.#problems = [...resolved.problems, ...skipped]
    if (this.#agents.length === 0) {
      this.#problems = [...this.#problems, 'no dsh-agents member is bound to this Host, so no issue is claimed']
      this.#publish()
      return
    }
    await this.#register()
    if (this.#hostId === undefined) {
      this.#publish()
      return
    }
    this.#startHeartbeat()
    await this.#openChannel()
    await this.#runSweep()
  }

  async #register(): Promise<void> {
    this.#connection = 'connecting'
    const definitions: HubAgentDefinition[] = this.#agents.map(agent => ({
      name: agent.name,
      preset_id: agent.preset ?? '',
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.reasoningEffort === undefined ? {} : { reasoning_effort: agent.reasoningEffort }),
    }))
    try {
      const registered = await this.#options.hub.register({
        hostname: this.#options.settings().hostname,
        client_version: HOST_CLIENT_VERSION,
        agents: definitions,
      })
      this.#hostId = registered.host_id
      this.#connection = 'online'
      this.#lastError = undefined
      this.#hubAgents.clear()
      for (const record of readAgentRecords(registered)) {
        const local = this.#agents.find(agent => agent.name === record.name)
        if (local !== undefined) this.#hubAgents.set(record.id, local)
      }
      // A name another Host already owns is skipped by the hub and reported back
      // (section 5): the member stays unregistered here, claims nothing, and the
      // operator reads why in the summary instead of meeting a card that never
      // runs.
      this.#agentConflicts.clear()
      for (const conflict of readAgentConflicts(registered)) {
        this.#agentConflicts.set(conflict.name, conflict.reason)
      }
    } catch (error) {
      this.#hostId = undefined
      this.#connection = 'error'
      this.#lastError = describe(error)
      this.#options.log?.('host registration failed', error)
    }
    this.#publish()
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat?.()
    const beat = (): void => {
      const hostId = this.#hostId
      if (hostId === undefined) return
      void this.#options.hub.heartbeat(hostId).then(() => {
        this.#lastHeartbeatAt = this.#options.now()
        if (this.#connection === 'reconnecting') this.#connection = 'online'
        this.#publish()
      }).catch((error: unknown) => {
        this.#lastError = describe(error)
        this.#options.log?.('heartbeat failed', error)
        this.#publish()
      })
    }
    this.#stopHeartbeat = this.#options.timers.interval(beat, HEARTBEAT_INTERVAL_MS)
    beat()
  }

  async #openChannel(): Promise<void> {
    this.#stopReconnect?.()
    this.#stopReconnect = undefined
    let socket: SocketLike | undefined
    try {
      socket = await this.#options.connect(this.#seq, {
        message: data => { this.#onFrame(data) },
        closed: reason => { this.#onClosed(reason) },
      })
    } catch (error) {
      this.#options.log?.('team channel could not open', error)
      socket = undefined
    }
    if (socket === undefined) {
      this.#lastError = 'the team channel is unavailable; reconnecting'
      this.#scheduleReconnect()
      this.#publish()
      return
    }
    this.#socket = socket
    this.#connection = 'online'
    this.#reconnectAttempt = 0
    this.#publish()
  }

  #scheduleReconnect(): void {
    this.#stopReconnect?.()
    this.#connection = 'reconnecting'
    this.#reconnects += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.#reconnectAttempt, RECONNECT_MAX_MS)
    this.#reconnectAttempt += 1
    this.#stopReconnect = this.#options.timers.timeout(() => {
      this.#stopReconnect = undefined
      // Re-register first: a hub that restarted has forgotten this Host, and a
      // channel opened before registration would push events for an unknown host.
      void this.#register().then(async () => {
        await this.#openChannel()
        await this.#runSweep()
      }).catch((error: unknown) => {
        this.#options.log?.('reconnect failed', error)
        this.#scheduleReconnect()
      })
    }, delay)
  }

  #onClosed(reason?: string): void {
    if (!this.#started) return
    this.#socket = undefined
    if (reason !== undefined && reason !== '') this.#lastError = reason
    this.#publish()
    this.#scheduleReconnect()
  }

  #onFrame(data: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    const frame = readServerFrame(parsed)
    if (frame === undefined) return
    if (frame.t === 'pong') return
    if (frame.t === 'resync_required') {
      // The channel could not replay what this Host missed, so the only honest
      // recovery is a fresh claim sweep: it re-establishes every issue the hub
      // still offers and leaves the rest on the hub.
      this.#seq = 0
      this.requestSweep()
      return
    }
    this.#onEvent(frame)
  }

  #onEvent(frame: Extract<HubServerFrame, { t: 'event' }>): void {
    // Sequence numbers only move forward; a replayed frame already applied is
    // dropped instead of being applied twice.
    if (frame.seq <= this.#seq && this.#seq !== 0) return
    this.#seq = frame.seq
    const payload = frame.payload
    switch (frame.event) {
      case 'question.answered':
        this.#questions.answered(payload)
        return
      case 'question.expired':
        this.#questions.expired(payload)
        return
      case 'question.withdrawn':
        this.#questions.withdrawn(payload)
        return
      case 'comment.created':
        this.#recordComment(payload)
        return
      case 'comment.mentioned':
        void this.#deliverMention(payload)
        return
      case 'issue.rework':
        void this.#rework(payload)
        return
      case 'issue.status_changed':
        this.#recordStatus(payload)
        return
      case 'issue.created':
      case 'issue.updated':
        this.requestSweep()
        return
      default:
        return
    }
  }

  /**
   * Claim one issue for one bound agent out of a sweep.
   * @returns whether this call created a card.
   */
  async #claimIssue(issue: HubIssue, agent: BoundAgent): Promise<boolean> {
    return await this.#claimExclusively(issue.id, () => this.#claimOnce({ issueId: issue.id, issue, agent }))
  }

  /**
   * Run one claim while no other claim for the same issue is in flight.
   *
   * Protocol amendment A4 point 5 makes claims on one issue strictly single
   * flight, and both paths that claim — a sweep and an `issue.rework` event, which
   * the hub sends back to back with `issue.updated` — enter here: the second
   * caller finds the issue already being claimed and has nothing to do, instead of
   * racing a claim the hub would refuse and recording that refusal as a failure.
   * @param issueId - the issue being claimed.
   * @param claim - the claim to run while the issue is held.
   * @returns whatever the claim answered; false when one is already in flight.
   */
  async #claimExclusively(issueId: string, claim: () => Promise<boolean>): Promise<boolean> {
    if (this.#claiming.has(issueId)) return false
    this.#claiming.add(issueId)
    try {
      return await claim()
    } finally {
      this.#claiming.delete(issueId)
    }
  }

  /**
   * Claim one issue and act on what the claim grants.
   *
   * The card is the one this Host already mirrors, when it mirrors one: a claim
   * never creates a second card for one issue. A card whose run finished but
   * whose outcome the hub has not accepted is never claimed at all: the claim
   * would mint an attempt nothing here executes, and the retry of the old body
   * would then be refused against that attempt, losing what the run produced.
   * Only a pending rework may claim such a card, because the reviewer's
   * rejection IS the newer round.
   *
   * What runs afterwards follows from the claim itself — a pending rework always
   * runs, a reconnect runs nothing, and a card with nothing running here is
   * started again (a human retry moved the issue back to `assigned`, and nothing
   * else would ever start that card).
   * @param input - the issue, the agent it belongs to, and any rework the caller knows.
   * @returns whether this call created a card.
   */
  async #claimOnce(input: {
    issueId: string
    /** The issue a sweep listed; absent when the caller only knows it by id. */
    issue?: HubIssue
    /** The agent to claim for; needed only when the issue has no card here yet. */
    agent?: BoundAgent
    /** Rework instructions the caller already knows; a sweep reads them off the issue. */
    rework?: string
  }): Promise<boolean> {
    const existing = findLinkedTask(this.#linked(), input.issueId)
    const previous = existing === undefined ? undefined : readTaskIssueLink(existing)
    const agent = input.agent
    const issue = input.issue
    // A caller that knows neither a mirrored card nor the issue behind one has
    // nothing the claim could act on, so nothing is asked of the hub.
    if (existing === undefined && (agent === undefined || issue === undefined)) return false
    const instructions = input.rework
      ?? (typeof issue?.rework_instructions === 'string' ? issue.rework_instructions.trim() : '')
    // A run whose outcome the hub never accepted is finished here and must not be
    // re-claimed: that claim would hand this Host a new attempt with nothing to
    // execute, keep its lease alive, and make the next retry of the old body
    // answer 412 against the new attempt, losing the result for good. The pass
    // retries the write-back first (once, not twice), so a hub that is ready again
    // moves the issue instead of this Host taking an attempt it cannot run.
    if (existing !== undefined && previous?.pendingSettle !== undefined && instructions === '') {
      if (!this.#settledThisPass.has(input.issueId)) {
        this.#settledThisPass.add(input.issueId)
        await this.#writeSettlement(existing.id, input.issueId, previous.pendingSettle)
      }
      if (this.#pendingSettleOf(existing.id) !== undefined) return false
    }
    const claim = await this.#claimFromHub(input.issueId, existing, previous)
    if (claim === undefined) return false

    if (existing !== undefined) {
      // A hub that recognizes the attempt re-establishes the same lease, and this
      // Host mirrors the credentials without starting anything of its own: a
      // second execution for one attempt is exactly the duplicate this path
      // prevents, and a rework the issue still carries belongs to the run that is
      // already consuming it.
      this.#writeLink(existing.id, {
        attemptId: claim.execution_attempt_id,
        leaseToken: claim.lease_token,
        leaseExpiresAt: claim.lease_expires_at,
        hubStatus: 'running',
      })
      this.#ensureLease(existing, input.issueId, claim.lease_token)
      // A settlement left by an earlier round belongs to an attempt the hub has
      // replaced: it can never land again, and keeping it would make the next
      // retry answer 412 against credentials the card no longer uses.
      if (previous?.pendingSettle !== undefined
        && previous.pendingSettle.execution_attempt_id !== claim.execution_attempt_id) {
        this.#writeLink(existing.id, { pendingSettle: undefined })
      }
      if (this.#localExecutionRunning(existing)) return false
      // A pending rework IS the one thing that has to run, and only after the
      // claim above succeeded.
      if (instructions !== '') {
        this.#applyRework(existing.id, instructions)
        return false
      }
      // Nothing runs here and nothing waits to be written back: a human retry
      // moved the issue back to `assigned` while this card sat finished, and
      // this is the one entry that starts it again.
      this.#requestRun(existing.id)
      return false
    }

    // The guard above keeps these two defined on this path.
    if (agent === undefined || issue === undefined) return false
    const workspaceId = this.#workspaceFor(agent)
    const mirror: MirrorAgent = {
      agentId: this.#hubAgentIdOf(agent.memberId) ?? agent.memberId,
      memberId: agent.memberId,
      name: agent.name,
      ...(agent.preset === undefined ? {} : { preset: agent.preset }),
      ...(agent.model === undefined ? {} : { model: agent.model }),
      ...(agent.reasoningEffort === undefined ? {} : { reasoningEffort: agent.reasoningEffort }),
      // The card carries the workspace this Host resolved for the member, not only
      // the one the team pins: the claim above already refused to run without one.
      ...(workspaceId === '' ? {} : { workspaceId }),
    }
    const draft = buildMirrorDraft(issue, mirror)
    const payload = toPayload({
      issueId: issue.id,
      issueNumber: issue.issue_number,
      attemptId: claim.execution_attempt_id,
      leaseToken: claim.lease_token,
      leaseExpiresAt: claim.lease_expires_at,
      agentId: mirror.agentId,
      agentMemberId: agent.memberId,
      ...(agent.preset === undefined ? {} : { preset: agent.preset }),
      hubStatus: 'running',
    })
    let task: TaskRecord
    try {
      task = this.#options.host.tasks.create(draft, { payload })
    } catch (error) {
      this.#options.log?.('mirror card refused for ' + issue.id, error)
      this.#lastError = describe(error)
      return false
    }
    this.#cards.set(task.id, {
      issueId: issue.id,
      issueNumber: issue.issue_number,
      hubStatus: 'running',
      agentName: agent.name,
      comments: [],
      activity: [],
    })
    this.#ensureLease(task, issue.id, claim.lease_token)
    // The card is read back before anything runs: a board revision that cannot
    // pin the draft targets drops them silently, and a card that fell back to the
    // deployment's default preset must NOT be started as if it were the member's
    // own run. Such a card is left for a human, visibly.
    if (!this.#verifyDraftPin(task.id, agent)) {
      this.#recordError(task.id, new Error(
        'this board revision cannot pin an agent preset on a new card, so the mirror card was created without '
        + agent.name + "'s own preset and was not started; start it by hand once the board supports draft targets",
      ))
      return true
    }
    this.#requestRun(task.id)
    return true
  }

  /**
   * The settlement one card still owes the hub, read back from the card itself.
   * @param taskId - the card to read.
   * @returns the pending settlement, or undefined when the hub took it.
   */
  #pendingSettleOf(taskId: string): SettleRequestBody | undefined {
    const task = this.#options.host.tasks.get(taskId)
    if (task === undefined) return undefined
    return readTaskIssueLink(task)?.pendingSettle
  }

  /**
   * Ask the hub for one issue, presenting this Host's previous attempt only on a
   * reconnect.
   *
   * A reconnect is the one moment the old credentials are still true: the run is
   * executing here and this Host still holds the lease, so the hub re-establishes
   * that attempt instead of minting a new one (protocol section 5). Every other
   * claim is fresh and the hub mints the attempt id itself, so presenting one it
   * never granted would only ask it to adopt this Host's guess.
   * @param issueId - the issue to claim.
   * @param task - the card that mirrors it, when it has one.
   * @param link - that card's stored linkage.
   * @returns the lease the hub granted, or undefined when another attempt holds the issue.
   */
  async #claimFromHub(
    issueId: string,
    task: TaskRecord | undefined,
    link: TeamIssueLink | undefined,
  ): Promise<HubClaim | undefined> {
    try {
      return await this.#options.hub.claim(issueId, this.#reconnectCredentials(task, link))
    } catch (error) {
      // The loser of a claim race is not a failure: the hub already granted this
      // issue to an attempt that is executing it, so this caller has nothing to
      // do and must not put a false error on the operator's screen.
      if (isClaimHeldElsewhere(error)) return undefined
      throw error
    }
  }

  /**
   * The credentials one claim presents, which is non-empty only on a reconnect.
   * @param task - the card that mirrors the issue, when it has one.
   * @param link - that card's stored linkage.
   * @returns the attempt and lease to present, or nothing for a fresh claim.
   */
  #reconnectCredentials(task: TaskRecord | undefined, link: TeamIssueLink | undefined): {
    execution_attempt_id?: string
    lease_token?: string
  } {
    if (task === undefined || link === undefined) return {}
    if (link.attemptId === undefined || link.leaseToken === undefined) return {}
    if (!this.#localExecutionRunning(task)) return {}
    return { execution_attempt_id: link.attemptId, lease_token: link.leaseToken }
  }

  /**
   * Whether this Host still runs one of the card's executions.
   *
   * The board closes an execution by stamping its end instant, so an execution
   * with no end is what "running here" means: the card's column can read
   * `running` for a declaration a human made, and that starts nothing.
   * @param task - the card to read.
   * @returns whether one of its executions is still open.
   */
  #localExecutionRunning(task: TaskRecord): boolean {
    return task.executions.some(execution => execution.endedAt === undefined)
  }

  /**
   * Check that the created card really carries the member's execution targets.
   * @param taskId - the card just created.
   * @param agent - the member it was created for.
   * @returns whether the board kept the pinned preset (no preset means nothing to check).
   */
  #verifyDraftPin(taskId: string, agent: BoundAgent): boolean {
    if (agent.preset === undefined || agent.preset === '') {
      this.#presetPin = 'supported'
      return true
    }
    const created = this.#options.host.tasks.get(taskId)
    if (created !== undefined && created.mode === agent.preset) {
      this.#presetPin = 'supported'
      return true
    }
    this.#presetPin = 'missing'
    this.#raiseProblem(DRAFT_PIN_PROBLEM)
    return false
  }

  /**
   * Post one agent comment on the issue a card mirrors.
   *
   * The agent identity is the hub record this Host registered for the member the
   * card was claimed for: the hub only accepts agent comments from the token
   * holder that owns that agent, so the id comes from the payload instead of
   * from whatever the model named.
   * @param input - the card or issue to comment on, and the markdown body.
   * @returns the stored comment's id.
   */
  async postComment(input: { taskId?: string; issueId?: string; text: string }): Promise<{ issueId: string; commentId: string }> {
    const linked = this.#linked()
    const task = input.taskId === undefined
      ? (input.issueId === undefined ? undefined : findLinkedTask(linked, input.issueId))
      : this.#options.host.tasks.get(input.taskId)
    if (task === undefined) throw new Error('no team card matches this comment')
    const link = readTaskIssueLink(task)
    if (link === undefined) throw new Error('that card does not mirror a team issue')
    const agentId = link.agentId ?? this.#hubAgentIdOf(link.agentMemberId ?? '')
    if (agentId === undefined) throw new Error('no hub agent record is bound to that card yet')
    const comment = await this.#options.hub.createComment(link.issueId, {
      content: input.text,
      author_type: 'agent',
      author_agent_id: agentId,
    })
    this.#recordComment({ comment })
    return { issueId: link.issueId, commentId: comment.id }
  }

  #requestRun(taskId: string): void {
    const run = this.#options.requestRun
    if (run === undefined) {
      this.#recordError(taskId, new Error('this board revision serves no way to start an execution; open the card and run it from the board'))
      return
    }
    try {
      run(taskId)
    } catch (error) {
      this.#recordError(taskId, error)
    }
  }

  #ensureLease(task: TaskRecord, issueId: string, leaseToken: string): void {
    this.#releaseLease(task.id)
    const renew = (): void => {
      void this.#options.hub.renewLease(issueId, leaseToken).then(renewed => {
        this.#writeLink(task.id, { leaseExpiresAt: renewed.lease_expires_at })
      }).catch((error: unknown) => {
        // LEASE_EXPIRED is the one refusal that means the lease is gone: keeping
        // the timer would renew a lease the hub no longer has.
        if (error instanceof HubError && error.code === 'LEASE_EXPIRED') {
          this.#releaseLease(task.id)
          this.#recordError(task.id, error)
          return
        }
        this.#options.log?.('lease renewal failed for ' + issueId, error)
      })
    }
    this.#leases.set(task.id, this.#options.timers.interval(renew, LEASE_RENEW_INTERVAL_MS))
    renew()
  }

  #releaseLease(taskId: string): void {
    const cancel = this.#leases.get(taskId)
    if (cancel === undefined) return
    cancel()
    this.#leases.delete(taskId)
  }

  async #deliverMention(payload: Record<string, unknown>): Promise<void> {
    const issueId = typeof payload.issue_id === 'string' ? payload.issue_id : undefined
    const content = typeof payload.content === 'string' ? payload.content : ''
    if (issueId === undefined || content.trim() === '') return
    const author = typeof payload.author === 'string' && payload.author !== '' ? payload.author : 'a team member'
    const task = findLinkedTask(this.#linked(), issueId)
    if (task === undefined) return
    this.#pushActivity(task.id, issueId, 'comment.mentioned', clip(author + ': ' + content))
    const sessions = this.#options.host.sessions
    const deliver = sessions?.followUp
    if (sessions === undefined || deliver === undefined) {
      // Visible degradation: the mention is kept on the card's activity stream,
      // and the settings section says this board cannot deliver it into the
      // session instead of the message disappearing silently.
      this.#recordError(task.id, new Error('this board revision serves no follow-up delivery, so a mention could not reach the session'))
      return
    }
    try {
      await deliver.call(sessions, task.id, clip(author + ' mentioned this task: ' + content))
    } catch (error) {
      this.#recordError(task.id, error)
    }
  }

  async #rework(payload: Record<string, unknown>): Promise<void> {
    const issueId = typeof payload.issue_id === 'string' ? payload.issue_id : undefined
    if (issueId === undefined) return
    const instructions = typeof payload.instructions === 'string' ? payload.instructions.trim() : ''
    const task = findLinkedTask(this.#linked(), issueId)
    if (task === undefined) {
      this.#options.log?.('rework requested for an issue this Host does not mirror: ' + issueId)
      return
    }
    if (instructions === '') {
      // A rejection without instructions is a malformed signal: claiming the
      // issue for it would take work this Host cannot redo.
      this.#recordError(task.id, new Error('the rework request carried no instructions, so nothing was re-run'))
      return
    }
    // The claim goes through the SAME per-issue lock a sweep uses (protocol
    // amendment A4 point 5). The hub sends `issue.updated` and `issue.rework` back
    // to back, so the sweep and this event otherwise claim one issue twice: the
    // hub grants it to one of them and the loser records a race the operator
    // would read as a failure. A rework claim is fresh, so the hub mints the new
    // attempt id itself and nothing here presents a dead one.
    try {
      await this.#claimExclusively(issueId, () => this.#claimOnce({ issueId, rework: instructions }))
    } catch (error) {
      // Claim failed: nothing runs. The instructions are not applied and the
      // card is untouched, because a rework the hub did not authorize must not
      // start an execution.
      this.#recordError(task.id, error)
      return
    }
    this.#publish()
  }

  /**
   * Apply review instructions to one already-mirrored card through the board's
   * rework capability, or report the gap.
   * @param taskId - the card the reviewer sent back.
   * @param instructions - what the reviewer asked for.
   */
  #applyRework(taskId: string, instructions: string): void {
    const rework = this.#options.host.tasks.rework
    if (rework === undefined) {
      this.#recordError(taskId, new Error('this board revision serves no rework, so the review instructions could not be applied'))
      return
    }
    try {
      rework.call(this.#options.host.tasks, taskId, instructions, 'team-hub')
    } catch (error) {
      this.#recordError(taskId, error)
    }
  }

  #recordComment(payload: Record<string, unknown>): void {
    const comment = payload.comment
    if (typeof comment !== 'object' || comment === null) return
    const row = comment as HubComment
    if (typeof row.issue_id !== 'string') return
    const task = findLinkedTask(this.#linked(), row.issue_id)
    if (task === undefined) return
    const view = this.#view(task.id, row.issue_id)
    const author = this.#authorLabel(row)
    const entry: TeamCommentView = {
      id: typeof row.id === 'string' ? row.id : this.#options.uuid(),
      author,
      content: clip(typeof row.content === 'string' ? row.content : ''),
      createdAt: typeof row.created_at === 'number' ? row.created_at : this.#options.now(),
    }
    view.comments = [...view.comments, entry].slice(-VIEW_ENTRY_LIMIT)
    this.#pushActivity(task.id, row.issue_id, 'comment.created', entry.content)
    this.#publish()
  }

  /**
   * Render one comment author the way a reader recognizes them.
   *
   * An agent author resolves to the member name this Host registered, and a human
   * author to the display name the card already knows; a name this Host cannot
   * resolve reads as "team member" rather than as a raw `mem_...` identifier,
   * which tells a reader nothing about who is speaking.
   * @param comment - the comment row the hub served.
   * @returns the label the detail section renders.
   */
  #authorLabel(comment: HubComment): string {
    const agentId = typeof comment.author_agent_id === 'string' ? comment.author_agent_id : undefined
    if (agentId !== undefined) {
      const agent = this.#hubAgents.get(agentId)
      if (agent !== undefined) return agent.name
      return 'team agent'
    }
    const memberId = typeof comment.author_member_id === 'string' ? comment.author_member_id : undefined
    if (memberId !== undefined) {
      for (const view of this.#cards.values()) {
        if (view.reviewerMemberId === memberId && view.reviewer !== undefined) return view.reviewer
        if (view.assigneeMemberId === memberId && view.assignee !== undefined) return view.assignee
      }
    }
    return 'team member'
  }

  #recordStatus(payload: Record<string, unknown>): void {
    const issueId = typeof payload.issue_id === 'string' ? payload.issue_id : undefined
    const status = readStatus(payload.new_status)
    if (issueId === undefined || status === undefined) return
    const task = findLinkedTask(this.#linked(), issueId)
    if (task === undefined) return
    const view = this.#view(task.id, issueId)
    view.hubStatus = status
    this.#pushActivity(task.id, issueId, 'issue.status_changed', status)
    this.#writeLink(task.id, { hubStatus: status })
    // A lease that lapsed puts the issue back in the pool the hub offers this
    // Host; the sweep turns that into a renewed claim, never a second card. A
    // terminal status releases the lease on this side.
    if (status === 'assigned' || status === 'waiting_host') this.requestSweep()
    if (status === 'done' || status === 'canceled' || status === 'failed') this.#releaseLease(task.id)
    this.#publish()
  }

  #pushActivity(taskId: string, issueId: string, type: string, text: string): void {
    const view = this.#view(taskId, issueId)
    view.activity = [...view.activity, {
      id: this.#options.uuid(),
      type,
      text: clip(text),
      createdAt: this.#options.now(),
    }].slice(-VIEW_ENTRY_LIMIT)
  }

  #view(taskId: string, issueId: string): TeamCardView {
    const existing = this.#cards.get(taskId)
    if (existing !== undefined) {
      existing.issueId = issueId
      return existing
    }
    const created: TeamCardView = { issueId, comments: [], activity: [] }
    this.#cards.set(taskId, created)
    return created
  }

  #recordError(taskId: string, error: unknown): void {
    const message = describe(error)
    this.#lastError = message
    const view = this.#cards.get(taskId)
    if (view !== undefined) view.lastError = message
    if (this.#options.host.tasks.get(taskId) !== undefined) this.#writeLink(taskId, { lastError: message })
    this.#options.log?.(message)
    this.#publish()
  }

  #writeLink(taskId: string, patch: Partial<TeamIssueLink>): void {
    const task = this.#options.host.tasks.get(taskId)
    if (task === undefined) return
    const current = readTaskIssueLink(task)
    if (current === undefined) return
    const merged: TeamIssueLink = { ...current, ...patch }
    const payload = toPayload(merged)
    // A member this patch sets to undefined is one the card has to FORGET (the
    // attempt of a settled run, a settlement the hub has taken). `toPayload`
    // drops absent members to keep a merge from storing them, so the deletions
    // are put back here: the board's own merge removes an explicit undefined.
    for (const key of Object.keys(patch) as Array<keyof TeamIssueLink>) {
      if (patch[key] === undefined) payload[key] = undefined
    }
    try {
      this.#options.host.integration.write(taskId, payload)
    } catch (error) {
      this.#options.log?.('integration write failed for ' + taskId, error)
      return
    }
    const view = this.#cards.get(taskId)
    if (view !== undefined && merged.hubStatus !== undefined) view.hubStatus = merged.hubStatus
  }

  #linked(): readonly TaskBoardLinkedTask[] {
    try {
      return this.#options.host.tasks.linked()
    } catch {
      return []
    }
  }

  /**
   * The workspace a mirror card claimed for one member runs in.
   *
   * The mount's own setting wins, then the workspace the member's dsh-agents team
   * pins. An empty answer means the board could not start a card created for this
   * member, which is the state a claim must never enter.
   * @param agent - the member the issue would be claimed for.
   * @returns the workspace id, or an empty string when neither source names one.
   */
  #workspaceFor(agent: BoundAgent): string {
    const configured = (this.#options.settings().workspaceId ?? '').trim()
    if (configured !== '') return configured
    return (agent.workspaceId ?? '').trim()
  }

  #agentFor(issue: HubIssue): BoundAgent | undefined {
    const hubAgentId = issue.assignee_agent_id
    if (hubAgentId === undefined) return undefined
    // Only a hub agent record this Host learned at registration may be executed
    // here: an id it cannot resolve is either another machine's agent or one the
    // hub refused in `conflicts`, and neither may run on this machine.
    return this.#hubAgents.get(hubAgentId)
  }

  #hubAgentIdOf(memberId: string): string | undefined {
    for (const [hubId, agent] of this.#hubAgents) {
      if (agent.memberId === memberId) return hubId
    }
    return undefined
  }

  /**
   * The problems the hub's registration answer leaves behind, one per clash.
   * @returns the visible lines the settings section renders.
   */
  #conflictProblems(): string[] {
    return [...this.#agentConflicts].map(([name, reason]) => name + ' is not registered: ' + reason)
  }

  /**
   * Add one operator-visible problem line, once.
   *
   * A sweep repeats every few seconds, so appending the same line each pass would
   * bury every other problem under copies of itself.
   * @param line - the line to publish while its cause holds.
   */
  #raiseProblem(line: string): void {
    if (this.#problems.includes(line)) return
    this.#problems = [...this.#problems, line]
  }

  /**
   * Drop one problem line whose cause is gone.
   * @param line - the line to stop publishing.
   */
  #dropProblem(line: string): void {
    if (!this.#problems.includes(line)) return
    this.#problems = this.#problems.filter(problem => problem !== line)
  }

  #publish(): void {
    try {
      this.#options.host.publish(this.summary() as unknown as Record<string, unknown>)
    } catch (error) {
      this.#options.log?.('summary publish failed', error)
    }
  }
}

/** Read one status string into the collaboration vocabulary. */
function readStatus(raw: unknown): HubIssueStatus | undefined {
  switch (raw) {
    case 'todo':
    case 'assigned':
    case 'waiting_host':
    case 'running':
    case 'in_review':
    case 'done':
    case 'canceled':
    case 'failed':
      return raw
    default:
      return undefined
  }
}

/** Read the agent records one registration answered with. */
function readAgentRecords(registered: unknown): Array<{ id: string; name: string }> {
  if (typeof registered !== 'object' || registered === null) return []
  const agents = (registered as { agents?: unknown }).agents
  if (!Array.isArray(agents)) return []
  const records: Array<{ id: string; name: string }> = []
  for (const entry of agents) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.id === 'string' && typeof record.name === 'string') {
      records.push({ id: record.id, name: record.name })
    }
  }
  return records
}

/** Read the agent names one registration answer reported as already owned elsewhere. */
function readAgentConflicts(answer: unknown): Array<{ name: string; reason: string }> {
  if (typeof answer !== 'object' || answer === null) return []
  const conflicts = (answer as { conflicts?: unknown }).conflicts
  if (!Array.isArray(conflicts)) return []
  const rows: Array<{ name: string; reason: string }> = []
  for (const entry of conflicts) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.name !== 'string' || row.name === '') continue
    rows.push({ name: row.name, reason: typeof row.reason === 'string' ? row.reason : 'the hub reported a conflict' })
  }
  return rows
}

/**
 * Whether one settlement refusal means the hub will never accept that body.
 *
 * Two families are final. `412 LEASE_EXPIRED` says the issue no longer carries the
 * attempt the write-back presents — a rework, a retry or another attempt replaced
 * it — so the same body can never match again. Every other deterministic 4xx says
 * the request itself is refused, which a later identical request does not change;
 * `408` and `429` are the two that mean "not now" rather than "not ever", so those
 * stay retryable along with transport failures and 5xx.
 * @param error - the refusal the settlement answered with.
 * @returns whether this settlement can never land.
 */
function isSettlementFinal(error: unknown): boolean {
  if (!(error instanceof HubError)) return false
  if (error.code === 'LEASE_EXPIRED') return true
  if (error.status < 400 || error.status >= 500) return false
  // 401 means this Host's token is unknown or revoked, which the operator fixes
  // by pasting the right one; a 4xx without the hub's error envelope came from
  // something in front of the hub (a CDN or firewall), not from its gates.
  if (error.status === 401 || error.code === 'HTTP_' + String(error.status)) return false
  return error.status !== 408 && error.status !== 429
}

/**
 * Whether one claim refusal means another attempt is already executing the issue.
 *
 * Two callers claiming the same issue is a race the hub resolves, not a fault:
 * the loser is told the lease belongs to another attempt (409 `LEASE_HELD_BY_OTHER`,
 * or the bare 409 of a claim that just lost). Recording that as a failure would
 * put a false error on a card that is running exactly as it should.
 * @param error - the refusal the claim answered with.
 * @returns whether this refusal is a lost race.
 */
function isClaimHeldElsewhere(error: unknown): boolean {
  return error instanceof HubError && (error.status === 409 || error.code === 'LEASE_HELD_BY_OTHER')
}

/** One error as the summary and the log carry it. */
function describe(error: unknown): string {
  if (error instanceof HubError) return error.code + ': ' + error.message
  if (error instanceof Error) return error.message
  return String(error)
}