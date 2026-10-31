/**
 * GitHub synchronization engine for the task board's GitHub extension.
 *
 * The engine never touches the Host ledger: it reads and writes every card
 * through the extension capability face the board hands it, so the board stays
 * the single authority and this provider owns only its own payload, its
 * identity index, and its outbound HTTP.
 *
 * The identity index is the provider's own structure: it is built from the
 * board's cards at start(), kept current as cards are materialized, and pruned
 * when the board reports a deletion. A lookup that misses rebuilds the index
 * from the board rather than trusting the cache blindly, so a card that
 * arrived out of band (a legacy ledger import, for instance) is still found.
 *
 * @module dsh-task-board-github/host/service
 */
import type { HostTimerFace } from '../core/timers.ts'
import type { ExecutionRecord, TaskRecord, TaskStatus } from '../core/task-record.ts'
import type { TaskBoardExtensionHost } from '../core/contract.ts'
import {
  GITHUB_COMMENT_MAX_CHARS,
  ME_ASSIGNEE,
  normalizeGitHubMetadata,
  readTaskGitHubMetadata,
  type GitHubPullRequestMetadata,
  type GitHubRepoConfig,
  type GitHubTaskMetadata,
  type ResolvedGitHubRepoConfig,
  resolveRepoConfig,
} from '../core/types.ts'
import {
  composeIssuePrompt,
  computeLabelWriteBack,
  extractLabelNames,
  isDshManagedLabel,
  isIssueIncluded,
  materializeTaskFromIssue,
  reconcileIssueWithTask,
  reconcileRemoteClose,
} from '../core/projection.ts'
import { isPromptEdited, issueSourceHash, type IssuePromptSource } from '../core/prompt.ts'
import { workspaceIdForRepository, type WorkspaceMatchCandidate } from '../core/workspace-match.ts'
import { IssueAnalysisError, splitModelRoute, type AnalysisRoute, type IssueAnalyzer } from './analysis.ts'
import { GitHubApiClient, proxyClientOptions } from './client.ts'
import type { ProxyConfiguration } from './proxy.ts'

/** Options of one analysis request. */
export interface AnalysisRequest {
  /** Qualified provider/model; absent falls back to the repository, the card, then the host default. */
  model?: string
  /** Replace a prompt somebody edited by hand. Without it an edited prompt refuses the request. */
  overwrite?: boolean
}

/** A refusal of an analysis request, with a stable code the browser can phrase. */
export class AnalysisRequestError extends Error {
  constructor(readonly code: 'not-linked' | 'not-configured' | 'frozen' | 'prompt-edited' | 'in-flight' | 'no-model' | 'no-analyzer', message: string) {
    super(message)
    this.name = 'AnalysisRequestError'
  }
}

/**
 * The optional host workspace registry the provider infers an issue's checkout
 * from. Resolved structurally and read at use time: a deployment that serves
 * none simply pins nothing, which is the pre-existing behavior.
 */
export interface WorkspaceRegistryFace {
  list(): readonly WorkspaceMatchCandidate[]
}

export interface GitHubSyncServiceOptions {
  /** The capability face the board hands the extension while it is enabled. */
  host: TaskBoardExtensionHost
  client?: GitHubApiClient
  repositories?: GitHubRepoConfig[]
  timers?: HostTimerFace
  now?: () => number
  /**
   * The optional host workspace registry. Absent leaves every synchronized
   * card on the board's own workspace inheritance rules.
   */
  workspaceRegistry?: () => WorkspaceRegistryFace | undefined
  /**
   * Called after every completed pass, so a consumer can re-publish health.
   * Never awaited, and a throw from it never reaches the pass.
   */
  onPass?: () => void
  /**
   * Resolves the live GitHub token, credential store first.
   *
   * Resolved once per PASS, not once at activation. The store is an async host
   * service that may not be serving when this row activates, and a token read
   * that races it yields nothing: the provider then mounts unauthenticated and,
   * because re-resolution only happened on a `credentials/reference-updated`
   * event that a pre-existing credential never fires, stays that way for the
   * life of the host. A pass runs long after activation, by which time the
   * store answers, so resolving here is what makes the first poll work.
   */
  credential?: () => Promise<string | undefined>
  /**
   * Writes the model analysis a card's prompt may include. Absent (a
   * deployment with no model service wired) refuses analysis requests while
   * synchronization keeps working on the templated prompt alone.
   */
  analyzer?: IssueAnalyzer
  /** Resolves the host's default model route (provider/model), when there is one. */
  defaultModel?: () => Promise<string | undefined>
  /**
   * Resolves the proxy for the client this service builds itself.
   *
   * Only read by the `new GitHubApiClient()` fallback: a caller that hands a
   * client in has already decided its transport. Absent keeps the conventional
   * variables deciding, so a programmatic mount behaves as it did before the
   * proxy became configuration.
   */
  proxy?: () => ProxyConfiguration
}

const DEFAULT_TIMERS: HostTimerFace = {
  timeout(callback: () => void, delay: number): () => void {
    const handle = setTimeout(callback, delay)
    return () => { clearTimeout(handle) }
  },
  interval(callback: () => void, delay: number): () => void {
    const handle = setInterval(callback, delay)
    return () => { clearInterval(handle) }
  },
}

/** Stable key of one remote issue identity. */
function identityKey(owner: string, repository: string, issueNumber: number): string {
  return `${owner.toLowerCase()}/${repository.toLowerCase()}#${String(issueNumber)}`
}

export class GitHubSyncService {
  readonly host: TaskBoardExtensionHost
  readonly client: GitHubApiClient
  readonly repositories: ResolvedGitHubRepoConfig[]
  private readonly timers: HostTimerFace
  private readonly now: () => number
  private readonly workspaceRegistry: (() => WorkspaceRegistryFace | undefined) | undefined
  private readonly onPass: (() => void) | undefined
  private readonly credential: (() => Promise<string | undefined>) | undefined
  private pollTimer: (() => void) | undefined
  private stopped = false
  /** In-flight pass, with the instant it opened: a stale one is taken over. */
  private inFlight: { since: number } | undefined
  /** When the last pass actually reached a repository, ms epoch. */
  private lastSyncAt: number | undefined
  /** Errors the last pass collected, for the operator to read. */
  private lastSyncErrors: string[] = []
  /** Consecutive passes that synced nothing at all. */
  private consecutiveEmptySyncs = 0
  /** Immutable remote identity -> local card id, owned by this provider. */
  private readonly identityIndex = new Map<string, string>()
  /** Login this credential authenticates as, resolved once for an `@me` inclusion rule. */
  private authenticatedLogin: string | undefined
  private readonly analyzer: IssueAnalyzer | undefined
  private readonly defaultModel: (() => Promise<string | undefined>) | undefined
  /** In-flight analyses by card id, so one card never runs two at once. */
  private readonly analyses = new Map<string, { controller: AbortController; done: Promise<void> }>()

