/**
 * Pure catalog and installed-plugin logic shared by the Host tools and the
 * browser settings section. The remote API is untrusted: executable plans are
 * accepted only after their argv, source, and repository identity agree. A
 * verified mode additionally requires the API validation revision to match.
 */

export const STORE_CATALOG_URL = 'https://api.dshmk.com/'
export const COMMUNITY_STORE_API_PREFIX = '/api/dsh-community-plugins'

const INSTALLABLE_TYPES = new Set(['plugin', 'skill', 'collection', 'channel'])
const REPOSITORY_FULL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/
const GITHUB_SPECIFIER = /^github:([^#]+)(?:#([A-Za-z0-9][A-Za-z0-9_.:-]{0,127}))?$/i
const SOURCE_SHA = /^[a-f0-9]{40}$/i
const PACKAGE_NAME = /^(?:@[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/)?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const NPM_SPECIFIER = /^(?:@[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/)?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})(?:@[A-Za-z0-9^~<>=*+._-][A-Za-z0-9^~<>=*+._-]{0,127})?$/
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export interface CatalogInstallCandidate {
  source?: unknown
  target?: unknown
  command?: unknown
  args?: unknown
  executable?: unknown
  version?: unknown
}

export interface CatalogValidation {
  overall?: string
  label?: string
  tone?: string
  sourceSha?: string
  reason?: string | null
  updatedAt?: string
}

export interface CatalogRepository {
  id: string
  repositoryId: string | number
  name: string
  fullName: string
  description: string
  url?: string
  homepage?: string | null
  topics?: string[]
  projectType: string
  category: string
  stars: number
  pushedAt: string
  version?: string
  packageVersion?: string
  validation?: CatalogValidation
  install?: {
    status?: string
    candidate?: CatalogInstallCandidate | null
    candidates?: CatalogInstallCandidate[]
  }
  installed?: boolean
  updateAvailable?: boolean
  installedPlugin?: InstalledPlugin | null
}

export interface StoreCatalog {
  schemaVersion: 1
  generatedAt: string
  source?: { label?: string; topic?: string; url?: string }
  stats?: {
    fetched?: number
    reportedByGitHub?: number
    verified?: number
    categories?: Record<string, number>
    projectTypes?: Record<string, number>
    validationStatuses?: Record<string, number>
  }
  repositories: CatalogRepository[]
}

export interface InstallPlan {
  source: 'github' | 'npm'
  target: string
  command: string
  args: [string, string, string, string, string]
  executable: true
}

export type InstallMode = 'verified' | 'latest'

export interface InstalledPlugin {
  name: string
  from?: string
  version?: string
  resolved?: string
}

export interface CatalogFilters {
  query: string
  category: string
  sort: 'recommended' | 'stars' | 'updated' | 'name'
  verifiedOnly: boolean
  installedOnly: boolean
}

export interface CatalogFacets {
  categories: string[]
  projectTypes: string[]
  validationStatuses: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function isCatalogRepository(value: unknown): value is CatalogRepository {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && (typeof value.repositoryId === 'string' || typeof value.repositoryId === 'number')
    && typeof value.name === 'string'
    && typeof value.fullName === 'string'
    && REPOSITORY_FULL_NAME.test(value.fullName)
    && typeof value.description === 'string'
    && typeof value.projectType === 'string'
    && typeof value.category === 'string'
}

/** Parse the versioned Store API envelope and discard malformed entries. */
export function parseCatalog(value: unknown): StoreCatalog {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.repositories)) {
    throw new Error('Store catalog response format is invalid')
  }
  return {
    schemaVersion: 1,
    generatedAt: optionalString(value.generatedAt) ?? '',
    ...isRecord(value.source) ? { source: value.source as StoreCatalog['source'] } : {},
    ...isRecord(value.stats) ? { stats: value.stats as StoreCatalog['stats'] } : {},
    repositories: value.repositories.filter(isCatalogRepository).map(repository => ({
      ...repository,
      stars: finiteNumber(repository.stars),
      pushedAt: optionalString(repository.pushedAt) ?? '',
    })),
  }
}

function readInstallArgs(candidate: CatalogInstallCandidate): InstallPlan['args'] | null {
  if (!Array.isArray(candidate.args)
    || candidate.args.length !== 5
    || candidate.args[0] !== 'plugin'
    || candidate.args[1] !== '--profile'
    || candidate.args[2] !== 'web'
    || candidate.args[3] !== 'add'
    || typeof candidate.args[4] !== 'string') return null
  return [...candidate.args] as InstallPlan['args']
}

/** Build an executable plan only when every API-owned identity constraint agrees. */
export function buildInstallPlan(repository: CatalogRepository, mode?: InstallMode): InstallPlan | null {
  if (!INSTALLABLE_TYPES.has(repository.projectType) || repository.install?.status !== 'recognized') return null
  const candidate = repository.install.candidate
  if (!isRecord(candidate) || candidate.executable !== true || typeof candidate.target !== 'string') return null
  const args = readInstallArgs(candidate)
  if (args === null) return null

  if (candidate.source === 'github') {
    const match = GITHUB_SPECIFIER.exec(args[4])
    if (match === null
      || !REPOSITORY_FULL_NAME.test(match[1])
      || match[1].toLowerCase() !== repository.fullName.toLowerCase()
      || candidate.target.toLowerCase() !== repository.fullName.toLowerCase()) return null

    const latestTarget = `github:${repository.fullName}`
    const latestPlan: InstallPlan = {
      source: 'github',
      target: candidate.target,
      command: `dsh plugin --profile web add ${latestTarget}`,
      args: ['plugin', '--profile', 'web', 'add', latestTarget],
      executable: true,
    }
    if (mode === 'latest') return latestPlan

    const sourceSha = repository.validation?.sourceSha ?? ''
    const verifiedPlan = repository.validation?.overall === 'verified'
      && SOURCE_SHA.test(sourceSha)
      && match[2]?.toLowerCase() === sourceSha.toLowerCase()
      ? {
          source: 'github' as const,
          target: candidate.target,
          command: `dsh plugin --profile web add ${args[4]}`,
          args,
          executable: true as const,
        }
      : null
    if (mode === 'verified') return verifiedPlan
    if (repository.validation?.overall === 'verified') {
      return verifiedPlan ?? latestPlan
    }
    return {
      source: 'github',
      target: candidate.target,
      command: `dsh plugin --profile web add ${args[4]}`,
      args,
      executable: true,
    }
  }

  if (candidate.source === 'npm') {
    if (mode === 'verified') return null
    const specifier = args[4].startsWith('npm:') ? args[4].slice(4) : args[4]
    if (!NPM_SPECIFIER.test(specifier) || specifier !== candidate.target) return null
    return {
      source: 'npm',
      target: candidate.target,
      command: `dsh plugin --profile web add ${args[4]}`,
      args,
      executable: true,
    }
  }
  return null
}

/** Return an explicit choice only when both verified and latest GitHub plans are safe. */
export function getInstallModes(repository: CatalogRepository): InstallMode[] {
  if (repository.validation?.overall !== 'verified') return []
  return buildInstallPlan(repository, 'verified') !== null && buildInstallPlan(repository, 'latest') !== null
    ? ['verified', 'latest']
    : []
}

function normalizeInstalled(name: unknown, dependency: unknown): InstalledPlugin | null {
  if (typeof name !== 'string' || !PACKAGE_NAME.test(name) || !isRecord(dependency)) return null
  return {
    name,
    ...optionalString(dependency.from) === undefined ? {} : { from: optionalString(dependency.from) },
    ...optionalString(dependency.version) === undefined ? {} : { version: optionalString(dependency.version) },
    ...optionalString(dependency.resolved) === undefined ? {} : { resolved: optionalString(dependency.resolved) },
  }
}

/** Parse the direct dependency view returned by `dsh plugin ... list --json`. */
export function parseInstalledPluginList(value: unknown): InstalledPlugin[] {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as unknown
    } catch {
      throw new Error('Installed plugin list format is invalid')
    }
  }
  if (!Array.isArray(parsed)) throw new Error('Installed plugin list format is invalid')
  const root = parsed.find(entry => isRecord(entry) && isRecord(entry.dependencies))
  if (!isRecord(root) || !isRecord(root.dependencies)) return []
  return Object.entries(root.dependencies)
    .map(([name, dependency]) => normalizeInstalled(name, dependency))
    .filter((entry): entry is InstalledPlugin => entry !== null)
}

