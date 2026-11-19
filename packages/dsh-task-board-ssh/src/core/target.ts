/**
 * The execution target a card pins, and the run record the ledger carries.
 *
 * Both shapes are the wire form: they are what the browser half sends, what the
 * host half stores under `integrations.ssh`, and what an agent tool returns, so
 * both are parsed from `unknown` and never trusted. Parsing reports the exact
 * path of every problem instead of throwing, because a malformed payload
 * arrives from outside the process and must not become an exception in the
 * board's action channel.
 *
 * @module dsh-task-board-ssh/core/target
 */

/** How a pinned card reaches the remote host. */
export type SshExecutionMode = 'direct' | 'proxy'

/** Which agent CLI the remote run starts. */
export const SSH_AGENT_KINDS = ['dsh', 'claude', 'codex', 'custom'] as const

/** Agent CLI the remote run starts. */
export type SshAgentKind = (typeof SSH_AGENT_KINDS)[number]

/** Which filesystem mechanism a run works in. */
export type SshWorkspaceKind = 'in-place' | 'git'

/** Where the git workspace strategy takes its repository from. */
export type SshGitSource =
  | {
      /** A repository the remote host can reach on its own. */
      kind: 'url'
      /** Clone URL: https, ssh or `user@host:path` form. */
      url: string
      /** Branch the per-run worktree starts from; absent uses the remote HEAD. */
      base?: string
    }
  | {
      /** The workspace's local repository, sent to the host as a git bundle. */
      kind: 'workspace'
      /** Workspace id the local repository comes from. */
      workspaceId: string
    }

/** Run in an existing remote directory. */
export interface SshInPlaceWorkspace {
  /** Discriminator. */
  kind: 'in-place'
  /** Absolute remote directory the agent works in. */
  path: string
}

/** Run in a per-run worktree of a git repository. */
export interface SshGitWorkspace {
  /** Discriminator. */
  kind: 'git'
  /** Repository the worktree branches from. */
  source: SshGitSource
}

/** Filesystem mechanism one run uses. */
export type SshWorkspaceTarget = SshInPlaceWorkspace | SshGitWorkspace

/** Which agent CLI a target pins, and the command template when it is custom. */
export interface SshAgentTarget {
  /** Agent CLI kind. */
  kind: SshAgentKind
  /** Start template of a custom agent; required for, and only read with, `custom`. */
  command?: string
  /** Resume template of a custom agent; absent degrades a follow-up to a fresh run. */
  resumeCommand?: string
}

/** Everything one card pins about where and how it runs. */
export interface SshTarget {
  /** Whether the card runs remotely at all, or through a local session driving the host. */
  mode: SshExecutionMode
  /** `dshSsh` host alias the run addresses. */
  host: string
  /** Agent CLI the remote run starts. */
  agent: SshAgentTarget
  /** Filesystem mechanism the run works in. */
  workspace: SshWorkspaceTarget
}

/** Phase of one remote run, as the ledger records it. */
export type SshRunPhase = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'lost'

/** One terminal phase; nothing schedules more work for a run in one of these. */
export const SSH_TERMINAL_RUN_PHASES: readonly SshRunPhase[] = ['succeeded', 'failed', 'cancelled', 'lost']

/** What a launch record cost and produced: one run of one card on one host. */
export interface SshRunRecord {
  /** Identifier the remote launcher is idempotent on. */
  runId: string
  /** Phase this record was last seen in. */
  phase: SshRunPhase
  /** Instant the run was requested (ms epoch). */
  startedAt: number
  /** Instant the run reached a terminal phase (ms epoch), when it did. */
  finishedAt?: number
  /** Remote exit code, once the run settled. */
  exitCode?: number
  /** Session id the remote agent reported, used to resume it. */
  sessionId?: string
  /** Bytes of the remote stdout log the provider has read. */
  bytes?: number
  /** Branch the git workspace collected, when it produced one. */
  branch?: string
  /** Final summary the remote agent reported, bounded before it lands here. */
  summary?: string
  /** Failure text, bounded before it lands here. */
  error?: string
  /** Follow-up messages delivered into this run's session. */
  followUps?: number
}

/** One diagnostic about a malformed value, addressed by its path inside it. */
export interface SshValidationIssue {
  /** Dotted path of the offending field, empty for the value itself. */
  path: string
  /** What is wrong with it, in one sentence. */
  message: string
}

