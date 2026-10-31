/**
 * Pure projection and reconciliation logic for GitHub issue integration.
 *
 * Implements:
 * - Controlled label write-back (only DSH-managed labels modified).
 * - Projection into existing kanban columns without a secondary state machine.
 * - Stable identity reconciliation and deactivation handling.
 *
 * Content immutability is NOT decided here any more: reconciliation always
 * proposes the remote title/body, and the board's own content gate refuses the
 * patch when the card has started executing. The provider therefore has no
 * second opinion about which cards are frozen.
 *
 * @module dsh-task-board-github/core/projection
 */

import type { TaskRecord, TaskStatus } from './task-record.ts'
import {
  buildIssuePrompt,
  fingerprint,
  isPromptEdited,
  issueSourceHash,
} from './prompt.ts'
import {
  readTaskGitHubMetadata,
  type GitHubIssuePayload,
  type GitHubPromptAnalysis,
  type GitHubRemoteCloseSync,
  type ResolvedGitHubRepoConfig,
} from './types.ts'

/** Check if a GitHub label is owned and managed by the DSH task board integration. */
export function isDshManagedLabel(labelName: string, config: ResolvedGitHubRepoConfig): boolean {
  if (labelName === config.prPhaseLabel) return true
  const stateLabels = Object.values(config.stateLabels)
  if (stateLabels.includes(labelName)) return true
  return config.managedLabelPrefix !== '' && labelName.startsWith(config.managedLabelPrefix)
}

/**
 * Compute the exact label changes required to project a task's lifecycle onto GitHub.
 *
 * Guaranteed contract:
 * - ONLY DSH-managed labels are added or removed.
 * - User/repository labels (e.g. 'bug', 'security', 'priority:high', and the inclusion label)
 *   are left completely untouched.
 */
export function computeLabelWriteBack(
  currentLabels: readonly string[],
  targetStatus: TaskStatus,
  prActive: boolean,
  config: ResolvedGitHubRepoConfig,
): { labelsToAdd: string[]; labelsToRemove: string[] } {
  const currentSet = new Set(currentLabels)
  const allStateLabels = new Set(Object.values(config.stateLabels))
  const targetStateLabel = config.stateLabels[targetStatus]

  const labelsToRemove: string[] = []
  const labelsToAdd: string[] = []

  // Remove any conflicting state label currently on the issue
  for (const label of currentLabels) {
    if (allStateLabels.has(label) && label !== targetStateLabel) {
      labelsToRemove.push(label)
    }
  }

  // Add the target state label if not already present
  if (!currentSet.has(targetStateLabel)) {
    labelsToAdd.push(targetStateLabel)
  }

  // PR phase label handling
  if (prActive) {
    if (!currentSet.has(config.prPhaseLabel)) {
      labelsToAdd.push(config.prPhaseLabel)
    }
  } else if (currentSet.has(config.prPhaseLabel)) {
    labelsToRemove.push(config.prPhaseLabel)
  }

  return { labelsToAdd, labelsToRemove }
}

/**
 * Compute the final set of labels after applying a write-back diff.
 * Preserves the exact ordering of untouched labels and appends new ones.
 */
export function applyLabelWriteBack(
  currentLabels: readonly string[],
  targetStatus: TaskStatus,
  prActive: boolean,
  config: ResolvedGitHubRepoConfig,
): string[] {
  const { labelsToAdd, labelsToRemove } = computeLabelWriteBack(currentLabels, targetStatus, prActive, config)
  const removeSet = new Set(labelsToRemove)
  const result = currentLabels.filter(label => !removeSet.has(label))
  for (const label of labelsToAdd) {
    if (!result.includes(label)) {
      result.push(label)
    }
  }
  return result
}

/**
 * Project remote GitHub labels and state into an initial local task status.
 *
 * Local state machine is authoritative; running remains Host-local.
 * Remote closed issues project to 'done'.
 */
export function resolveStatusFromLabels(
  labels: readonly string[],
  remoteState: 'open' | 'closed' | undefined,
  config: ResolvedGitHubRepoConfig,
): TaskStatus {
  if (remoteState === 'closed') return 'done'
  const set = new Set(labels)
  if (set.has(config.stateLabels.failed)) return 'failed'
  if (set.has(config.stateLabels.done)) return 'done'
  if (set.has(config.stateLabels.backlog)) return 'backlog'
  return 'todo'
}

/**
 * Extract label name strings from a GitHub API issue payload.
 */
export function extractLabelNames(issue: GitHubIssuePayload): string[] {
  return issue.labels.map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean)
}

/**
 * Extract the logins an issue is assigned to, lowercased. The REST listing
 * returns user objects; a hand-built payload may carry plain strings.
 */
