/**
 * Skill manager orchestration: list / toggle / install / uninstall over the
 * official `ctx.skills` registry, the session header cwd, and the live
 * agent scope — the same resolution stance as the official `skill.list`
 * RPC. Toggling patches the SKILL.md frontmatter in place; installing copies
 * skills into a skill root and records them in the ledger; uninstalling
 * deletes only ledger-recorded paths.
 *
 * All dependencies are injected through a narrow structural interface so
 * unit tests run against fakes and temp directories, never the live host.
 * @module @linxin666/dsh-skill-manager/service
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import type { SkillDefinition, SkillSummary } from '@deepseek-ai/dsh-skill'
import { parseSkillText, setSkillEnabled } from './frontmatter.ts'
import { SkillInstaller } from './install.ts'
import { SkillLedger } from './ledger.ts'
import type { InstallDestination } from './roots.ts'
import type { InstalledEntryWire, SkillRow } from './protocol.ts'

/** The session slice the manager reads (structural; no dsh-session value import). */
export interface SessionView {
  header: { cwd?: string }
}

/** The skill registry slice the manager calls (structural; the host adapter passes ctx.skills). */
export interface SkillsRegistryLike {
  list(options: { cwd?: string; scope?: object }): Promise<SkillSummary[]>
  get(name: string, options: { cwd?: string; scope?: object }): Promise<SkillDefinition | undefined>
}

/** One structured failure. */
export interface ManagerError {
  /** Stable machine code the routes map to HTTP statuses. */
  code: string
  /** Human-readable message (English; the UI chrome carries its own copy). */
  message: string
}

/** One operation outcome. */
export type ManagerResult<T> = { ok: true; value: T } | { ok: false; error: ManagerError }

/** Resolved lookup context for one session. */
export interface SkillLookup {
  cwd: string
  scope: object | undefined
}

/** Dependencies of the manager service. */
export interface SkillManagerDeps {
  /** Host session registry (`ctx.sessions`). */
  sessions: { get(sessionId: string): SessionView | undefined }
  /** Host agent registry (`ctx.agents`); a live agent is the viewing scope. */
  agents: { get(sessionId: string): object | undefined }
  /** The skill registry (`ctx.skills`). */
  skills: SkillsRegistryLike
  /** Installed-skill ledger. */
  ledger: SkillLedger
  /** Resolved dsh home. */
  dshHome: string
  /** Install capability. */
  installer: SkillInstaller
}

/** The skill manager service. */
export class SkillManagerService {
  /** @param deps - injected host edges. */
  constructor(private readonly deps: SkillManagerDeps) {}

