/**
 * Skill collection: filesystem scanning (primary) plus registry supplement.
 *
 * The web profile mounts the skill-filesystem provider only at the agent
 * preset scope layer, so the host plane cannot read project/user skills from
 * ctx.skills — the list route scans the official root conventions itself and
 * merges registry entries (bundled / runtime) by name.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'

/** Display order and copy for each source level. */
export interface SourceGroup {
  key: string
  title: string
  hint: string
}

/** Source levels produced by filesystem scanning (registry sources map to the same set). */
export const SOURCE_GROUPS: SourceGroup[] = [
  { key: 'bundled', title: 'System bundled', hint: 'Skills shipped with DSH and its plugins' },
  { key: 'project-dsh', title: 'Project skills (.dsh/skills)', hint: 'Current project only' },
  { key: 'project-agents', title: 'Project skills (.agents/skills)', hint: 'Current project only' },
  { key: 'custom', title: 'Custom directories', hint: 'customSkillDirs config' },
  { key: 'user-dsh', title: 'User skills (~/.dsh/skills)', hint: 'All projects on this machine' },
  { key: 'user-agents', title: 'User skills (~/.agents/skills)', hint: 'All projects on this machine' },
  { key: 'runtime', title: 'Runtime registered', hint: 'Registered in plugin code' },
]

/** Registry source -> display level mapping (unlisted sources fall into "other"). */
export const REGISTRY_SOURCE_LEVEL: ReadonlyMap<string, string> = new Map(SOURCE_GROUPS.map((group) => [group.key, group.key]))

/**
 * Filesystem precedence across roots, matching the official rank order
 * (project wins over custom wins over user). Parallel scans finish in
 * arbitrary order, so the winner must be decided by priority comparison,
 * never by whichever readdir happened to resolve last.
 */
const LEVEL_PRIORITY: ReadonlyMap<string, number> = new Map([
  ['project-dsh', 0],
  ['project-agents', 1],
  ['custom', 2],
  ['user-dsh', 3],
  ['user-agents', 4],
])

/** One skill entry as served to the panel. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  level: string
  path?: string
  /** True when the skill was discovered through a symlink entry (deletion is not allowed). */
  linked?: boolean
  modelInvocable: boolean
  userInvocable: boolean
}

/** Registry snapshot entry shape (subset of ctx.skills entries). */
export interface RegistrySkill {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  source: string
  resourceBase?: { kind: string; path?: string }
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
}

/** Options for collectSkills. */
export interface CollectOptions {
  /** Registry snapshot workspace base. */
  cwd: string
  /** Project roots to scan (each scans .dsh/skills and .agents/skills). */
  projectRoots?: string[]
  /** Extra custom skill roots. */
  customSkillDirs?: string[]
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** ctx.skills registry (snapshot). */
  registry: { snapshot(options: { cwd: string }): Promise<{ skills: RegistrySkill[]; complete: boolean }> }
}

/** Result of a collection pass. */
export interface CollectResult {
  skills: SkillEntry[]
  complete: boolean
}

/** Group payload served by the list route. */
export interface GroupPayload {
  key: string
  title: string
  hint: string
  skills: SkillEntry[]
}

/** List payload served by the list route. */
export interface ListPayload {
  cwd: string
  projectRoots: string[]
  complete: boolean
  groups: GroupPayload[]
}