export function issueAssignees(issue: GitHubIssuePayload): string[] {
  const assignees = issue.assignees ?? []
  if (!Array.isArray(assignees)) return []
  return assignees
    .map(entry => (typeof entry === 'string' ? entry : entry?.login ?? ''))
    .filter(login => login !== '')
    .map(login => login.toLowerCase())
}

/**
 * Whether one issue belongs on the board.
 *
 * Three channels feed the board and any one of them is enough: the issue
 * carries the repository's inclusion label, it is assigned to the login the
 * repository configured, or the repository opted into issues nobody is
 * assigned to. The host substitutes the authenticated login for
 * {@link ME_ASSIGNEE} before syncing, so this predicate only ever compares
 * concrete logins.
 *
 * The unassigned channel is deliberately narrow: it matches only an issue with
 * no assignee at all, never one assigned to somebody else. A repository that
 * turns it on keeps taking its labeled and self-assigned issues, and gains the
 * unassigned backlog; it does not start taking other people's assignments.
 * @param issue - the remote issue.
 * @param config - the repository configuration (its assignee already resolved).
 * @returns true when the issue is included.
 */
export function isIssueIncluded(issue: GitHubIssuePayload, config: ResolvedGitHubRepoConfig): boolean {
  if (extractLabelNames(issue).includes(config.inclusionLabel)) return true
  const assignees = issueAssignees(issue)
  if (assignees.length === 0) return config.includeUnassigned
  const assignee = config.assignee
  return assignee !== undefined && assignee !== '' && assignees.includes(assignee)
}

/**
 * Compose the execution prompt of one issue under one repository
 * configuration. DSH-managed labels (state and phase labels the provider
 * writes itself) are left out of the header: they describe the board, not the
 * work. A stored analysis is included only while its source fingerprint still
 * matches the issue, so an edited issue never runs with a stale analysis.
 * @param issue - remote issue facts.
 * @param config - repository configuration.
 * @param analysis - the card's stored analysis, if any.
 * @returns the prompt and its fingerprint.
 */
export function composeIssuePrompt(
  issue: { number: number; html_url: string; title: string; body: string; labels: readonly string[] },
  config: ResolvedGitHubRepoConfig,
  analysis?: GitHubPromptAnalysis,
): { prompt: string; promptHash: string } {
  const fresh = analysis !== undefined && analysis.sourceHash === issueSourceHash(issue.title, issue.body)
    ? analysis
    : undefined
  const prompt = buildIssuePrompt(
    {
      owner: config.owner,
      repository: config.repository,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      title: issue.title,
      body: issue.body,
      labels: issue.labels.filter(label => !isDshManagedLabel(label, config) && label !== config.inclusionLabel),
    },
    { baseBranch: config.baseBranch, prCreationEnabled: config.prCreationEnabled },
    fresh,
  )
  return { prompt, promptHash: fingerprint(prompt) }
}

/** Status and close-cycle provenance projected from the latest remote state. */
export interface RemoteCloseTransition {
  status: TaskStatus
  remoteClose?: GitHubRemoteCloseSync
}

/**
 * Reconcile one close cycle without touching the board. The stored provenance
 * lets a later pass distinguish a local override from a status this provider
 * wrote itself, and lets a deferred close settle without interrupting a run.
 */
export function reconcileRemoteClose(
  existing: TaskRecord,
  remoteState: 'open' | 'closed',
): RemoteCloseTransition {
  const previous = readTaskGitHubMetadata(existing)?.remoteClose
  if (remoteState === 'open') {
    const reopen = previous?.state === 'auto-done' && existing.status === 'done' && existing.archivedAt === undefined
    return { status: reopen ? 'todo' : existing.status, remoteClose: undefined }
  }
  if (existing.archivedAt !== undefined) return { status: existing.status, ...(previous === undefined ? {} : { remoteClose: previous }) }
  if (previous?.state === 'overridden') return { status: existing.status, remoteClose: previous }
  if (previous?.state === 'auto-done') {
    if (existing.status === 'done') return { status: 'done', remoteClose: previous }
    return { status: existing.status, remoteClose: { state: 'overridden' } }
  }
  if (previous?.state === 'deferred') {
    if (existing.status === 'running') return { status: 'running', remoteClose: previous }
    return { status: existing.status, remoteClose: { state: 'overridden' } }
  }
  if (previous?.state === 'settled') {
    if (previous.settledStatus !== undefined && existing.status === previous.settledStatus) {
      return { status: 'done', remoteClose: { state: 'auto-done' } }
    }
    return { status: existing.status, remoteClose: { state: 'overridden' } }
  }
  if (existing.status === 'done') return { status: 'done', remoteClose: undefined }
  if (existing.status === 'running') {
    const execution = existing.executions.find(candidate => candidate.result === undefined)
    return {
      status: 'running',
      remoteClose: { state: 'deferred', ...(execution === undefined ? {} : { executionId: execution.id }) },
    }
  }
  return { status: 'done', remoteClose: { state: 'auto-done' } }
}

