/**
 * Skill installation: plan and copy skills from a local directory or a git
 * repository into a skill root, then record them in the ledger.
 *
 * Accepted source shapes (mirroring the filesystem provider's discovery):
 * - a directory whose `SKILL.md` parses — installed as one directory bundle;
 * - a directory containing subdirectories with `SKILL.md` — each becomes a
 *   directory bundle;
 * - a directory containing flat `*.md` skill files — each becomes a flat
 *   skill file (original file name kept, skill name from frontmatter).
 *
 * Git sources are shallow-cloned into a staging directory, planned and copied
 * from there, then the staging directory is removed. The `.git` directory is
 * never copied. Any invalid skill file, duplicate skill name, or collision
 * with an existing skill in the target root rejects the whole install.
 * @module @linxin666/dsh-skill-manager/install
 */

import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSkillText } from './frontmatter.ts'
import { SkillLedger } from './ledger.ts'
import { resolveSkillRoots, type InstallDestination } from './roots.ts'

/** One planned copy item. */
export interface SkillCopyItem {
  /** Skill name from the validated frontmatter. */
  name: string
  /** Directory bundle or flat file. */
  kind: 'dir' | 'file'
  /** Absolute source path. */
  sourcePath: string
  /** Absolute target path inside the skill root. */
  targetPath: string
}

/** One installed entry returned to the caller. */
export interface InstalledEntry {
  /** Skill name. */
  name: string
  /** Directory bundle or flat file. */
  kind: 'dir' | 'file'
  /** Absolute installed path. */
  path: string
}

/** Outcome of one install. */
export type InstallOutcome =
  | { ok: true; entries: InstalledEntry[] }
  | { ok: false; error: string }