/** Find the nearest ancestor directory containing .git (cwd itself when none). */
export function findProjectRoot(cwd: string): string {
  let current = cwd
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

/**
 * Scan one skill root (one level: <name>/SKILL.md or <name>.md).
 * Async IO via fs/promises so multiple roots can be scanned in parallel.
 */
async function scanSkillRoot(root: string, level: string, into: Map<string, SkillEntry>): Promise<void> {
  if (!existsSync(root)) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    let file: string
    let linked = false
    if (entry.isDirectory()) {
      file = join(root, name, 'SKILL.md')
    } else if (entry.isFile() && name.endsWith('.md')) {
      file = join(root, name)
    } else if (entry.isSymbolicLink()) {
      // A symlink's dirent is neither a directory nor a file, so a plain
      // readdir() skips it and linked-out skills never show up. Follow the
      // target with stat() (cross-platform: Windows symlink/junction, Linux and
      // macOS symlink all resolve the same way) to classify it, then resolve
      // the file path like a real entry — the scan path stays on the link, so
      // the write route (set-enabled) reaches the linked target via the normal
      // fs follow semantics. Dangling or unreadable links are skipped.
      // A linked skill is mount-of-intent content, not created under this root:
      // it stays listable and toggleable, but deletion is refused (see routes).
      linked = true
      let linkedFile: string
      try {
        const target = await stat(join(root, name))
        if (target.isDirectory()) linkedFile = join(root, name, 'SKILL.md')
        else if (target.isFile() && name.endsWith('.md')) linkedFile = join(root, name)
        else continue
      } catch {
        continue
      }
      file = linkedFile
    } else {
      continue
    }
    if (!existsSync(file)) continue
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseFrontmatter(content)
    const skillName = parsed.name ?? name.replace(/\.md$/, '')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) continue
    const priority = LEVEL_PRIORITY.get(level) ?? 99
    const existing = into.get(skillName)
    if (existing !== undefined && (LEVEL_PRIORITY.get(existing.level) ?? 99) <= priority) continue
    into.set(skillName, {
      name: skillName,
      description: parsed.description ?? '(no description)',
      whenToUse: parsed.whenToUse,
      provider: 'filesystem',
      level,
      path: file,
      linked,
      // Official frontmatter invocation policy.
      modelInvocable: parsed.disableModelInvocation !== true,
      userInvocable: parsed.userInvocable !== false,
    })
  }
}

/** Serialize one registry entry into the panel payload (keeps the source for grouping). */
function serializeRegistry(skill: RegistrySkill): SkillEntry {
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    provider: skill.provider,
    level: REGISTRY_SOURCE_LEVEL.get(skill.source) ?? `other:${skill.source}`,
    // Registry-only entries (bundled / runtime) have no editable file: the
    // write routes only trust paths from a fresh filesystem scan, so expose
    // no path here — otherwise the panel would show toggle/delete controls
    // that always answer 404.
    path: undefined,
    modelInvocable: skill.invocation?.modelInvocable ?? false,
    userInvocable: skill.invocation?.userInvocable ?? false,
  }
}

