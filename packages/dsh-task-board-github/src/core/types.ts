/**
 * Pure domain types and validation for the GitHub task-board integration.
 *
 * Framework-free and shared by both halves of this bundle: the host half reads
 * and writes the payload the board stores opaquely under this extension's id,
 * and the browser half renders the same shape. Nothing here imports a board
 * module — the identity of a card is this provider's own data, carried inside
 * the board's opaque `integrations` container under the key `github`.
 *
 * @module dsh-task-board-github/core/types
 */
import { normalizeIssueAnalysis, type IssueAnalysis } from './prompt.ts'
import type { TaskStatus } from './task-record.ts'

/**
 * Stable extension id. It is the key this provider's payload is stored under in
 * the board's integrations container, the id its browser half dispatches under,
 * and the id both halves share without importing the other's half.
 */
export const GITHUB_EXTENSION_ID = 'github'

/**
 * Longest comment body the extension will transmit to an issue.
 *
 * GitHub's own limit is 65536 characters; this is deliberately lower. A
 * comment that long is a transcript, not a report, and the agent should hand
 * back a verdict with a link instead.
 */
export const GITHUB_COMMENT_MAX_CHARS = 16_000

/** A model-written issue analysis as stored on a card, with its provenance. */
export interface GitHubPromptAnalysis extends IssueAnalysis {
  /** Fingerprint of the issue title and body the analysis was written from. */
  sourceHash: string
  /** Qualified provider/model route that wrote it. */
  model: string
  /** Instant it was written (ms epoch). */
  generatedAt: number
}

/** First-class pull request metadata stored on a task. */
export interface GitHubPullRequestMetadata {
  /** Pull request number on GitHub. */
  number: number
  /** HTML URL of the pull request. */
  url: string
  /** Settled or current lifecycle state. */
  state: 'open' | 'closed' | 'merged'
  /** Whether the PR was created as a draft. */
  draft?: boolean
  /** Head branch name. */
  headBranch?: string
  /** Base target branch name. */
  baseBranch?: string
  /** Instant when the PR was merged (ms epoch). */
  mergedAt?: number
}

/** Local synchronization state for one remote close cycle. */
export interface GitHubRemoteCloseSync {
  /**
   * auto-done: this provider moved the card to done for the current close.
   * overridden: a local move wins until the issue reopens and closes again.
   * deferred: a running execution must settle before any close migration.
   * settled: the deferred execution settled; the next sync may migrate it.
   */
  state: 'auto-done' | 'overridden' | 'deferred' | 'settled'
  /** Open execution whose settlement the close migration waits for. */
  executionId?: string
  /** Column captured immediately after that execution settled. */
  settledStatus?: TaskStatus
}

/** External provider metadata attached to a task synchronized with GitHub. */
export interface GitHubTaskMetadata {
  provider: 'github'
  /** Repository owner (organization or user). */
  owner: string
  /** Repository name. */
  repository: string
  /** Issue number. */
  issueNumber: number
  /** GraphQL Node ID (optional, for stable node queries). */
  issueNodeId?: string
  /** HTML URL of the issue. */
  issueUrl: string
  /** Remote issue title from last sync. */
  remoteTitle?: string
  /** Remote issue body from last sync. */
  remoteBody?: string
  /** Remote issue state ('open' | 'closed'). */
  remoteState?: 'open' | 'closed'
  /** Provenance and deferral state for the current remote close cycle. */
  remoteClose?: GitHubRemoteCloseSync
  /**
   * Remote GitHub labels on the issue: separate from TaskTag,
   * not subject to 8-tag limit, never injected as promptPrefix.
   */
  remoteLabels: string[]
  /** Clock instant of last successful sync (ms epoch). */
  lastSyncedAt?: number
  /** Clock instant when the remote issue was last updated on GitHub (ms epoch). */
  lastRemoteUpdatedAt?: number
  /** Last sync or PR creation failure message, if any. */
  lastSyncError?: string
  /** Associated pull request metadata. */
  pullRequest?: GitHubPullRequestMetadata
  /**
   * True when the issue currently lacks the inclusion label on GitHub;
   * hides the card from active board columns without deleting history.
   */
  deactivated?: boolean
  /**
   * Fingerprint of the execution prompt the provider last generated for this
   * card. A card whose prompt no longer matches it was edited by somebody, and
   * synchronization keeps that prompt instead of regenerating it.
   */
  promptHash?: string
  /** The model-written analysis the generated prompt includes while it is fresh. */
  analysis?: GitHubPromptAnalysis
  /** Instant an analysis request started, while one is in flight. */
  analysisPendingSince?: number
  /** Why the last analysis request failed, until the next one starts. */
  analysisError?: string
}

