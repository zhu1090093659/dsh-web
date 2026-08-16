/**
 * Wire contract between the host half (routes.ts) and the browser half
 * (client/api.ts). Pure types plus path literals — imported by both halves,
 * bundled into each, no runtime identity to share.
 * @module @linxin666/dsh-skill-manager/protocol
 */

/** One skill row the settings page renders. */
export interface SkillRow {
  /** Kebab-case skill identifier. */
  name: string
  /** Short routing description. */
  description: string
  /** Optional extra routing guidance. */
  whenToUse?: string
  /** Discovery source bucket (project-dsh / user-agents / bundled / ...). */
  source: string
  /** Provider that owns the skill body. */
  provider: string
  /** Absolute skill file path when the skill is filesystem-sourced. */
  path?: string
  /** Whether the skill can be toggled (has an editable file). */
  toggleable: boolean
  /** Whether the manager installed this skill (uninstallable). */
  installed: boolean
  /** Whether the model-facing catalog includes the skill. */
  modelInvocable: boolean
  /** Whether the user slash surface includes the skill. */
  userInvocable: boolean
}

/** skill.list request payload. */
export interface ListRequest {
  /** Session whose cwd and scope select the catalog. */
  sessionId: string
}

/** skill.list response value. */
export interface ListResponse {
  /** The resolved skill rows in catalog order. */
  skills: SkillRow[]
  /** The session's working directory (display context). */
  cwd: string
  /** Whether a live agent provided the viewing scope. */
  live: boolean
}

/** skill.toggle request payload. */
export interface ToggleRequest {
  sessionId: string
  /** Skill name to enable or disable. */
  name: string
  /** True enables both surfaces; false disables both. */
  enabled: boolean
}

/** skill.toggle response value. */
export interface ToggleResponse {
  ok: true
  name: string
  /** The patched skill file path. */
  path: string
  modelInvocable: boolean
  userInvocable: boolean
}

/** Install source wire shape. */
export interface InstallSourceWire {
  kind: 'dir' | 'git'
  /** Local directory path, or git repository URL for kind git. */
  value: string
}

/** skill.install request payload. */
export interface InstallRequest {
  sessionId: string
  source: InstallSourceWire
  /** `workspace` installs into <projectRoot>/.agents/skills; `user` into <dshHome>/skills. */
  destination: 'workspace' | 'user'
}

/** One installed entry. */
export interface InstalledEntryWire {
  name: string
  kind: 'dir' | 'file'
  path: string
}

/** skill.install response value. */
export interface InstallResponse {
  ok: true
  entries: InstalledEntryWire[]
}

/** skill.uninstall request payload. */
export interface UninstallRequest {
  sessionId: string
  /** Skill name to uninstall (must be ledger-recorded). */
  name: string
}

/** skill.uninstall response value. */
export interface UninstallResponse {
  ok: true
  name: string
  path: string
}

/** JSON error body used by every route. */
export interface ApiErrorBody {
  error: string
  /** Stable machine code surfaced to the UI. */
  code?: string
}

/** Route paths the client calls (shared literals). */
export const API_BASE = '/api/dsh-skill-manager' as const

export const API = {
  list: API_BASE + '/list',
  toggle: API_BASE + '/toggle',
  install: API_BASE + '/install',
  uninstall: API_BASE + '/uninstall',
} as const