/** A parse result: the value, or every reason it was refused. */
export type SshValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: readonly SshValidationIssue[] }

/** Host aliases `dshSsh` accepts: letters, digits, dots, hyphens, underscores. */
const HOST_ALIAS_RE = /^[A-Za-z0-9._-]{1,128}$/

/** Longest accepted free text in one target or run field. */
const FIELD_MAX = 2_048

/** Membership test helper that keeps the union narrow without a cast. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/** Whether a value is a plain object (not an array, not null, no exotic prototype). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Whether a string is a usable absolute POSIX path. */
function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\u0000') && !value.includes('\n')
}

/** Collects issues while a parser walks one value. */
class IssueList {
  readonly errors: SshValidationIssue[] = []
  add(path: string, message: string): void {
    this.errors.push({ path, message })
  }
  /** Join a path segment onto a parent path. */
  static join(path: string, key: string | number): string {
    return path === '' ? String(key) : `${path}.${String(key)}`
  }
}

/**
 * Refuse unknown keys so a misspelled field is reported instead of ignored.
 * @param value - plain object being read.
 * @param allowed - keys the shape defines.
 * @param path - path of the object for the diagnostics.
 * @param issues - collector.
 */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: IssueList): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.add(IssueList.join(path, key), `unknown field (accepted: ${allowed.join(', ')})`)
  }
}

/**
 * Read one required bounded string.
 * @param value - candidate field.
 * @param path - path of the field for the diagnostics.
 * @param issues - collector.
 * @returns the text, or undefined when it was refused.
 */
function readText(value: unknown, path: string, issues: IssueList): string | undefined {
  if (typeof value !== 'string') {
    issues.add(path, 'must be a string')
    return undefined
  }
  if (value.length === 0) {
    issues.add(path, 'must not be empty')
    return undefined
  }
  if (value.length > FIELD_MAX) {
    issues.add(path, `must be at most ${FIELD_MAX} characters`)
    return undefined
  }
  return value
}

/** Read the git source of a git workspace. */
function parseGitSource(value: unknown, path: string, issues: IssueList): SshGitSource | undefined {
  if (!isPlainObject(value)) {
    issues.add(path, 'must be an object')
    return undefined
  }
  if (value.kind === 'url') {
    rejectUnknownKeys(value, ['kind', 'url', 'base'], path, issues)
    const url = readText(value.url, IssueList.join(path, 'url'), issues)
    const base = value.base === undefined ? undefined : readText(value.base, IssueList.join(path, 'base'), issues)
    if (url === undefined) return undefined
    if (/\s/.test(url)) {
      issues.add(IssueList.join(path, 'url'), 'must not contain whitespace')
      return undefined
    }
    return base === undefined ? { kind: 'url', url } : { kind: 'url', url, base }
  }
  if (value.kind === 'workspace') {
    rejectUnknownKeys(value, ['kind', 'workspaceId'], path, issues)
    const workspaceId = readText(value.workspaceId, IssueList.join(path, 'workspaceId'), issues)
    return workspaceId === undefined ? undefined : { kind: 'workspace', workspaceId }
  }
  issues.add(IssueList.join(path, 'kind'), 'must be "url" or "workspace"')
  return undefined
}

/** Read the filesystem mechanism of one target. */
function parseWorkspace(value: unknown, path: string, issues: IssueList): SshWorkspaceTarget | undefined {
  if (!isPlainObject(value)) {
    issues.add(path, 'must be an object')
    return undefined
  }
  if (value.kind === 'in-place') {
    rejectUnknownKeys(value, ['kind', 'path'], path, issues)
    const p = readText(value.path, IssueList.join(path, 'path'), issues)
    if (p === undefined) return undefined
    if (!isAbsolutePath(p)) {
      issues.add(IssueList.join(path, 'path'), 'must be an absolute remote path')
      return undefined
    }
    return { kind: 'in-place', path: p }
  }
  if (value.kind === 'git') {
    rejectUnknownKeys(value, ['kind', 'source'], path, issues)
    const source = parseGitSource(value.source, IssueList.join(path, 'source'), issues)
    return source === undefined ? undefined : { kind: 'git', source }
  }
  issues.add(IssueList.join(path, 'kind'), 'must be "in-place" or "git"')
  return undefined
}