/** Configured state labels for projecting task status into GitHub labels. */
export interface GitHubStateLabels {
  backlog?: string
  todo?: string
  running?: string
  done?: string
  failed?: string
}

/** Configuration for one GitHub repository synchronized with the board. */
export interface GitHubRepoConfig {
  /** Repository owner. */
  owner: string
  /** Repository name. */
  repository: string
  /** Label that designates an issue for import (default: 'dsh'). */
  inclusionLabel?: string
  /**
   * GitHub login whose assigned issues are included as well — {@link ME_ASSIGNEE}
   * for the account the host is authenticated as. An issue is on the board when
   * it carries the inclusion label OR is assigned to this login.
   */
  assignee?: string
  /**
   * Whether issues with no assignee at all are included. Off by default, so a
   * repository keeps importing only the issues its other channels select until
   * this is turned on deliberately.
   */
  includeUnassigned?: boolean
  /** Prefix for DSH-owned labels (default: 'dsh:'). */
  managedLabelPrefix?: string
  /** Status-to-label mappings. */
  stateLabels?: GitHubStateLabels
  /** Label indicating a PR is active (default: 'dsh:phase:pr'). */
  prPhaseLabel?: string
  /** Background polling interval in ms; 0 or undefined to disable (default: 300_000). */
  pollingIntervalMs?: number
  /** Whether automatic PR creation upon task completion is enabled (default: false). */
  prCreationEnabled?: boolean
  /** Whether created PRs should be draft (default: 'draft'). */
  draftPrPolicy?: 'draft' | 'ready'
  /** Whether merging the PR should close the linked issue (default: true). */
  closeIssueOnMerge?: boolean
  /** Default base branch for PR creation (default: 'main'). */
  baseBranch?: string
  /**
   * Qualified provider/model the issue analysis of this repository's cards
   * uses when a request names none (default: the card's pinned model, then the
   * host default).
   */
  analysisModel?: string
}

/** Resolved repository configuration with defaults applied. */
export interface ResolvedGitHubRepoConfig {
  readonly owner: string
  readonly repository: string
  readonly inclusionLabel: string
  /** Resolved inclusion assignee (lowercased login), or undefined when none is configured. */
  readonly assignee?: string
  /** Whether issues carrying no assignee at all are included. */
  readonly includeUnassigned: boolean
  readonly managedLabelPrefix: string
  readonly stateLabels: Required<GitHubStateLabels>
  readonly prPhaseLabel: string
  readonly pollingIntervalMs: number
  readonly prCreationEnabled: boolean
  readonly draftPrPolicy: 'draft' | 'ready'
  readonly closeIssueOnMerge: boolean
  readonly baseBranch: string
  /** Analysis model route, or undefined when none is configured. */
  readonly analysisModel?: string
}

export const DEFAULT_INCLUSION_LABEL = 'dsh'

/** Assignee value meaning "the account this host is authenticated as". */
export const ME_ASSIGNEE = '@me'
export const DEFAULT_MANAGED_LABEL_PREFIX = 'dsh:'
export const DEFAULT_PR_PHASE_LABEL = 'dsh:phase:pr'
export const DEFAULT_POLLING_INTERVAL_MS = 300_000
export const DEFAULT_BASE_BRANCH = 'main'

/** Resolve a repository configuration by filling canonical defaults. */
export function resolveRepoConfig(raw: GitHubRepoConfig): ResolvedGitHubRepoConfig {
  const prefix = (raw.managedLabelPrefix ?? DEFAULT_MANAGED_LABEL_PREFIX).trim()
  return {
    owner: raw.owner.trim(),
    repository: raw.repository.trim(),
    inclusionLabel: (raw.inclusionLabel ?? DEFAULT_INCLUSION_LABEL).trim(),
    ...(assigneeOf(raw.assignee) === undefined ? {} : { assignee: assigneeOf(raw.assignee)! }),
    includeUnassigned: raw.includeUnassigned === true,
    managedLabelPrefix: prefix,
    stateLabels: {
      backlog: raw.stateLabels?.backlog ?? `${prefix}state:backlog`,
      todo: raw.stateLabels?.todo ?? `${prefix}state:todo`,
      running: raw.stateLabels?.running ?? `${prefix}state:running`,
      done: raw.stateLabels?.done ?? `${prefix}state:done`,
      failed: raw.stateLabels?.failed ?? `${prefix}state:failed`,
    },
    prPhaseLabel: raw.prPhaseLabel ?? DEFAULT_PR_PHASE_LABEL,
    pollingIntervalMs: typeof raw.pollingIntervalMs === 'number' && raw.pollingIntervalMs >= 0
      ? raw.pollingIntervalMs
      : DEFAULT_POLLING_INTERVAL_MS,
    prCreationEnabled: raw.prCreationEnabled === true,
    draftPrPolicy: raw.draftPrPolicy === 'ready' ? 'ready' : 'draft',
    closeIssueOnMerge: raw.closeIssueOnMerge !== false,
    baseBranch: (raw.baseBranch ?? DEFAULT_BASE_BRANCH).trim(),
    ...((raw.analysisModel ?? '').trim() === '' ? {} : { analysisModel: raw.analysisModel!.trim() }),
  }
}