/** Group by level, ordered by SOURCE_GROUPS then leftovers, sorted by name inside each group. */
export function buildPayload(skills: SkillEntry[], complete: boolean, cwd: string, projectRoots: string[]): ListPayload {
  const byLevel = new Map<string, SkillEntry[]>()
  for (const skill of skills) {
    const list = byLevel.get(skill.level) ?? []
    list.push(skill)
    byLevel.set(skill.level, list)
  }
  const known = new Set(SOURCE_GROUPS.map((group) => group.key))
  const groups: GroupPayload[] = SOURCE_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    hint: group.hint,
    skills: (byLevel.get(group.key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.skills.length > 0)
  const leftovers: GroupPayload[] = [...byLevel.entries()]
    .filter(([key]) => !known.has(key))
    .map(([key, list]) => ({
      key,
      title: key.startsWith('other:') ? `Other (${key.slice(6)})` : `Other (${key})`,
      hint: '',
      skills: list.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  return { cwd, projectRoots, complete, groups: [...groups, ...leftovers] }
}

/**
 * Collect grouped skills: filesystem scanning (primary) + registry supplement.
 * Filesystem entries win on name conflicts; the registry fills whenToUse and
 * invocation flags, and contributes bundled/runtime entries of its own.
 * @param options - collection options.
 * @returns skills and whether the registry snapshot was complete.
 */
export async function collectSkills(options: CollectOptions): Promise<CollectResult> {
  const { cwd, customSkillDirs, dshHome, agentsHome, registry } = options
  const byName = new Map<string, SkillEntry>()
  const roots = new Set<string>(options.projectRoots !== undefined && options.projectRoots.length > 0 ? options.projectRoots : [findProjectRoot(cwd)])
  // Each root scans independently, in parallel (Map writes are atomic under the single thread).
  const scanTasks: Array<Promise<void>> = []
  for (const root of roots) {
    scanTasks.push(scanSkillRoot(join(root, '.dsh', 'skills'), 'project-dsh', byName))
    scanTasks.push(scanSkillRoot(join(root, '.agents', 'skills'), 'project-agents', byName))
  }
  for (const dir of customSkillDirs ?? []) scanTasks.push(scanSkillRoot(dir, 'custom', byName))
  scanTasks.push(scanSkillRoot(join(dshHome, 'skills'), 'user-dsh', byName))
  scanTasks.push(scanSkillRoot(join(agentsHome, 'skills'), 'user-agents', byName))
  await Promise.all(scanTasks)

  // Registry supplement: same-name skills get whenToUse / invocation flags
  // filled in; registry-only skills (bundled / runtime) join as-is.
  let complete = true
  try {
    const snapshot = await registry.snapshot({ cwd })
    complete = snapshot.complete
    for (const skill of snapshot.skills) {
      const existing = byName.get(skill.name)
      const serialized = serializeRegistry(skill)
      if (existing === undefined) {
        byName.set(skill.name, serialized)
      } else {
        if (serialized.whenToUse !== undefined) existing.whenToUse = serialized.whenToUse
        if (serialized.provider !== undefined) existing.provider = serialized.provider
        existing.modelInvocable = serialized.modelInvocable
        existing.userInvocable = serialized.userInvocable
      }
    }
  } catch {
    // Registry unavailable: the filesystem result still stands.
    complete = false
  }
  return { skills: [...byName.values()], complete }
}

/** Single-quote a YAML scalar (doubling embedded quotes); keeps the frontmatter parseable for values containing colons. */
function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Build the new skill file content (create route). */
export function buildSkillContent(name: string, description: string, whenToUse: string | undefined, content: string, disabled: boolean): string {
  const lines = ['---', `name: ${name}`, `description: ${yamlQuote(description.replace(/[\r\n]/gu, ' '))}`]
  if (typeof whenToUse === 'string' && whenToUse.trim() !== '') lines.push(`whenToUse: ${yamlQuote(whenToUse.replace(/[\r\n]/gu, ' '))}`)
  if (disabled === true) lines.push('disable-model-invocation: true')
  lines.push('---', '', content.trim(), '')
  return lines.join('\n')
}

/** Create a skill file (mkdir -p + write). Returns the absolute target path. */
export async function writeSkillFile(baseDir: string, name: string, description: string, whenToUse: string | undefined, content: string): Promise<string> {
  const targetDir = join(baseDir, name)
  const target = join(targetDir, 'SKILL.md')
  if (existsSync(target)) throw new Error(`skill ${name} already exists at ${target}`)
  await mkdir(targetDir, { recursive: true })
  await writeFile(target, buildSkillContent(name, description.trim(), whenToUse, content, false), 'utf8')
  return target
}

/** Move a skill file into its .trash sibling directory (recoverable delete). */
export async function trashSkillFile(path: string): Promise<string> {
  const trashDir = join(dirname(path), '.trash')
  await mkdir(trashDir, { recursive: true })
  const trashTarget = join(trashDir, `${Date.now()}-SKILL.md`)
  await rename(path, trashTarget)
  return trashTarget
}

/** User skill root convention. */
export function userSkillRoot(dshHome: string): string {
  return join(dshHome, 'skills')
}

/** Project skill root convention (project root + .dsh/skills). */
export function projectSkillRoot(projectRoot: string): string {
  return `${projectRoot}${sep}.dsh${sep}skills`
}