  /**
   * List the catalog for one session, decorated with per-skill toggle and
   * install state.
   * @param sessionId - the viewing session.
   * @returns the decorated skill rows.
   */
  async list(sessionId: string): Promise<ManagerResult<{ skills: SkillRow[]; cwd: string; live: boolean }>> {
    const resolved = await this.lookup(sessionId)
    if (!resolved.ok) return resolved
    const { cwd, scope } = resolved.value
    let summaries: SkillSummary[]
    try {
      summaries = await this.deps.skills.list({ cwd, scope })
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `skill listing failed: ${String(error)}` } }
    }
    const skills: SkillRow[] = []
    for (const summary of summaries) {
      const definition = await this.deps.skills.get(summary.name, { cwd, scope }).catch(() => undefined)
      const path = definition?.path
      const toggleable = path !== undefined
      skills.push({
        name: summary.name,
        description: summary.description,
        ...summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse },
        source: summary.source,
        provider: summary.provider,
        ...path === undefined ? {} : { path },
        toggleable,
        installed: toggleable ? (await this.deps.ledger.find(path)) !== undefined : false,
        modelInvocable: summary.invocation.modelInvocable,
        userInvocable: summary.invocation.userInvocable,
      })
    }
    return { ok: true, value: { skills, cwd, live: scope !== undefined } }
  }

  /**
   * Enable or disable one skill by patching its SKILL.md frontmatter.
   * @param sessionId - the viewing session.
   * @param name - the skill name.
   * @param enabled - true enables both surfaces, false disables both.
   * @returns the patched path and resulting invocation controls.
   */
  async toggle(
    sessionId: string,
    name: string,
    enabled: boolean,
  ): Promise<ManagerResult<{ name: string; path: string; modelInvocable: boolean; userInvocable: boolean }>> {
    const resolved = await this.lookup(sessionId)
    if (!resolved.ok) return resolved
    const { cwd, scope } = resolved.value
    const definition = await this.deps.skills.get(name, { cwd, scope }).catch(() => undefined)
    if (definition === undefined) {
      return { ok: false, error: { code: 'unknown-skill', message: `skill "${name}" is unknown or no longer available` } }
    }
    if (definition.path === undefined) {
      return {
        ok: false,
        error: {
          code: 'not-toggleable',
          message: `skill "${name}" is provided by ${definition.provider} without an editable file; only filesystem skills can be toggled`,
        },
      }
    }
    const path = definition.path
    let text: string
    try {
      text = await readFile(path, { encoding: 'utf8' })
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `failed to read skill file: ${String(error)}` } }
    }
    if (parseSkillText(text) === undefined) {
      return { ok: false, error: { code: 'not-toggleable', message: `skill "${name}" has no parseable frontmatter` } }
    }
    const patched = setSkillEnabled(text, enabled)
    if (patched === undefined) {
      return { ok: false, error: { code: 'not-toggleable', message: `skill "${name}" frontmatter could not be patched` } }
    }
    try {
      await writeFile(path, patched, { encoding: 'utf8' })
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `failed to write skill file: ${String(error)}` } }
    }
    return { ok: true, value: { name, path, modelInvocable: enabled, userInvocable: enabled } }
  }

  /**
   * Install skills from a local directory or git repository.
   * @param sessionId - the viewing session (its cwd resolves the workspace root).
   * @param source - the install source.
   * @param destination - workspace or user level.
   * @returns the installed entries.
   */
  async install(
    sessionId: string,
    source: { kind: 'dir' | 'git'; value: string },
    destination: InstallDestination,
  ): Promise<ManagerResult<{ entries: InstalledEntryWire[] }>> {
    if (source.kind !== 'dir' && source.kind !== 'git') {
      return { ok: false, error: { code: 'invalid-source', message: 'source kind must be dir or git' } }
    }
    const resolved = await this.lookup(sessionId)
    if (!resolved.ok) return resolved
    const outcome = await this.deps.installer.install(source, destination, resolved.value.cwd)
    if (!outcome.ok) return { ok: false, error: { code: 'install-failed', message: outcome.error } }
    return { ok: true, value: { entries: outcome.entries } }
  }

  /**
   * Uninstall a manager-installed skill (ledger-guarded).
   * @param sessionId - the viewing session.
   * @param name - the skill name.
   * @returns the removed path.
   */
  async uninstall(sessionId: string, name: string): Promise<ManagerResult<{ name: string; path: string }>> {
    const resolved = await this.lookup(sessionId)
    if (!resolved.ok) return resolved
    const { cwd, scope } = resolved.value
    const definition = await this.deps.skills.get(name, { cwd, scope }).catch(() => undefined)
    if (definition === undefined || definition.path === undefined) {
      return { ok: false, error: { code: 'unknown-skill', message: `skill "${name}" is unknown or has no file` } }
    }
    const path = definition.path
    const entry = await this.deps.ledger.find(path)
    if (entry === undefined) {
      return {
        ok: false,
        error: { code: 'not-installed', message: `skill "${name}" was not installed by the skill manager; refusing to delete ${path}` },
      }
    }
    try {
      await rm(entry.path, { recursive: true, force: true })
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `failed to remove skill: ${String(error)}` } }
    }
    await this.deps.ledger.remove(entry.path)
    return { ok: true, value: { name, path: entry.path } }
  }

  private async lookup(sessionId: string): Promise<ManagerResult<SkillLookup>> {
    const session = this.deps.sessions.get(sessionId)
    if (session === undefined) {
      return { ok: false, error: { code: 'session-not-found', message: `session "${sessionId}" not found` } }
    }
    const cwd = session.header.cwd
    if (cwd === undefined) {
      return { ok: false, error: { code: 'no-cwd', message: `session "${sessionId}" has no project cwd` } }
    }
    const scope = this.deps.agents.get(sessionId)
    return { ok: true, value: { cwd, scope } }
  }
}