/**
 * Resolve one configured assignee to the form the inclusion rule compares:
 * trimmed and lowercased, with {@link ME_ASSIGNEE} kept as it is so the host
 * can substitute the authenticated login before syncing. Absent or empty means
 * "no assignee channel".
 * @param value - the configured value.
 * @returns the resolved value, or undefined when the channel is off.
 */
export function assigneeOf(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? undefined : trimmed.toLowerCase()
}

/** Validate whether a value is a structural GitHubTaskMetadata object. */
export function isGitHubTaskMetadata(value: unknown): value is GitHubTaskMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const gh = value as Record<string, unknown>
  if (gh.provider !== 'github') return false
  if (typeof gh.owner !== 'string' || gh.owner.trim() === '') return false
  if (typeof gh.repository !== 'string' || gh.repository.trim() === '') return false
  if (typeof gh.issueNumber !== 'number' || !Number.isInteger(gh.issueNumber) || gh.issueNumber <= 0) return false
  if (typeof gh.issueUrl !== 'string' || gh.issueUrl.trim() === '') return false
  if (!Array.isArray(gh.remoteLabels) || !gh.remoteLabels.every(l => typeof l === 'string')) return false
  if (gh.remoteState !== undefined && gh.remoteState !== 'open' && gh.remoteState !== 'closed') return false
  if (gh.pullRequest !== undefined) {
    if (typeof gh.pullRequest !== 'object' || gh.pullRequest === null || Array.isArray(gh.pullRequest)) return false
    const pr = gh.pullRequest as Record<string, unknown>
    if (typeof pr.number !== 'number' || !Number.isInteger(pr.number) || pr.number <= 0) return false
    if (typeof pr.url !== 'string' || pr.url.trim() === '') return false
    if (pr.state !== 'open' && pr.state !== 'closed' && pr.state !== 'merged') return false
  }
  return true
}

/**
 * Validate and repair this provider's own payload.
 *
 * The board stores the payload opaquely, so it may come back from an older
 * write, a hand-edited ledger, or a future version that added a field. A value
 * that does not match this provider's shape is treated as absent rather than
 * crashing the provider; a matching value is rebuilt field by field so unknown
 * keys and non-finite stamps never reach the caller.
 * @param value - candidate payload.
 * @returns the repaired metadata, or undefined when it is not this shape.
 */
function normalizeRemoteClose(value: unknown): GitHubTaskMetadata['remoteClose'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const state = candidate.state
  if (state !== 'auto-done' && state !== 'overridden' && state !== 'deferred' && state !== 'settled') return undefined
  const executionId = typeof candidate.executionId === 'string' && candidate.executionId !== '' ? candidate.executionId : undefined
  const status = candidate.settledStatus
  const settledStatus = status === 'backlog' || status === 'todo' || status === 'running' || status === 'done' || status === 'failed' ? status : undefined
  if (state === 'settled' && settledStatus === undefined) return undefined
  return {
    state,
    ...(executionId === undefined ? {} : { executionId }),
    ...(settledStatus === undefined ? {} : { settledStatus }),
  }
}