/** Read which agent CLI a target pins. */
function parseAgentTarget(value: unknown, path: string, issues: IssueList): SshAgentTarget | undefined {
  if (!isPlainObject(value)) {
    issues.add(path, 'must be an object')
    return undefined
  }
  rejectUnknownKeys(value, ['kind', 'command', 'resumeCommand'], path, issues)
  if (!oneOf(value.kind, SSH_AGENT_KINDS)) {
    issues.add(IssueList.join(path, 'kind'), `must be one of: ${SSH_AGENT_KINDS.join(', ')}`)
    return undefined
  }
  if (value.kind !== 'custom') {
    if (value.command !== undefined || value.resumeCommand !== undefined) {
      issues.add(path, 'command templates apply to kind "custom" only')
      return undefined
    }
    return { kind: value.kind }
  }
  const command = readText(value.command, IssueList.join(path, 'command'), issues)
  const resumeCommand = value.resumeCommand === undefined
    ? undefined
    : readText(value.resumeCommand, IssueList.join(path, 'resumeCommand'), issues)
  if (command === undefined) {
    issues.add(IssueList.join(path, 'command'), 'a custom agent needs a start template')
    return undefined
  }
  if (!command.includes('{prompt_file}')) {
    issues.add(IssueList.join(path, 'command'), 'the start template must reference {prompt_file}')
    return undefined
  }
  return resumeCommand === undefined ? { kind: 'custom', command } : { kind: 'custom', command, resumeCommand }
}

/**
 * Parse one pinned execution target.
 * @param value - candidate target from the wire, the ledger or a settings form.
 * @returns the target, or every reason it was refused.
 */
export function parseSshTarget(value: unknown): SshValidationResult<SshTarget> {
  const issues = new IssueList()
  if (!isPlainObject(value)) return { ok: false, errors: [{ path: '', message: 'must be an object' }] }
  rejectUnknownKeys(value, ['mode', 'host', 'agent', 'workspace'], '', issues)
  if (!oneOf(value.mode, ['direct', 'proxy'] as const)) {
    issues.add('mode', 'must be "direct" or "proxy"')
  }
  const host = typeof value.host === 'string' && HOST_ALIAS_RE.test(value.host) ? value.host : undefined
  if (host === undefined) issues.add('host', 'must be a dshSsh host alias (letters, digits, dots, hyphens, underscores)')
  const agent = parseAgentTarget(value.agent, 'agent', issues)
  const workspace = parseWorkspace(value.workspace, 'workspace', issues)
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
  return { ok: true, value: { mode: value.mode as SshExecutionMode, host: host as string, agent: agent as SshAgentTarget, workspace: workspace as SshWorkspaceTarget } }
}

/**
 * Parse one run record.
 * @param value - candidate record from the ledger or an action payload.
 * @returns the record, or every reason it was refused.
 */
export function parseSshRunRecord(value: unknown): SshValidationResult<SshRunRecord> {
  const issues = new IssueList()
  if (!isPlainObject(value)) return { ok: false, errors: [{ path: '', message: 'must be an object' }] }
  rejectUnknownKeys(
    value,
    ['runId', 'phase', 'startedAt', 'finishedAt', 'exitCode', 'sessionId', 'bytes', 'branch', 'summary', 'error', 'followUps'],
    '',
    issues,
  )
  const runId = typeof value.runId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value.runId) ? value.runId : undefined
  if (runId === undefined) issues.add('runId', 'must be 1-128 characters of letters, digits, dots, underscores or hyphens')
  if (!oneOf(value.phase, ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'lost'] as const)) {
    issues.add('phase', 'must be one of: queued, running, succeeded, failed, cancelled, lost')
  }
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) issues.add('startedAt', 'must be a finite millisecond timestamp')
  for (const key of ['finishedAt', 'exitCode', 'bytes', 'followUps'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) issues.add(key, 'must be a finite number')
  }
  for (const key of ['sessionId', 'branch', 'summary', 'error'] as const) {
    if (value[key] === undefined) continue
    readText(value[key], key, issues)
  }
  if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
  return { ok: true, value: { ...(value as unknown as SshRunRecord) } }
}

/**
 * Whether a run phase is terminal.
 * @param phase - phase to test.
 * @returns true for succeeded, failed, cancelled and lost.
 */
export function isTerminalRunPhase(phase: SshRunPhase): boolean {
  return SSH_TERMINAL_RUN_PHASES.includes(phase)
}
