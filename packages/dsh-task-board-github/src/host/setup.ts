/**
 * The setup operations behind this extension's settings card, its host routes
 * and its agent tools.
 *
 * One implementation serves every writer: the browser card, a model calling a
 * tool and a hand-edited profile patch all end up in the same configuration,
 * so the three cannot drift into three different ideas of what "configured"
 * means. Reads for the summary come from the live config (merged base and user
 * layers with defaults applied); writes go back through the Host settings
 * surface (see ./configuration.ts).
 *
 * @module dsh-task-board-github/host/setup
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  sanitizeProxySettings,
  sanitizeRepositoryList,
  type GitHubConnectionReport,
  type GitHubCredentialStatus,
  type GitHubProxyMode,
  type GitHubProxyStatus,
  type GitHubRepositoryCheck,
  type GitHubSetupSummary,
  type GitHubSyncHealth,
} from '../core/setup.ts'
import type { GitHubRepoConfig } from '../core/types.ts'
import { ME_ASSIGNEE, resolveRepoConfig } from '../core/types.ts'
import { isIssueIncluded } from '../core/projection.ts'
import { GITHUB_API_BASE_URL, GitHubApiClient, GitHubApiError, proxyClientOptions } from './client.ts'
import { clearGitHubToken, describeGitHubCredential, resolveGitHubToken, setGitHubToken } from './credentials.ts'
import { findGitHubSettingsEntry, resolveSettingsFace, writeConfiguredRepositories, writeProxySettings } from './configuration.ts'
import { resolveProxyConfiguration } from './proxy.ts'

/** How one repository is checked during a connection test. */
export interface GitHubSetupTarget {
  /** Repository owner; absent means every configured repository. */
  owner?: string
  /** Repository name; required with owner. */
  repository?: string
}

export interface GitHubSetupOptions {
  /** Host context: the credential seam and the settings surface are read from it. */
  ctx: Context
  /** Live repositories the running configuration serves. */
  repositories(): readonly GitHubRepoConfig[]
  /** Live reference name the token is resolved under. */
  tokenEnv(): string
  /** Whether the provider is mounted right now. */
  running(): boolean
  /**
   * Live sync health of the mounted provider, when one exists.
   *
   * Read at call time rather than captured, so the status route reports the
   * pass in flight right now instead of the one that happened to be running
   * when the settings surface was built.
   */
  health?(): GitHubSyncHealth | undefined
  /**
   * Called after a credential write, so the next request authenticates with
   * the new value instead of the one this process already read.
   */
  reload(): void
  /** Client seam for tests: builds the API client for one resolved token. */
  clientFor?(token: string | undefined): GitHubApiClient
  /** Environment seam for tests. */
  env?: Record<string, string | undefined>
  /** Live proxy mode, read at call time so a settings edit is followed. */
  proxyMode?(): GitHubProxyMode
  /** Live custom proxy URL, read at call time. */
  proxyUrl?(): string
  /**
   * System proxy detection seam.
   *
   * Absent reads the operating system's own proxy (cached, see ./proxy.ts). The
   * seam exists so a test never inherits the machine it happens to run on, and
   * so a deployment that would rather not spawn a child process can say "none".
   */
  detectSystemProxy?(): string | undefined
}

/** The setup surface the routes and tools share. */
export interface GitHubSetup {
  /** Credential facts, configured repositories and mount state. */
  status(): Promise<GitHubSetupSummary>
  /** Live connection test against GitHub. */
  test(target?: GitHubSetupTarget): Promise<GitHubConnectionReport>
  /** Store one token, then reload the provider. */
  setCredential(token: string): Promise<GitHubSetupSummary>
  /** Remove the stored token, then reload the provider. */
  clearCredential(): Promise<GitHubSetupSummary>
  /** The configured repository list as stored. */
  listRepositories(): GitHubRepoConfig[]
  /** Replace the configured repository list. */
  writeRepositories(value: unknown): Promise<GitHubRepoConfig[]>
  /** Credential facts only, for callers that need nothing else. */
  credential(): Promise<GitHubCredentialStatus>
  /** Proxy configuration and what it resolves to right now. */
  proxy(): GitHubProxyStatus
  /** Store the proxy mode and custom URL, then reload the provider. */
  setProxy(value: unknown): Promise<GitHubSetupSummary>
}

/**
 * One expected setup failure: bad input, or a deployment that cannot serve the
 * write. The routes map it onto its status instead of reporting a 500, and the
 * tools render it as a refusal.
 */