export function normalizeGitHubMetadata(value: unknown): GitHubTaskMetadata | undefined {
  if (!isGitHubTaskMetadata(value)) return undefined
  const gh = value as GitHubTaskMetadata & Record<string, unknown>

  let pullRequest: GitHubPullRequestMetadata | undefined
  if (gh.pullRequest !== undefined) {
    pullRequest = {
      number: gh.pullRequest.number,
      url: gh.pullRequest.url.trim(),
      state: gh.pullRequest.state,
      ...(gh.pullRequest.draft === true ? { draft: true } : {}),
      ...(typeof gh.pullRequest.headBranch === 'string' && gh.pullRequest.headBranch !== '' ? { headBranch: gh.pullRequest.headBranch } : {}),
      ...(typeof gh.pullRequest.baseBranch === 'string' && gh.pullRequest.baseBranch !== '' ? { baseBranch: gh.pullRequest.baseBranch } : {}),
      ...(typeof gh.pullRequest.mergedAt === 'number' && Number.isFinite(gh.pullRequest.mergedAt) ? { mergedAt: gh.pullRequest.mergedAt } : {}),
    }
  }

  const analysis = normalizeStoredAnalysis(gh.analysis)
  const remoteClose = normalizeRemoteClose(gh.remoteClose)

  return {
    provider: 'github',
    owner: gh.owner.trim(),
    repository: gh.repository.trim(),
    issueNumber: gh.issueNumber,
    issueUrl: gh.issueUrl.trim(),
    remoteLabels: [...gh.remoteLabels],
    ...(typeof gh.issueNodeId === 'string' && gh.issueNodeId !== '' ? { issueNodeId: gh.issueNodeId } : {}),
    ...(typeof gh.remoteTitle === 'string' ? { remoteTitle: gh.remoteTitle } : {}),
    ...(typeof gh.remoteBody === 'string' ? { remoteBody: gh.remoteBody } : {}),
    ...(gh.remoteState !== undefined ? { remoteState: gh.remoteState } : {}),
    ...(remoteClose === undefined ? {} : { remoteClose }),
    ...(typeof gh.lastSyncedAt === 'number' && Number.isFinite(gh.lastSyncedAt) ? { lastSyncedAt: gh.lastSyncedAt } : {}),
    ...(typeof gh.lastRemoteUpdatedAt === 'number' && Number.isFinite(gh.lastRemoteUpdatedAt) ? { lastRemoteUpdatedAt: gh.lastRemoteUpdatedAt } : {}),
    ...(typeof gh.lastSyncError === 'string' && gh.lastSyncError !== '' ? { lastSyncError: gh.lastSyncError } : {}),
    ...(pullRequest !== undefined ? { pullRequest } : {}),
    ...(gh.deactivated === true ? { deactivated: true } : {}),
    ...(typeof gh.promptHash === 'string' && gh.promptHash !== '' ? { promptHash: gh.promptHash } : {}),
    ...(analysis !== undefined ? { analysis } : {}),
    ...(typeof gh.analysisPendingSince === 'number' && Number.isFinite(gh.analysisPendingSince) ? { analysisPendingSince: gh.analysisPendingSince } : {}),
    ...(typeof gh.analysisError === 'string' && gh.analysisError !== '' ? { analysisError: gh.analysisError } : {}),
  }
}

/**
 * Repair one stored analysis: the analysis fields are re-bounded, and the
 * provenance fields must all be present or the whole entry reads as absent.
 * @param value - candidate stored analysis.
 * @returns the repaired analysis, or undefined.
 */
export function normalizeStoredAnalysis(value: unknown): GitHubPromptAnalysis | undefined {
  const analysis = normalizeIssueAnalysis(value)
  if (analysis === undefined) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.sourceHash !== 'string' || raw.sourceHash === '') return undefined
  if (typeof raw.model !== 'string' || raw.model === '') return undefined
  if (typeof raw.generatedAt !== 'number' || !Number.isFinite(raw.generatedAt)) return undefined
  return { ...analysis, sourceHash: raw.sourceHash, model: raw.model, generatedAt: raw.generatedAt }
}

/**
 * Read a task's GitHub metadata out of the board's opaque integrations container.
 * @param task - the task to read.
 * @returns the repaired metadata, or undefined when the task carries none.
 */
export function readTaskGitHubMetadata(
  task: { integrations?: Record<string, unknown> } | undefined,
): GitHubTaskMetadata | undefined {
  return normalizeGitHubMetadata(task?.integrations?.github)
}

/** Wire payload for a GitHub issue returned by the GitHub REST API. */
export interface GitHubIssuePayload {
  number: number
  node_id?: string
  title: string
  body?: string | null
  state: 'open' | 'closed'
  html_url: string
  labels: Array<{ name: string } | string>
  /** Users the issue is assigned to, as the REST listing returns them. */
  assignees?: Array<{ login?: string } | string> | null
  updated_at: string
  pull_request?: unknown
}

/** Wire payload for one issue comment returned by the GitHub REST API. */
export interface GitHubCommentPayload {
  id: number
  /** HTML URL of the comment, safe to hand back to the agent. */
  html_url: string
  /** Comment body as stored on GitHub. */
  body?: string | null
}

/** Wire payload for a GitHub pull request returned by the GitHub REST API. */
export interface GitHubPullRequestPayload {
  number: number
  html_url: string
  state: 'open' | 'closed'
  draft?: boolean
  merged?: boolean
  merged_at?: string | null
  head: { ref: string }
  base: { ref: string }
}