function stripQuotes(value: unknown): string | null {
  const text = optionalString(value)?.trim()
  return text === undefined ? null : text.replace(/^(['"])(.*)\1$/, '$2')
}

function githubSource(value: unknown): { fullName: string; ref?: string } | null {
  const text = stripQuotes(value)
  if (text === null) return null
  const match = /(?:^github:|^git\+https?:\/\/github\.com\/|^https?:\/\/github\.com\/|^git@github\.com:)([^/#:]+\/[^/#]+?)(?:\.git)?(?:#(.+))?$/i.exec(text)
  if (match === null) return null
  return { fullName: match[1].toLowerCase(), ...optionalString(match[2]) === undefined ? {} : { ref: match[2].toLowerCase() } }
}

function npmSource(value: unknown): { name: string; version?: string } | null {
  const text = stripQuotes(value)?.replace(/^npm:/i, '')
  if (text === undefined || text === null) return null
  const match = /^(@[^/]+\/[^@]+|[^@]+)(?:@(.+))?$/.exec(text)
  return match === null ? null : { name: match[1], ...optionalString(match[2]) === undefined ? {} : { version: match[2] } }
}

/** Match one catalog project to a direct Web-profile dependency. */
export function matchInstalledPlugin(repository: CatalogRepository, installed: readonly InstalledPlugin[]): InstalledPlugin | null {
  const candidate = repository.install?.candidate
  if (!isRecord(candidate)) return null
  if (candidate.source === 'github') {
    const target = githubSource(candidate.target)?.fullName ?? repository.fullName.toLowerCase()
    return installed.find(entry => [entry.from, entry.resolved].some(value => githubSource(value)?.fullName === target)) ?? null
  }
  if (candidate.source === 'npm') {
    const target = npmSource(candidate.target)?.name
    if (target === undefined || target === null) return null
    return installed.find(entry => entry.name === target
      || npmSource(entry.from)?.name === target
      || npmSource(entry.resolved)?.name === target) ?? null
  }
  return null
}

function compareVersion(left: unknown, right: unknown): number | null {
  const leftMatch = VERSION.exec(optionalString(left) ?? '')
  const rightMatch = VERSION.exec(optionalString(right) ?? '')
  if (leftMatch === null || rightMatch === null) return null
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index])
    if (difference !== 0) return difference
  }
  if (leftMatch[4] === rightMatch[4]) return 0
  if (leftMatch[4] === undefined) return 1
  if (rightMatch[4] === undefined) return -1
  return leftMatch[4].localeCompare(rightMatch[4])
}

function sourceRefsDiffer(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false
  return left !== right && !left.startsWith(right) && !right.startsWith(left)
}

/** Compare the catalog's explicit version/revision with the installed dependency. */
export function isUpdateAvailable(repository: CatalogRepository, installed: InstalledPlugin | null): boolean {
  if (installed === null) return false
  const candidate = repository.install?.candidate
  if (!isRecord(candidate)) return false
  if (candidate.source === 'github') {
    const args = Array.isArray(candidate.args) ? candidate.args : []
    const catalogRef = optionalString(repository.validation?.sourceSha)
      ?? githubSource(args[4])?.ref
      ?? githubSource(candidate.target)?.ref
    const installedRef = [installed.resolved, installed.from].map(githubSource).find(Boolean)?.ref
    return sourceRefsDiffer(catalogRef?.toLowerCase(), installedRef?.toLowerCase())
  }
  if (candidate.source === 'npm') {
    const catalogVersion = optionalString(repository.version)
      ?? optionalString(repository.packageVersion)
      ?? optionalString(candidate.version)
      ?? npmSource(candidate.target)?.version
    const comparison = compareVersion(catalogVersion, installed.version)
    return comparison !== null && comparison > 0
  }
  return false
}

/** Attach installed/update state without mutating API records. */
export function mergeInstalledPlugins(repositories: readonly CatalogRepository[], installed: readonly InstalledPlugin[]): CatalogRepository[] {
  return repositories.map(repository => {
    const installedPlugin = matchInstalledPlugin(repository, installed)
    return {
      ...repository,
      installed: installedPlugin !== null,
      updateAvailable: isUpdateAvailable(repository, installedPlugin),
      installedPlugin,
    }
  })
}

function searchableText(repository: CatalogRepository): string {
  return [repository.name, repository.fullName, repository.description, ...(repository.topics ?? [])]
    .join(' ')
    .toLocaleLowerCase()
}

/** Filter and sort the catalog while always putting detectable updates first. */
export function filterCatalogRepositories(repositories: readonly CatalogRepository[], filters: CatalogFilters): CatalogRepository[] {
  const tokens = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const selected = repositories.filter(repository => {
    if (filters.category !== 'all' && repository.category !== filters.category) return false
    if (filters.verifiedOnly && repository.validation?.overall !== 'verified') return false
    if (filters.installedOnly && repository.installed !== true) return false
    const text = searchableText(repository)
    return tokens.every(token => text.includes(token))
  })
  return [...selected].sort((left, right) => {
    if (Boolean(left.updateAvailable) !== Boolean(right.updateAvailable)) return Number(Boolean(right.updateAvailable)) - Number(Boolean(left.updateAvailable))
    if (filters.sort === 'stars') return right.stars - left.stars || left.fullName.localeCompare(right.fullName)
    if (filters.sort === 'updated') return Date.parse(right.pushedAt) - Date.parse(left.pushedAt) || left.fullName.localeCompare(right.fullName)
    if (filters.sort === 'name') return left.name.localeCompare(right.name) || left.fullName.localeCompare(right.fullName)
    const verified = Number(right.validation?.overall === 'verified') - Number(left.validation?.overall === 'verified')
    return verified || right.stars - left.stars || left.fullName.localeCompare(right.fullName)
  })
}

function facetValues(catalog: StoreCatalog, statsKey: 'categories' | 'projectTypes' | 'validationStatuses', read: (repository: CatalogRepository) => string | undefined): string[] {
  const stats = catalog.stats?.[statsKey]
  if (stats !== undefined && Object.keys(stats).length > 0) return Object.keys(stats).sort()
  return [...new Set(catalog.repositories.map(read).filter((value): value is string => value !== undefined && value.length > 0))].sort()
}

export function getCatalogFacets(catalog: StoreCatalog): CatalogFacets {
  return {
    categories: facetValues(catalog, 'categories', repository => repository.category),
    projectTypes: facetValues(catalog, 'projectTypes', repository => repository.projectType),
    validationStatuses: facetValues(catalog, 'validationStatuses', repository => repository.validation?.overall),
  }
}

export function findCatalogRepository(catalog: StoreCatalog, selector: string): CatalogRepository | undefined {
  const normalized = selector.toLowerCase()
  return catalog.repositories.find(repository => String(repository.repositoryId) === selector
    || repository.id === selector
    || repository.fullName.toLowerCase() === normalized)
}

export async function fetchStoreCatalog(fetcher: typeof fetch, signal?: AbortSignal, cache: RequestCache = 'default'): Promise<StoreCatalog> {
  const response = await fetcher(STORE_CATALOG_URL, {
    headers: { Accept: 'application/json' },
    cache,
    signal,
  })
  if (!response.ok) throw new Error(`Store catalog request failed (${response.status})`)
  return parseCatalog(await response.json() as unknown)
}

export function isInstalledPackageName(name: string, installed: readonly InstalledPlugin[]): boolean {
  return PACKAGE_NAME.test(name) && installed.some(entry => entry.name === name)
}