  constructor(options: GitHubSyncServiceOptions) {
    this.host = options.host
    this.client = options.client ?? new GitHubApiClient(proxyClientOptions(options.proxy?.()))
    this.repositories = (options.repositories ?? []).map(resolveRepoConfig)
    this.timers = options.timers ?? DEFAULT_TIMERS
    this.now = options.now ?? Date.now
    this.workspaceRegistry = options.workspaceRegistry
    this.onPass = options.onPass
    this.credential = options.credential
    this.analyzer = options.analyzer
    this.defaultModel = options.defaultModel
  }

  /**
   * Put the live token on the client before a pass uses it.
   *
   * A store that cannot be read is swallowed on purpose: it must not throw
   * out of the pass, and the pass then reports a missing credential through
   * its ordinary error path instead.
   */
  /**
   * Apply a newly stored credential to this process, now.
   *
   * A credential write lands in the store while the provider keeps running, so
   * without this the client keeps the token it read on the previous pass: a
   * write attempted right after the operator replaced the token failed until
   * the next five-minute poll or a restart. The login cached for an `@me`
   * inclusion rule belongs to the old credential and is dropped with it,
   * because a different account must be asked again rather than reported from
   * memory.
   */
  async reloadCredential(): Promise<void> {
    this.authenticatedLogin = undefined
    await this.refreshCredential()
  }

  private async refreshCredential(): Promise<void> {
    if (this.credential === undefined) return
    try {
      this.client.setToken(await this.credential())
    } catch {
      // Leave the client on whatever it already had.
    }
  }

  /**
   * The workspace an issue from one repository should be pinned to.
   *
   * Resolved per materialization, not once at start: a user who adds a
   * checkout after the extension mounted must still get correctly pinned
   * cards. A registry that is absent, throws, or lists nothing leaves the pin
   * empty, which is the board's own inheritance behavior rather than a guess.
   *
   * @param repository - the GitHub repository name.
   * @returns the workspace id, or undefined when the rule does not match.
   */
  workspaceIdFor(repository: string): string | undefined {
    const registry = this.workspaceRegistry?.()
    if (registry === undefined) return undefined
    let workspaces: readonly WorkspaceMatchCandidate[]
    try {
      workspaces = registry.list()
    } catch {
      return undefined
    }
    if (!Array.isArray(workspaces)) return undefined
    return workspaceIdForRepository(repository, workspaces)
  }

  /**
   * Resolve one repository's inclusion assignee to a concrete login.
   *
   * `@me` asks GitHub who this credential is; the answer is cached for the
   * lifetime of the service, which the host remounts when the credential
   * changes, so a rotated token is never answered from a stale login.
   * @param config - the repository configuration.
   * @returns the configuration with a concrete assignee (or none).
   */
  private async effectiveConfig(config: ResolvedGitHubRepoConfig): Promise<ResolvedGitHubRepoConfig> {
    if (config.assignee !== ME_ASSIGNEE) return config
    let login = this.authenticatedLogin
    if (login === undefined) {
      const user = await this.client.getAuthenticatedUser()
      login = user.login.trim().toLowerCase()
      this.authenticatedLogin = login
    }
    return { ...config, assignee: login }
  }

  /** Find configured repository matching owner and repo name (case-insensitive). */
  findRepoConfig(owner: string, repository: string): ResolvedGitHubRepoConfig | undefined {
    const o = owner.toLowerCase()
    const r = repository.toLowerCase()
    return this.repositories.find(cfg => cfg.owner.toLowerCase() === o && cfg.repository.toLowerCase() === r)
  }

  /** Start background polling across configured repositories. */
  start(): void {
    if (this.stopped || this.pollTimer !== undefined) return
    this.reindex()
    this.clearStalePendingAnalyses()
    const intervals = this.repositories
      .map(r => r.pollingIntervalMs)
      .filter(ms => ms > 0)
    if (intervals.length === 0) return

    const minInterval = Math.min(...intervals)
    this.pollTimer = this.timers.interval(() => {
      this.runBackgroundSync()
    }, minInterval)

    // Trigger initial background sync
    this.runBackgroundSync()
  }

  /**
   * One background pass, with its outcome reported instead of discarded.
   *
   * The old form was `syncAll().catch(() => {})` on both the timer and the
   * initial call: a pass that rejected took the whole extension down to
   * silence, and the operator was left looking at a configured, credentialed,
   * enabled integration that had plainly stopped working. A pass that merely
   * produced errors is ALSO reported — those were returned to a caller that
   * discarded them, which is why a repository-wide listing failure left no
   * trace on any card.
   */
  private runBackgroundSync(): void {
    void this.syncAll().then(result => {
      if (result.errors.length > 0) {
        console.warn('[dsh-task-board-github] sync reported errors: ' + result.errors.join(' | '))
      }
    }).catch(error => {
      console.error('[dsh-task-board-github] sync failed', error)
    })
  }

  /** Stop background polling timer. */
  stop(): void {
    if (this.pollTimer !== undefined) {
      this.pollTimer()
      this.pollTimer = undefined
    }
  }

  dispose(): void {
    this.stopped = true
    this.stop()
    this.identityIndex.clear()
    for (const { controller } of this.analyses.values()) controller.abort()
    this.analyses.clear()
  }

  /**
   * A pending marker is in-memory state written to the card so the browser can
   * show progress; a host restart loses the request behind it, so a marker
   * found at start belongs to nobody and is cleared rather than left spinning.
   */
  private clearStalePendingAnalyses(): void {
    for (const { task, payload } of this.host.tasks.linked()) {
      if (typeof payload.analysisPendingSince !== 'number') continue
      if (this.analyses.has(task.id)) continue
      this.writePayload(task.id, { analysisPendingSince: undefined })
    }
  }