/** Git clone runner (injected; tests never spawn a real process). */
export type GitRunner = (args: readonly string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<void>

/** Dependencies of the installer. */
export interface InstallerDeps {
  /** Resolved dsh home (user-level skill root). */
  dshHome: string
  /** Installed-skill ledger. */
  ledger: SkillLedger
  /** Git clone runner; required for git sources. */
  runGit?: GitRunner
  /** Staging parent directory for git clones (defaults to the OS temp dir). */
  tempDir?: string
}

/** The install capability: plan, copy, and record. */
export class SkillInstaller {
  /** @param deps - dsh home, ledger, optional git runner and staging dir. */
  constructor(private readonly deps: InstallerDeps) {}

  /**
   * Install skills from a source into one destination root.
   * @param source - local directory path or git repository URL.
   * @param destination - `workspace` (`<projectRoot>/.agents/skills`) or `user` (`<dshHome>/skills`).
   * @param cwd - the session's working directory (resolves the project root).
   * @returns the installed entries, or a rejection reason.
   */
  async install(
    source: { kind: 'dir' | 'git'; value: string },
    destination: InstallDestination,
    cwd: string,
  ): Promise<InstallOutcome> {
    const roots = await resolveSkillRoots(cwd, this.deps.dshHome, pathExists)
    const targetRoot = destination === 'user' ? roots.user : roots.workspace
    let sourceDir: string | undefined
    let staging: string | undefined
    try {
      if (source.kind === 'git') {
        if (this.deps.runGit === undefined) {
          return { ok: false, error: 'git installation requires a git binary on PATH' }
        }
        const value = source.value.trim()
        if (value === '') return { ok: false, error: 'git repository URL is empty' }
        staging = await mkdtemp(join(this.deps.tempDir ?? tmpdir(), 'dsh-skill-manager-'))
        try {
          await this.deps.runGit(['clone', '--depth', '1', value, join(staging, 'repo')], { timeoutMs: 120000 })
        } catch (error) {
          return { ok: false, error: `git clone failed: ${String(error)}` }
        }
        sourceDir = join(staging, 'repo')
      } else {
        const value = source.value.trim()
        if (value === '') return { ok: false, error: 'source directory is empty' }
        sourceDir = value
      }
      const items = await planFromDirectory(sourceDir, targetRoot)
      if ('error' in items) return { ok: false, error: items.error }
      if (items.items.length === 0) return { ok: false, error: 'no installable skills found in the source' }
      const conflict = await findExistingNames(targetRoot)
      if (conflict.overlap(items.items.map(item => item.name)).length > 0) {
        const names = conflict.overlap(items.items.map(item => item.name)).join(', ')
        return { ok: false, error: `skill name conflict in ${targetRoot}: ${names}` }
      }
      await mkdir(targetRoot, { recursive: true })
      for (const item of items.items) {
        if (await pathExists(item.targetPath)) {
          return { ok: false, error: `target path already exists: ${item.targetPath}` }
        }
        if (item.kind === 'dir') {
          await cp(item.sourcePath, item.targetPath, {
            recursive: true,
            filter: (candidate) => basenameOf(candidate) !== '.git',
          })
        } else {
          await cp(item.sourcePath, item.targetPath)
        }
      }
      const now = Date.now()
      const entries: InstalledEntry[] = []
      for (const item of items.items) {
        await this.deps.ledger.record({ name: item.name, path: item.targetPath, installedAt: now })
        entries.push({ name: item.name, kind: item.kind, path: item.targetPath })
      }
      return { ok: true, entries }
    } finally {
      if (staging !== undefined) {
        await rm(staging, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}

/** Planned items from one directory, or the rejection reason. */
type PlanOutcome = { items: SkillCopyItem[] } | { error: string }

async function planFromDirectory(sourceDir: string, targetRoot: string): Promise<PlanOutcome> {
  const source = await stat(sourceDir).catch(() => undefined)
  if (source === undefined || !source.isDirectory()) {
    return { error: `source is not a readable directory: ${sourceDir}` }
  }
  if (await pathExists(join(sourceDir, 'SKILL.md'))) {
    const parsed = await parseSkillFile(join(sourceDir, 'SKILL.md'))
    if (parsed === undefined) return { error: `invalid skill: ${join(sourceDir, 'SKILL.md')}` }
    return { items: [{ name: parsed.name, kind: 'dir', sourcePath: sourceDir, targetPath: join(targetRoot, parsed.name) }] }
  }
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch(() => [])
  const items: SkillCopyItem[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = join(sourceDir, entry.name)
    if (entry.isDirectory()) {
      const skillFile = join(entryPath, 'SKILL.md')
      if (!(await pathExists(skillFile))) continue
      const parsed = await parseSkillFile(skillFile)
      if (parsed === undefined) return { error: `invalid skill: ${skillFile}` }
      items.push({ name: parsed.name, kind: 'dir', sourcePath: entryPath, targetPath: join(targetRoot, parsed.name) })
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const parsed = await parseSkillFile(entryPath)
      if (parsed === undefined) return { error: `invalid skill: ${entryPath}` }
      items.push({ name: parsed.name, kind: 'file', sourcePath: entryPath, targetPath: join(targetRoot, entry.name) })
    }
  }
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.name)) return { error: `duplicate skill name in source: ${item.name}` }
    seen.add(item.name)
  }
  return { items }
}

async function parseSkillFile(path: string): Promise<{ name: string } | undefined> {
  const text = await readFile(path, { encoding: 'utf8' }).catch(() => undefined)
  if (text === undefined) return undefined
  const parsed = parseSkillText(text)
  return parsed === undefined ? undefined : { name: parsed.name }
}

/** Existing skill names in a root, plus the overlap helper. */
async function findExistingNames(root: string): Promise<{ overlap(names: readonly string[]): string[] }> {
  const names = new Set<string>()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      const parsed = await parseSkillFile(join(entryPath, 'SKILL.md'))
      if (parsed !== undefined) names.add(parsed.name)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const parsed = await parseSkillFile(entryPath)
      if (parsed !== undefined) names.add(parsed.name)
    }
  }
  return {
    overlap(candidates) {
      return candidates.filter(name => names.has(name))
    },
  }
}

async function pathExists(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined)
  return info !== undefined
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}