export class GitHubSetupError extends Error {
  /**
   * @param status - HTTP status the routes answer with.
   * @param code - stable machine-readable reason for a caller to branch on.
   * @param message - human-readable explanation.
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'GitHubSetupError'
  }
}

/** Tokens shorter than this are typos; longer than this is not a token. */
const TOKEN_MIN_LENGTH = 8
const TOKEN_MAX_LENGTH = 512

/**
 * Build the setup operations for one activation.
 * @param options - the live configuration readers and the reload hook.
 * @returns the shared setup surface.
 */
export function createGitHubSetup(options: GitHubSetupOptions): GitHubSetup {
  const env = options.env ?? process.env
  const credential = (): Promise<GitHubCredentialStatus> => describeGitHubCredential(options.ctx, options.tokenEnv(), env)

  const repositories = (): GitHubRepoConfig[] => options.repositories().map(config => ({ ...config }))

  /** The proxy this configuration resolves to for the API this client dials. */
  const proxy = (): GitHubProxyStatus => {
    const mode = options.proxyMode?.() ?? 'auto'
    const url = options.proxyUrl?.() ?? ''
    const resolved = resolveProxyConfiguration(GITHUB_API_BASE_URL, {
      mode,
      customUrl: url,
      env,
      ...(options.detectSystemProxy === undefined ? {} : { detect: options.detectSystemProxy }),
    })
    return {
      mode,
      url,
      ...(resolved.url === undefined ? {} : { effective: resolved.url }),
      ...(resolved.source === undefined ? {} : { source: resolved.source }),
    }
  }

  const status = async (): Promise<GitHubSetupSummary> => {
    const face = resolveSettingsFace(options.ctx)
    const health = options.health?.()
    return {
      credential: await credential(),
      repositories: repositories(),
      running: options.running(),
      settingsWritable: face !== undefined && face.writable !== false && findGitHubSettingsEntry(face) !== undefined,
      proxy: proxy(),
      ...(health === undefined ? {} : { health }),
    }
  }

  const clientFor = (token: string | undefined): GitHubApiClient => {
    if (options.clientFor !== undefined) return options.clientFor(token)
    // The proxy is resolved here, from the plugin configuration, instead of
    // being left to the client's own environment read: a mode of `direct` must
    // win over an inherited HTTPS_PROXY, and a detected system proxy must be
    // used where no variable names one.
    return new GitHubApiClient({
      token,
      tokenEnv: options.tokenEnv(),
      env,
      ...proxyClientOptions(resolveProxyConfiguration(GITHUB_API_BASE_URL, {
        mode: options.proxyMode?.() ?? 'auto',
        customUrl: options.proxyUrl?.() ?? '',
        env,
        ...(options.detectSystemProxy === undefined ? {} : { detect: options.detectSystemProxy }),
      })),
    })
  }

  const setProxy = async (value: unknown): Promise<GitHubSetupSummary> => {
    const settings = sanitizeProxySettings(value)
    if (settings === undefined) {
      throw new GitHubSetupError(400, 'invalid-proxy', 'the proxy settings are not the shape this extension stores')
    }
    await writeProxySettings(options.ctx, settings)
    options.reload()
    return await status()
  }

  const test = async (target?: GitHubSetupTarget): Promise<GitHubConnectionReport> => {
    const status = await credential()
    const targets = selectTargets(options.repositories(), target)
    if (targets.length === 1 && target?.owner !== undefined && repositoryMissing(options.repositories(), target)) {
      // A one-off probe of a repository that is not configured yet: report it
      // like any other check instead of refusing the whole call, which is what
      // lets the card test a repository before it is added.
      targets.push({ owner: target.owner, repository: target.repository ?? '' })
    }
    const token = await resolveGitHubToken(options.ctx, options.tokenEnv(), env)
    if (token === undefined) {
      return { ok: false, credential: status, checks: [] }
    }
    const client = clientFor(token)
    let login: string | undefined
    try {
      const user = await client.getAuthenticatedUser()
      login = user.login
    } catch (error) {
      return { ok: false, credential: status, checks: [{ owner: '', repository: '', ok: false, message: describeError(error) }] }
    }
    const checks: GitHubRepositoryCheck[] = []
    for (const repository of targets) {
      if (repository.owner === '' || repository.repository === '') continue
      checks.push(await checkRepository(client, repository))
    }
    return { ok: checks.every(check => check.ok), login, credential: status, checks }
  }

  const setCredential = async (token: string): Promise<GitHubSetupSummary> => {
    const value = normalizeTokenInput(token)
    await setGitHubToken(options.ctx, options.tokenEnv(), value)
    options.reload()
    return await status()
  }

  const clearCredential = async (): Promise<GitHubSetupSummary> => {
    await clearGitHubToken(options.ctx, options.tokenEnv())
    options.reload()
    return await status()
  }

  const writeRepositories = async (value: unknown): Promise<GitHubRepoConfig[]> => {
    const list = sanitizeRepositoryList(value)
    if (list === undefined) throw new GitHubSetupError(400, 'invalid-repositories', 'the repository list is not the shape this extension stores')
    const seen = new Set<string>()
    for (const repository of list) {
      const key = (repository.owner + '/' + repository.repository).toLowerCase()
      if (seen.has(key)) throw new GitHubSetupError(400, 'duplicate-repository', 'repository ' + repository.owner + '/' + repository.repository + ' is listed twice')
      seen.add(key)
    }
    await writeConfiguredRepositories(options.ctx, list)
    return list
  }

  return {
    status,
    test,
    setCredential,
    clearCredential,
    listRepositories: repositories,
    writeRepositories,
    credential,
    proxy,
    setProxy,
  }
}

/**
 * Validate a token a user or a model pasted.
 * @param token - the raw value.
 * @returns the trimmed token.
 * @throws when the value cannot be a GitHub token.
 */
export function normalizeTokenInput(token: string): string {
  const trimmed = token.trim()
  if (trimmed === '') throw new GitHubSetupError(400, 'empty-token', 'the token is empty')
  if (trimmed.length < TOKEN_MIN_LENGTH) throw new GitHubSetupError(400, 'short-token', 'the token is too short to be a GitHub token')
  if (trimmed.length > TOKEN_MAX_LENGTH) throw new GitHubSetupError(400, 'long-token', 'the token is too long to be a GitHub token')
  if (/\s/.test(trimmed)) throw new GitHubSetupError(400, 'whitespace-token', 'the token contains whitespace; paste the raw token only')
  return trimmed
}

/** The repositories one test call covers. */
function selectTargets(configured: readonly GitHubRepoConfig[], target?: GitHubSetupTarget): GitHubRepoConfig[] {
  if (target?.owner === undefined || target.repository === undefined || target.repository === '') {
    return configured.map(config => ({ ...config }))
  }
  const owner = target.owner.toLowerCase()
  const name = target.repository.toLowerCase()
  const hit = configured.find(config => config.owner.toLowerCase() === owner && config.repository.toLowerCase() === name)
  return hit === undefined ? [] : [{ ...hit }]
}

/** Whether a one-off target names a repository the configuration does not carry. */
function repositoryMissing(configured: readonly GitHubRepoConfig[], target: GitHubSetupTarget): boolean {
  const owner = target.owner?.toLowerCase()
  const name = target.repository?.toLowerCase()
  return !configured.some(config => config.owner.toLowerCase() === owner && config.repository.toLowerCase() === name)
}

/**
 * Check one repository: identity, default branch, and how many of its open
 * issues the board would take.
 *
 * The count is computed by the same inclusion rule the sync applies — the
 * inclusion label, or assignment to the configured login — so a repository
 * whose board feed comes from assignees reports a number instead of a
 * misleading zero.
 */
async function checkRepository(client: GitHubApiClient, repository: GitHubRepoConfig): Promise<GitHubRepositoryCheck> {
  const owner = repository.owner
  const name = repository.repository
  const config = resolveRepoConfig(repository)
  try {
    const found = await client.getRepository(owner, name)
    let assignee = config.assignee
    if (assignee === ME_ASSIGNEE) {
      const user = await client.getAuthenticatedUser()
      assignee = user.login.trim().toLowerCase()
    }
    const effective = assignee === undefined ? config : { ...config, assignee }
    const issues = await client.listOpenIssues(owner, name)
    const included = issues.filter(issue => isIssueIncluded(issue, effective)).length
    const channels = 'label "' + config.inclusionLabel + '"'
      + (assignee === undefined ? '' : ' or assignment to ' + assignee)
      + (config.includeUnassigned ? ' or no assignee' : '')
    return {
      owner,
      repository: name,
      ok: true,
      message: String(included) + ' open issues are on the board (' + channels + ')',
      ...(typeof found.default_branch === 'string' ? { defaultBranch: found.default_branch } : {}),
      ...(typeof found.private === 'boolean' ? { private: found.private } : {}),
      ...(assignee === undefined ? {} : { assignee }),
      ...(config.includeUnassigned ? { includeUnassigned: true } : {}),
      openIssues: included,
    }
  } catch (error) {
    return { owner, repository: name, ok: false, message: describeError(error) }
  }
}

/** Phrase one failure for a person reading the card or a model reading a tool result. */
function describeError(error: unknown): string {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) return 'GitHub rejected the credential (401): the token is invalid or expired'
    if (error.status === 403) return 'GitHub refused the request (403): the token lacks a required scope, or the rate limit is exhausted'
    if (error.status === 404) return 'GitHub answered 404: the repository does not exist, or this token cannot see it'
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}