  /**
   * The issue facts one card's analysis is written from: the last synchronized
   * remote snapshot, with DSH-managed labels left out.
   */
  private promptSourceOf(gh: GitHubTaskMetadata, config: ResolvedGitHubRepoConfig): IssuePromptSource {
    return {
      owner: config.owner,
      repository: config.repository,
      issueNumber: gh.issueNumber,
      issueUrl: gh.issueUrl,
      title: gh.remoteTitle ?? '',
      body: gh.remoteBody ?? '',
      labels: gh.remoteLabels.filter(label => !isDshManagedLabel(label, config) && label !== config.inclusionLabel),
    }
  }

  /**
   * Resolve the model route of one analysis: the request, then the
   * repository's analysis model, then the card's own pinned model, then the
   * host default.
   */
  private async analysisRoute(task: TaskRecord, config: ResolvedGitHubRepoConfig, requested?: string): Promise<{ route: AnalysisRoute; qualified: string } | undefined> {
    const candidates: Array<string | undefined> = [requested, config.analysisModel, task.model]
    for (const candidate of candidates) {
      const route = splitModelRoute(candidate)
      if (route !== undefined) return { route, qualified: `${route.provider}/${route.model}` }
    }
    let fallback: string | undefined
    try {
      fallback = await this.defaultModel?.()
    } catch {
      fallback = undefined
    }
    const route = splitModelRoute(fallback)
    return route === undefined ? undefined : { route, qualified: `${route.provider}/${route.model}` }
  }