/**
 * Reconcile a remote GitHub issue with an existing local task record.
 *
 * - Updates remote metadata (remoteTitle, remoteBody, remoteLabels, remoteState, sync stamps).
 * - If the issue stops being included (its inclusion label went away and it is
 *   no longer assigned to the configured login), deactivates the item without
 *   deleting it or its executions.
 * - If it becomes included again, restores the item through the same identity.
 * - Proposes the remote title/description and a regenerated execution prompt;
 *   the board's content gate keeps the recorded content of a card that has
 *   already executed.
 * - Keeps a prompt somebody edited: when the card's prompt no longer matches
 *   the fingerprint of the prompt the provider last generated (or, for a card
 *   that predates fingerprints, the body it was copied from), the prompt is
 *   left as it is and no fingerprint is recorded for it.
 */
export function reconcileIssueWithTask(
  existing: TaskRecord,
  issue: GitHubIssuePayload,
  now: number,
  config: ResolvedGitHubRepoConfig,
): TaskRecord {
  const remoteLabels = extractLabelNames(issue)
  const hasInclusion = isIssueIncluded(issue, config)

  const remoteTitle = issue.title.trim()
  const remoteBody = issue.body != null ? issue.body.trim() : ''

  const remoteUpdatedAt = Date.parse(issue.updated_at)
  const previous = readTaskGitHubMetadata(existing)
  const edited = isPromptEdited(existing.prompt, previous?.promptHash, {
    ...(previous?.remoteTitle === undefined ? {} : { title: previous.remoteTitle }),
    ...(previous?.remoteBody === undefined ? {} : { body: previous.remoteBody }),
  })
  const generated = composeIssuePrompt(
    { number: issue.number, html_url: issue.html_url, title: remoteTitle, body: remoteBody, labels: remoteLabels },
    config,
    previous?.analysis,
  )

  return {
    ...existing,
    title: remoteTitle,
    description: remoteBody,
    prompt: edited ? existing.prompt : generated.prompt,
    updatedAt: now,
    integrations: {
      ...existing.integrations,
      github: {
        provider: 'github',
        owner: config.owner,
        repository: config.repository,
        issueNumber: issue.number,
        issueNodeId: issue.node_id,
        issueUrl: issue.html_url,
        remoteTitle,
        remoteBody,
        remoteState: issue.state === 'closed' ? 'closed' : 'open',
        remoteClose: previous?.remoteClose,
        remoteLabels,
        lastSyncedAt: now,
        lastRemoteUpdatedAt: Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : undefined,
        lastSyncError: undefined,
        pullRequest: previous?.pullRequest,
        deactivated: hasInclusion ? undefined : true,
        // An edited prompt carries no fingerprint, so every later sync keeps
        // reading it as edited and leaves it alone.
        promptHash: edited ? undefined : generated.promptHash,
      },
    },
  }
}

/**
 * Materialize a brand-new TaskRecord from an incoming GitHub issue carrying the inclusion label.
 */
export function materializeTaskFromIssue(
  issue: GitHubIssuePayload,
  id: string,
  now: number,
  config: ResolvedGitHubRepoConfig,
): TaskRecord {
  const remoteLabels = extractLabelNames(issue)
  const remoteTitle = issue.title.trim()
  const remoteBody = issue.body != null ? issue.body.trim() : ''
  const { prompt, promptHash } = composeIssuePrompt(
    { number: issue.number, html_url: issue.html_url, title: remoteTitle, body: remoteBody, labels: remoteLabels },
    config,
  )
  const status = resolveStatusFromLabels(remoteLabels, issue.state, config)
  const remoteUpdatedAt = Date.parse(issue.updated_at)

  return {
    id,
    title: remoteTitle,
    description: remoteBody,
    prompt,
    status,
    createdAt: now,
    updatedAt: now,
    executions: [],
    integrations: {
      github: {
        provider: 'github',
        owner: config.owner,
        repository: config.repository,
        issueNumber: issue.number,
        issueNodeId: issue.node_id,
        issueUrl: issue.html_url,
        remoteTitle,
        remoteBody,
        remoteState: issue.state === 'closed' ? 'closed' : 'open',
        ...(issue.state === 'closed' ? { remoteClose: { state: 'auto-done' as const } } : {}),
        remoteLabels,
        lastSyncedAt: now,
        lastRemoteUpdatedAt: Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : undefined,
        promptHash,
      },
    },
  }
}