  /**
   * Start one model analysis of a card's issue.
   *
   * Validation is synchronous so the caller sees a refusal at once; the model
   * call itself runs in the background, because it routinely outlives the
   * board's action channel. Progress is written to the card's payload
   * (`analysisPendingSince`, then `analysis` or `analysisError`), which the
   * board broadcasts like any other card change.
   *
   * On success the analysis is stored with the fingerprint of the issue it was
   * written from, and the card's prompt is regenerated to include it — through
   * the board's content gate, so a card that started executing meanwhile keeps
   * its recorded prompt.
   * @param taskId - the card to analyze.
   * @param request - model route and overwrite consent.
   * @returns a promise that settles when the background analysis has been recorded.
   */
  beginAnalysis(taskId: string, request: AnalysisRequest = {}): Promise<void> {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) throw new AnalysisRequestError('not-linked', 'task is not linked to a GitHub issue')
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) throw new AnalysisRequestError('not-configured', `repository ${gh.owner}/${gh.repository} is not configured`)
    if (this.analyzer === undefined) throw new AnalysisRequestError('no-analyzer', 'this deployment serves no model service for issue analysis')
    if (task.executions.length > 0 || task.archivedAt !== undefined) {
      throw new AnalysisRequestError('frozen', 'the card has started executing; its prompt is read-only')
    }
    if (request.overwrite !== true && isPromptEdited(task.prompt, gh.promptHash, {
      ...(gh.remoteTitle === undefined ? {} : { title: gh.remoteTitle }),
      ...(gh.remoteBody === undefined ? {} : { body: gh.remoteBody }),
    })) {
      throw new AnalysisRequestError('prompt-edited', 'the prompt was edited by hand; confirm overwriting it')
    }
    if (this.analyses.has(taskId)) throw new AnalysisRequestError('in-flight', 'an analysis is already running for this card')

    const controller = new AbortController()
    const analyzer = this.analyzer
    this.writePayload(taskId, { analysisPendingSince: this.now(), analysisError: undefined })
    const done = (async () => {
      try {
        const resolved = await this.analysisRoute(task, config, request.model)
        if (resolved === undefined) throw new AnalysisRequestError('no-model', 'no model route is configured: pick a model, pin one on the card, or set a host default')
        const source = this.promptSourceOf(gh, config)
        const analysis = await analyzer.analyze(source, resolved.route, controller.signal)
        this.recordAnalysis(taskId, {
          ...analysis,
          sourceHash: issueSourceHash(source.title, source.body),
          model: resolved.qualified,
          generatedAt: this.now(),
        })
      } catch (error) {
        if (controller.signal.aborted && this.stopped) return
        const message = error instanceof IssueAnalysisError || error instanceof AnalysisRequestError
          ? error.message
          : error instanceof Error ? error.message : String(error)
        this.writePayload(taskId, { analysisPendingSince: undefined, analysisError: message })
      } finally {
        this.analyses.delete(taskId)
      }
    })()
    this.analyses.set(taskId, { controller, done })
    return done
  }

  /** Store one finished analysis and regenerate the card's prompt with it. */
  private recordAnalysis(taskId: string, analysis: NonNullable<GitHubTaskMetadata['analysis']>): void {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) return
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) return
    const generated = composeIssuePrompt(
      { number: gh.issueNumber, html_url: gh.issueUrl, title: gh.remoteTitle ?? '', body: gh.remoteBody ?? '', labels: gh.remoteLabels },
      config,
      analysis,
    )
    try {
      this.host.tasks.patchContent(taskId, { prompt: generated.prompt })
    } catch {
      // The card started executing while the model was answering: its recorded
      // prompt stays, and the analysis is kept for the record only.
      this.writePayload(taskId, {
        analysis,
        analysisPendingSince: undefined,
        analysisError: 'the card started executing before the analysis finished; its prompt was left unchanged',
      })
      return
    }
    this.writePayload(taskId, { analysis, promptHash: generated.promptHash, analysisPendingSince: undefined, analysisError: undefined })
  }

  /**
   * Drop a card's analysis and regenerate its prompt without it.
   * @param taskId - the card.
   * @param overwrite - replace a prompt somebody edited by hand.
   */
  clearAnalysis(taskId: string, overwrite = false): void {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) throw new AnalysisRequestError('not-linked', 'task is not linked to a GitHub issue')
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) throw new AnalysisRequestError('not-configured', `repository ${gh.owner}/${gh.repository} is not configured`)
    if (task.executions.length > 0 || task.archivedAt !== undefined) {
      throw new AnalysisRequestError('frozen', 'the card has started executing; its prompt is read-only')
    }
    if (!overwrite && isPromptEdited(task.prompt, gh.promptHash, {
      ...(gh.remoteTitle === undefined ? {} : { title: gh.remoteTitle }),
      ...(gh.remoteBody === undefined ? {} : { body: gh.remoteBody }),
    })) {
      throw new AnalysisRequestError('prompt-edited', 'the prompt was edited by hand; confirm overwriting it')
    }
    const generated = composeIssuePrompt(
      { number: gh.issueNumber, html_url: gh.issueUrl, title: gh.remoteTitle ?? '', body: gh.remoteBody ?? '', labels: gh.remoteLabels },
      config,
    )
    this.host.tasks.patchContent(taskId, { prompt: generated.prompt })
    this.writePayload(taskId, { analysis: undefined, analysisError: undefined, promptHash: generated.promptHash })
  }

  /**
   * Move a card the analysis judged as needing no change to the backlog, at
   * the operator's request. The board's own move gates decide.
   * @param taskId - the card.
   */
  moveToBacklog(taskId: string): void {
    const task = this.host.tasks.get(taskId)
    if (task === undefined || this.metadataOf(task) === undefined) throw new AnalysisRequestError('not-linked', 'task is not linked to a GitHub issue')
    this.host.tasks.setStatus(taskId, 'backlog', 'github-analysis')
  }

  /**
   * Rebuild the identity index from the cards the board holds for this
   * extension. Called when the provider starts and whenever a lookup misses.
   */
  reindex(): void {
    this.identityIndex.clear()
    for (const { task, payload } of this.host.tasks.linked()) {
      const metadata = normalizeGitHubMetadata(payload)
      if (metadata === undefined) continue
      this.identityIndex.set(identityKey(metadata.owner, metadata.repository, metadata.issueNumber), task.id)
    }
  }

  /** Record one card's identity in the index. */
  private remember(taskId: string, metadata: GitHubTaskMetadata | undefined): void {
    if (metadata === undefined) return
    this.identityIndex.set(identityKey(metadata.owner, metadata.repository, metadata.issueNumber), taskId)
  }

  /**
   * Drop one deleted card from the index. The board's own events drive this, so
   * a deleted card is never resurrected by a stale identity.
   * @param taskId - the card the board removed.
   */
  handleTaskDeleted(taskId: string): void {
    for (const [key, value] of [...this.identityIndex]) {
      if (value === taskId) this.identityIndex.delete(key)
    }
  }

  /** GitHub metadata on one task, through the provider's own validator. */
  private metadataOf(task: TaskRecord | undefined): GitHubTaskMetadata | undefined {
    return readTaskGitHubMetadata(task)
  }

  /** Find a local task by the provider's immutable issue identity. */
  private findByGitHubIdentity(owner: string, repository: string, issueNumber: number): TaskRecord | undefined {
    const key = identityKey(owner, repository, issueNumber)
    const known = this.identityIndex.get(key)
    if (known !== undefined) {
      const task = this.host.tasks.get(known)
      if (task !== undefined) return task
      this.identityIndex.delete(key)
    }
    // The index is a cache over the board's own store; a miss rebuilds it once
    // rather than losing an identity the board still holds.
    this.reindex()
    const found = this.identityIndex.get(key)
    return found === undefined ? undefined : this.host.tasks.get(found)
  }

  /** The raw payload a reconciled record carries, undefineds included. */
  private payloadOf(next: TaskRecord): Record<string, unknown> | undefined {
    const value = next.integrations?.github
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  }

  /**
   * Project one reconciled task onto the board: materialize a new card, or patch
   * an existing card's content (through the board's own content gate) and merge
   * the provider payload back.
   */
  private applyRecord(next: TaskRecord, previous: TaskRecord | undefined): void {
    if (previous !== undefined) {
      const remoteState = readTaskGitHubMetadata(next)?.remoteState
      const payload = this.payloadOf(next)
      if (remoteState !== undefined && payload !== undefined) {
        const close = reconcileRemoteClose(previous, remoteState)
        next = {
          ...next,
          status: close.status,
          integrations: {
            ...next.integrations,
            github: { ...payload, remoteClose: close.remoteClose },
          },
        }
      }
    }
    // The raw payload is what carries the explicit undefineds a merge needs to
    // clear a field (deactivated, lastSyncError, remoteClose); a normalized
    // copy would drop the key altogether and leave the stale value in place.
    const payload = this.payloadOf(next)
    const metadata = readTaskGitHubMetadata(next)
    if (previous === undefined) {
      // An issue's checkout is a property of its repository, not of whoever
      // happens to be looking at the board: without this pin the card lands on
      // the most recently used workspace, which is the wrong project whenever
      // the user works on more than one. Unmatched stays empty by design.
      const workspaceId = this.workspaceIdFor(metadata?.repository ?? '')
      const created = this.host.tasks.create(
        {
          title: next.title,
          description: next.description,
          prompt: next.prompt,
          status: next.status,
          ...(next.parentId === undefined ? {} : { parentId: next.parentId }),
          ...(workspaceId === undefined ? {} : { workspaceId }),
        },
        {
          ...(payload === undefined ? {} : { payload }),
          ...(next.hidden === true ? { hidden: true } : {}),
        },
      )
      this.remember(created.id, metadata)
      return
    }
    const contentChanged = next.title !== previous.title
      || next.description !== previous.description
      || next.prompt !== previous.prompt
    if (contentChanged) {
      try {
        // The board's own content gate is the authority: a card that has
        // started executing (or was archived) keeps its recorded content, and
        // the refusal is exactly the immutability contract, not an error.
        this.host.tasks.patchContent(next.id, {
          title: next.title,
          description: next.description,
          prompt: next.prompt,
        })
      } catch {
        // Frozen card: keep the local content.
      }
    }
    if (next.status !== previous.status) {
      try {
        const initiator = next.status === 'done' ? 'github:remote-close' : 'github:remote-reopen'
        this.host.tasks.setStatus(next.id, next.status, initiator)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.writePayload(next.id, { lastSyncError: message })
        return
      }
    }
    try {
      if (payload !== undefined) this.host.integration.write(next.id, payload)
    } catch (error) {
      // A status move without its provenance would look like a manual Done on
      // the next pass. Roll it back when possible so the next sync can retry
      // the whole transition instead of freezing that false provenance.
      if (next.status !== previous.status) {
        try { this.host.tasks.setStatus(next.id, previous.status, 'github:sync-rollback') } catch { /* the outer sync error remains authoritative */ }
      }
      throw error
    }
    this.remember(next.id, metadata)
  }

  /** Merge a provider payload patch into one task's GitHub entry. */
  private writePayload(taskId: string, patch: Partial<GitHubTaskMetadata>): void {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) clean[key] = value
    try {
      this.host.integration.write(taskId, clean)
    } catch {
      // A disabled provider or a refused payload must never break a sync.
    }
  }

  /**
   * Synchronize all configured repositories.
   *
   * The re-entry guard is a TIMESTAMP, not a flag. A boolean set true by a
   * pass that never returns is permanent: every later poll returns at the
   * first line, on this host and on every restart of it, with nothing logged
   * and no card touched — the exact failure this replaces. A pass that has
   * held the guard longer than one poll interval is presumed wedged and
   * taken over rather than waited on forever.
   */
  async syncAll(): Promise<{ synced: number; errors: string[] }> {
    if (this.stopped) return { synced: 0, errors: [] }
    const now = this.now()
    const held = this.inFlight
    if (held !== undefined && now - held.since < this.pollIntervalMs()) {
      return { synced: 0, errors: [] }
    }
    this.inFlight = { since: now }
    let totalSynced = 0
    const errors: string[] = []

    // The live token, taken per pass. Reading it once at activation raced the
    // credential store and mounted the provider with nothing, which is why a
    // restart reproduced the failure instead of clearing it.
    await this.refreshCredential()
    if (!this.client.hasCredential()) {
      // One reason for the whole pass, not one per repository: the same cause
      // reported seven times reads as seven problems.
      const message = 'no GitHub API credential available (the harness credential store could not be read for '
        + this.repositories[0]?.owner + '/' + (this.repositories[0]?.repository ?? '?')
        + ' and no GITHUB_TOKEN / GH_TOKEN is set in the environment)'
      this.lastSyncErrors = [message]
      this.consecutiveEmptySyncs += 1
      this.inFlight = undefined
      return { synced: 0, errors: [message] }
    }

    try {
      for (const repo of this.repositories) {
        try {
          const result = await this.syncRepository(repo.owner, repo.repository)
          totalSynced += result.synced
          errors.push(...result.errors)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
    } finally {
      this.inFlight = undefined
    }

    // The health record is written even when a pass produced nothing, which is
    // what makes a stall legible: "last synced 40 minutes ago" is a fact the
    // operator can act on, and silence is not.
    if (errors.length === 0 && totalSynced > 0) {
      this.lastSyncAt = this.now()
      this.lastSyncErrors = []
      this.consecutiveEmptySyncs = 0
    } else {
      this.lastSyncErrors = errors
      this.consecutiveEmptySyncs += 1
    }
    try { this.onPass?.() } catch { /* a health reporter cannot fail a pass */ }

    return { synced: totalSynced, errors }
  }

  /** The shortest configured poll interval, the re-entry guard's own bound. */
  private pollIntervalMs(): number {
    const intervals = this.repositories
      .map(repository => repository.pollingIntervalMs)
      .filter(ms => ms > 0)
    return intervals.length === 0 ? 60_000 : Math.min(...intervals)
  }

  /**
   * What the operator needs to tell "quiet" from "broken": when a pass last
   * reached GitHub, what it reported, and how many passes in a row have
   * produced neither a sync nor a clean result.
   */
  syncHealth(): {
    running: boolean
    inFlight: boolean
    lastSyncAt?: number
    lastErrors: string[]
    consecutiveEmptySyncs: number
    /** Set once the last clean pass is older than three poll intervals. */
    staleSince?: number
    staleAfterMs?: number
  } {
    const now = this.now()
    const staleAfter = this.pollIntervalMs() * 3
    return {
      running: !this.stopped && this.repositories.length > 0,
      inFlight: this.inFlight !== undefined,
      ...(this.lastSyncAt === undefined ? {} : { lastSyncAt: this.lastSyncAt }),
      lastErrors: [...this.lastSyncErrors],
      consecutiveEmptySyncs: this.consecutiveEmptySyncs,
      ...(this.lastSyncAt !== undefined && now - this.lastSyncAt > staleAfter
        ? { staleSince: this.lastSyncAt, staleAfterMs: staleAfter }
        : {}),
    }
  }

  /** Synchronize a single repository by owner and name. */
  async syncRepository(owner: string, repository: string): Promise<{ synced: number; errors: string[] }> {
    const config = this.findRepoConfig(owner, repository)
    if (config === undefined) {
      return { synced: 0, errors: [`repository ${owner}/${repository} is not configured`] }
    }
    if (!this.client.hasCredential()) {
      return { synced: 0, errors: ['no GitHub API credential available'] }
    }

    const now = this.now()
    const errors: string[] = []
    let synced = 0
    // An `@me` inclusion rule is resolved once, before the loop, so every
    // decision in this pass compares the same login.
    const effective = await this.effectiveConfig(config)

    try {
      // List issues from GitHub (includes open and closed)
      const issues = await this.client.listIssues(effective.owner, effective.repository)
      const activeIssueNumbers = new Set<number>()

      for (const issue of issues) {
        const hasInclusion = isIssueIncluded(issue, effective)
        const existing = this.findByGitHubIdentity(effective.owner, effective.repository, issue.number)

        if (hasInclusion) {
          activeIssueNumbers.add(issue.number)
          if (existing !== undefined) {
            let updated = reconcileIssueWithTask(existing, issue, now, effective)
            // If task has a linked PR, check PR status as well
            if (this.metadataOf(updated)?.pullRequest !== undefined) {
              updated = await this.checkPullRequestStatus(updated, effective)
            }
            this.applyRecord(updated, existing)
            synced += 1
          } else {
            // Materialize a new task
            const newTask = materializeTaskFromIssue(issue, crypto.randomUUID(), now, effective)
            this.applyRecord(newTask, undefined)
            synced += 1
          }
        } else if (existing !== undefined) {
          // Neither inclusion channel holds any more; deactivate without
          // deleting history.
          let updated = reconcileIssueWithTask(existing, issue, now, effective)
          if (this.metadataOf(updated)?.pullRequest !== undefined) {
            updated = await this.checkPullRequestStatus(updated, effective)
          }
          this.applyRecord(updated, existing)
          synced += 1
        }
      }

      // Check any local tasks for this repo whose issue was not returned or is absent
      for (const task of this.host.tasks.list()) {
        const gh = this.metadataOf(task)
        if (
          gh !== undefined
          && gh.owner.toLowerCase() === config.owner.toLowerCase()
          && gh.repository.toLowerCase() === config.repository.toLowerCase()
          && !activeIssueNumbers.has(gh.issueNumber)
          && gh.deactivated !== true
        ) {
          // Verify with single issue fetch
          try {
            const single = await this.client.getIssue(effective.owner, effective.repository, gh.issueNumber)
            if (!isIssueIncluded(single, effective)) {
              this.applyRecord(reconcileIssueWithTask(task, single, now, effective), task)
            }
          } catch (error) {
            // A failed single-issue read proves nothing about the inclusion
            // label: the issue may simply not be in the listing or the network
            // may be down. Deactivating here would hide a live card on a
            // transient outage, so the failure is recorded instead and the
            // next sync re-evaluates.
            const message = error instanceof Error ? error.message : String(error)
            this.writePayload(task.id, { lastSyncError: message })
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(msg)
      // Record sync error on all tasks of this repo
      for (const task of this.host.tasks.list()) {
        const gh = this.metadataOf(task)
        if (
          gh !== undefined
          && gh.owner.toLowerCase() === config.owner.toLowerCase()
          && gh.repository.toLowerCase() === config.repository.toLowerCase()
        ) {
          this.writePayload(task.id, { lastSyncError: msg })
        }
      }
    }

    return { synced, errors }
  }

  /** Synchronize one specific task by task ID. */
  async syncTask(taskId: string): Promise<{ ok: boolean; error?: string; task?: TaskRecord }> {
    const task = this.host.tasks.get(taskId)
    const metadata = this.metadataOf(task)
    if (task === undefined || metadata === undefined) {
      return { ok: false, error: 'task is not linked to GitHub' }
    }
    const config = this.findRepoConfig(metadata.owner, metadata.repository)
    if (config === undefined) {
      return { ok: false, error: `repository ${metadata.owner}/${metadata.repository} is not configured` }
    }
    if (!this.client.hasCredential()) {
      return { ok: false, error: 'no GitHub API credential available' }
    }

    const now = this.now()
    const effective = await this.effectiveConfig(config)
    try {
      const issue = await this.client.getIssue(effective.owner, effective.repository, metadata.issueNumber)
      let updated = reconcileIssueWithTask(task, issue, now, effective)
      if (this.metadataOf(updated)?.pullRequest !== undefined) {
        updated = await this.checkPullRequestStatus(updated, effective)
      }
      this.applyRecord(updated, task)
      return { ok: true, task: this.host.tasks.get(taskId) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.writePayload(task.id, { lastSyncError: message })
      return { ok: false, error: message }
    }
  }

  /**
   * Resolve the repository a task's issue lives in, or throw the reason it
   * cannot be written to. Every outbound write goes through here so a
   * misconfigured repository or a missing credential is reported once, in one
   * wording, instead of as a raw API error.
   */
  private writeTarget(taskId: string): { gh: GitHubTaskMetadata; config: ResolvedGitHubRepoConfig } {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) {
      throw new Error('task is not linked to a GitHub issue')
    }
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) {
      throw new Error(`repository ${gh.owner}/${gh.repository} is not configured`)
    }
    if (!this.client.hasCredential()) {
      throw new Error('no GitHub API credential available')
    }
    return { gh, config }
  }

  /**
   * Post one comment on a task's issue.
   *
   * The body is bounded here rather than at the REST layer: an agent that
   * pastes a whole transcript into a comment is making a mistake the user
   * would have to undo on GitHub, so the call is refused instead of truncated
   * into something the agent did not write.
   *
   * @param taskId - the task whose issue receives the comment.
   * @param body - the Markdown comment body.
   * @returns the created comment's number and URL.
   */
  async postComment(taskId: string, body: string): Promise<{ id: number; url: string }> {
    const text = body.trim()
    if (text === '') throw new Error('a comment needs a non-empty body')
    if (text.length > GITHUB_COMMENT_MAX_CHARS) {
      throw new Error(`the comment body is ${text.length} characters; the limit is ${GITHUB_COMMENT_MAX_CHARS}`)
    }
    const { gh, config } = this.writeTarget(taskId)
    const comment = await this.client.createComment(config.owner, config.repository, gh.issueNumber, text)
    this.writePayload(taskId, { lastSyncedAt: this.now(), lastSyncError: undefined })
    return { id: comment.id, url: comment.html_url }
  }

  /**
   * Close a task's issue.
   *
   * Guarded: an issue closes only once the card's pull request is MERGED. A
   * successful local run is not a reviewed change, and closing the issue from
   * it would strand a reviewer with no place to push back. The same guard the
   * merge-driven automatic closure uses applies to the agent-initiated one, so
   * the two paths can never disagree about when the work landed.
   *
   * @param taskId - the task whose issue is closed.
   * @returns the issue number and its new state.
   */
  async closeIssue(taskId: string): Promise<{ issueNumber: number; state: 'closed' }> {
    const { gh, config } = this.writeTarget(taskId)
    if (gh.remoteState === 'closed') return { issueNumber: gh.issueNumber, state: 'closed' }
    const pullRequest = gh.pullRequest
    if (pullRequest === undefined) {
      throw new Error(`issue #${gh.issueNumber} has no linked pull request, so there is no merged work to close it with`)
    }
    // Trust the remote over the cached flag: a PR merged since the last sync
    // must not be reported as unmerged just because the card is stale.
    const live = await this.client.getPullRequest(config.owner, config.repository, pullRequest.number)
    const merged = live.merged === true || pullRequest.state === 'merged'
    if (!merged) {
      throw new Error(`pull request #${pullRequest.number} is not merged yet, so the issue stays open`)
    }
    await this.client.updateIssue(config.owner, config.repository, gh.issueNumber, { state: 'closed' })
    this.writePayload(taskId, {
      remoteState: 'closed',
      lastSyncedAt: this.now(),
      lastSyncError: undefined,
    })
    return { issueNumber: gh.issueNumber, state: 'closed' }
  }

  /** Write back local status changes to GitHub state labels. Never throws. */
  async writeBackTaskStatus(taskId: string, targetStatus: TaskStatus): Promise<void> {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) return
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined || !this.client.hasCredential()) return

    const now = this.now()
    const prActive = gh.pullRequest !== undefined && gh.pullRequest.state === 'open'
    const { labelsToAdd, labelsToRemove } = computeLabelWriteBack(gh.remoteLabels, targetStatus, prActive, config)

    if (labelsToAdd.length === 0 && labelsToRemove.length === 0) return

    try {
      if (labelsToAdd.length > 0) {
        await this.client.addIssueLabels(config.owner, config.repository, gh.issueNumber, labelsToAdd)
      }
      for (const remove of labelsToRemove) {
        await this.client.removeIssueLabel(config.owner, config.repository, gh.issueNumber, remove)
      }
      const nextLabels = [
        ...gh.remoteLabels.filter((l: string) => !labelsToRemove.includes(l)),
        ...labelsToAdd.filter((l: string) => !gh.remoteLabels.includes(l)),
      ]
      this.writePayload(task.id, {
        remoteLabels: nextLabels,
        lastSyncedAt: now,
        lastSyncError: undefined,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.writePayload(task.id, { lastSyncError: msg })
    }
  }

  /**
   * Handle task execution settlement.
   * Auto PR creation triggers if enabled on repo and execution succeeded.
   */
  async handleExecutionSettled(taskId: string, execution: ExecutionRecord): Promise<void> {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) return
    if (gh.remoteClose?.state === 'deferred' && gh.remoteClose.executionId === execution.id) {
      this.writePayload(taskId, {
        remoteClose: { state: 'settled', executionId: execution.id, settledStatus: task.status },
      })
    }
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) return

    // Write back status (e.g. done or failed)
    await this.writeBackTaskStatus(taskId, task.status)

    // Auto PR creation check
    if (execution.result === 'succeeded' && config.prCreationEnabled && gh.pullRequest === undefined) {
      // Look for candidate remote branch
      const candidates = [
        `issue-${String(gh.issueNumber)}`,
        `dsh/issue-${String(gh.issueNumber)}`,
        `task-${task.id.slice(0, 8)}`,
      ]
      let matchedBranch: string | undefined
      for (const candidate of candidates) {
        try {
          const branch = await this.client.getBranch(config.owner, config.repository, candidate)
          if (branch !== null) {
            matchedBranch = candidate
            break
          }
        } catch {
          // ignore probe error
        }
      }

      if (matchedBranch !== undefined) {
        try {
          await this.createPullRequest(taskId, { headBranch: matchedBranch })
        } catch (error) {
          // PR creation failure must NEVER fail the task execution
          const message = error instanceof Error ? error.message : String(error)
          this.writePayload(taskId, {
            lastSyncError: `Auto PR creation failed: ${message}`,
          })
        }
      } else {
        this.writePayload(taskId, {
          lastSyncError: `Auto PR creation skipped: remote branch not found (tried: ${candidates.join(', ')})`,
        })
      }
    }
  }

  /**
   * Create a GitHub pull request for a task.
   * Verifies that the head branch exists on remote before creating the PR.
   */
  async createPullRequest(
    taskId: string,
    input: { headBranch: string; baseBranch?: string; title?: string; body?: string; draft?: boolean },
  ): Promise<GitHubPullRequestMetadata> {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) {
      throw new Error('task is not linked to a GitHub issue')
    }
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) {
      throw new Error(`repository ${gh.owner}/${gh.repository} is not configured`)
    }
    if (!this.client.hasCredential()) {
      throw new Error('no GitHub API credential available')
    }

    const headBranch = input.headBranch.trim()
    if (headBranch === '') throw new Error('headBranch is required')
    const baseBranch = (input.baseBranch ?? config.baseBranch).trim()

    // Verify head branch exists on remote
    const branch = await this.client.getBranch(config.owner, config.repository, headBranch)
    if (branch === null) {
      throw new Error(`branch "${headBranch}" does not exist on remote`)
    }

    const title = (input.title ?? task.title).trim()
    const fixesClause = `Fixes #${String(gh.issueNumber)}`
    const body = input.body !== undefined
      ? input.body
      : `${fixesClause}\n\n${task.description}`.trim()

    const draft = input.draft ?? (config.draftPrPolicy === 'draft')

    const prPayload = await this.client.createPullRequest(config.owner, config.repository, {
      title,
      head: headBranch,
      base: baseBranch,
      body,
      draft,
    })

    const now = this.now()
    // A tool result has to be lossless JSON, so an absent optional is left
    // out of the object rather than stored as an undefined value.
    const mergedAt = prPayload.merged_at === undefined || prPayload.merged_at === null
      ? undefined
      : Date.parse(prPayload.merged_at)
    const pullRequest: GitHubPullRequestMetadata = {
      number: prPayload.number,
      url: prPayload.html_url,
      state: prPayload.state === 'closed' ? (prPayload.merged ? 'merged' : 'closed') : 'open',
      ...(prPayload.draft === true ? { draft: true } : {}),
      headBranch,
      baseBranch,
      ...(mergedAt === undefined || Number.isNaN(mergedAt) ? {} : { mergedAt }),
    }

    // Add PR phase label
    try {
      await this.client.addIssueLabels(config.owner, config.repository, gh.issueNumber, [config.prPhaseLabel])
    } catch {
      // non-fatal
    }

    const nextLabels = gh.remoteLabels.includes(config.prPhaseLabel)
      ? gh.remoteLabels
      : [...gh.remoteLabels, config.prPhaseLabel]

    this.writePayload(task.id, {
      pullRequest,
      remoteLabels: nextLabels,
      lastSyncedAt: now,
      lastSyncError: undefined,
    })

    return pullRequest
  }

  /** Link an existing GitHub pull request to a task. */
  async linkPullRequest(taskId: string, pullRequestNumber: number): Promise<GitHubPullRequestMetadata> {
    const task = this.host.tasks.get(taskId)
    const gh = this.metadataOf(task)
    if (task === undefined || gh === undefined) {
      throw new Error('task is not linked to a GitHub issue')
    }
    const config = this.findRepoConfig(gh.owner, gh.repository)
    if (config === undefined) {
      throw new Error(`repository ${gh.owner}/${gh.repository} is not configured`)
    }
    if (!this.client.hasCredential()) {
      throw new Error('no GitHub API credential available')
    }

    const prPayload = await this.client.getPullRequest(config.owner, config.repository, pullRequestNumber)
    const now = this.now()

    // A tool result has to be lossless JSON, so an absent optional is left
    // out of the object rather than stored as an undefined value.
    const mergedAt = prPayload.merged_at === undefined || prPayload.merged_at === null
      ? undefined
      : Date.parse(prPayload.merged_at)
    const pullRequest: GitHubPullRequestMetadata = {
      number: prPayload.number,
      url: prPayload.html_url,
      state: prPayload.state === 'closed' ? (prPayload.merged ? 'merged' : 'closed') : 'open',
      ...(prPayload.draft === true ? { draft: true } : {}),
      ...(prPayload.head === undefined ? {} : { headBranch: prPayload.head.ref }),
      ...(prPayload.base === undefined ? {} : { baseBranch: prPayload.base.ref }),
      ...(mergedAt === undefined || Number.isNaN(mergedAt) ? {} : { mergedAt }),
    }

    // Add PR phase label
    try {
      await this.client.addIssueLabels(config.owner, config.repository, gh.issueNumber, [config.prPhaseLabel])
    } catch {
      // non-fatal
    }

    const nextLabels = gh.remoteLabels.includes(config.prPhaseLabel)
      ? gh.remoteLabels
      : [...gh.remoteLabels, config.prPhaseLabel]

    this.writePayload(task.id, {
      pullRequest,
      remoteLabels: nextLabels,
      lastSyncedAt: now,
      lastSyncError: undefined,
    })

    return pullRequest
  }

  /**
   * Check PR status for a task, handling merge detection and issue closure.
   */
  private async checkPullRequestStatus(
    task: TaskRecord,
    config: ResolvedGitHubRepoConfig,
  ): Promise<TaskRecord> {
    const gh = this.metadataOf(task)
    if (gh?.pullRequest === undefined) return task
    const currentPr = gh.pullRequest
    if (currentPr.state === 'merged') return task

    try {
      const pr = await this.client.getPullRequest(config.owner, config.repository, currentPr.number)
      const now = this.now()
      const isMerged = pr.merged === true
      const isClosed = pr.state === 'closed'

      if (isMerged) {
        const mergedAt = pr.merged_at ? Date.parse(pr.merged_at) : now
        const updatedPr: GitHubPullRequestMetadata = {
          ...currentPr,
          state: 'merged',
          mergedAt: Number.isFinite(mergedAt) ? mergedAt : now,
        }

        // Remove PR phase label and add/keep done state label
        const labelsToRemove = [config.prPhaseLabel]
        const labelsToAdd = [config.stateLabels.done]
        try {
          await this.client.removeIssueLabel(config.owner, config.repository, gh.issueNumber, config.prPhaseLabel)
          await this.client.addIssueLabels(config.owner, config.repository, gh.issueNumber, labelsToAdd)
        } catch {
          // non-fatal
        }

        let nextRemoteState = gh.remoteState
        if (config.closeIssueOnMerge && gh.remoteState !== 'closed') {
          try {
            await this.client.updateIssue(config.owner, config.repository, gh.issueNumber, { state: 'closed' })
            nextRemoteState = 'closed'
          } catch {
            // non-fatal
          }
        }

        const nextLabels = [
          ...gh.remoteLabels.filter((l: string) => !labelsToRemove.includes(l)),
          ...labelsToAdd.filter((l: string) => !gh.remoteLabels.includes(l)),
        ]

        return {
          ...task,
          integrations: {
            ...task.integrations,
            github: {
              ...gh,
              remoteState: nextRemoteState,
              remoteLabels: nextLabels,
              pullRequest: updatedPr,
              lastSyncedAt: now,
              lastSyncError: undefined,
            },
          },
        }
      } else if (isClosed) {
        // Closed without merge: update PR state, remove PR phase label, DO NOT close issue
        const updatedPr: GitHubPullRequestMetadata = { ...currentPr, state: 'closed' }
        try {
          await this.client.removeIssueLabel(config.owner, config.repository, gh.issueNumber, config.prPhaseLabel)
        } catch {
          // non-fatal
        }
        const nextLabels = gh.remoteLabels.filter((l: string) => l !== config.prPhaseLabel)
        return {
          ...task,
          integrations: {
            ...task.integrations,
            github: {
              ...gh,
              remoteLabels: nextLabels,
              pullRequest: updatedPr,
              lastSyncedAt: now,
              lastSyncError: undefined,
            },
          },
        }
      }
    } catch {
      // non-fatal on PR check
    }

    return task
  }

  /** List all tasks carrying GitHub integration metadata. */
  listTasks(filter: { owner?: string; repository?: string; state?: 'open' | 'closed' | 'all'; hasPr?: boolean } = {}): TaskRecord[] {
    return (this.host.tasks.list() as TaskRecord[]).filter((task: TaskRecord) => {
      const gh = this.metadataOf(task)
      if (gh === undefined) return false
      if (filter.owner !== undefined && gh.owner.toLowerCase() !== filter.owner.toLowerCase()) return false
      if (filter.repository !== undefined && gh.repository.toLowerCase() !== filter.repository.toLowerCase()) return false
      if (filter.state !== undefined && filter.state !== 'all') {
        if (gh.remoteState !== filter.state) return false
      }
      if (filter.hasPr !== undefined) {
        const has = gh.pullRequest !== undefined
        if (filter.hasPr !== has) return false
      }
      return true
    })
  }

  /** Summary of configured repositories and credential state for snapshot. */
  snapshotSummary(): {
    enabled: boolean
    repositories: Array<{
      owner: string
      repository: string
      inclusionLabel: string
      prCreationEnabled: boolean
      hasCredential: boolean
    }>
    hasCredential: boolean
    /**
     * Sync health travels WITH the summary so a stalled poll is visible on the
     * board itself. Every other field here describes configuration, which is
     * what made a broken poll look like a healthy one: the repositories and
     * the credential were all correct while nothing had synced for hours.
     */
    health: {
      running: boolean
      inFlight: boolean
      lastSyncAt?: number
      lastErrors: string[]
      consecutiveEmptySyncs: number
      staleSince?: number
      staleAfterMs?: number
    }
  } {
    const hasCred = this.client.hasCredential()
    return {
      enabled: this.repositories.length > 0,
      hasCredential: hasCred,
      repositories: this.repositories.map(r => ({
        owner: r.owner,
        repository: r.repository,
        inclusionLabel: r.inclusionLabel,
        prCreationEnabled: r.prCreationEnabled,
        hasCredential: hasCred,
      })),
      health: this.syncHealth(),
    }
  }
}
