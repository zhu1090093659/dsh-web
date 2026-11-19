/**
 * This extension's own configuration: reading it live, and the single path that
 * writes it back.
 *
 * The fields are `volatile()` in the Config schema, so the Host's settings
 * surface commits a write into the running fiber without a remount and every
 * consumer here reads them at use time. That is why this module has no cache and
 * no second store: a settings write reaches the next admission, the next run and
 * the next tool call through {@link SshProviderSettings} alone.
 *
 * @module dsh-task-board-ssh/host/settings
 */
import { validateCustomTemplate, type SshCustomTemplates } from '../core/adapters/index.ts'
import { SSH_AGENT_KINDS, type SshAgentKind, type SshExecutionMode } from '../core/target.ts'
import { DEFAULT_PER_HOST_CAP, normalizePerHostCap } from './queue.ts'

/** Default agent CLI a card starts when neither the card nor the deployment pins one. */
export const DEFAULT_AGENT_KIND: SshAgentKind = 'dsh'

/** Default execution mode of a card that pins no target yet. */
export const DEFAULT_EXECUTION_MODE: SshExecutionMode = 'direct'

/** Profile entry ids this package's rows carry, most specific first. */
export const SSH_ENTRY_IDS: readonly string[] = ['web-ui-task-board-ssh', 'ui-task-board-ssh', 'dsh-task-board-ssh']

/** Host alias grammar the target parser accepts, restated for the writer. */
const HOST_ALIAS_RE = /^[A-Za-z0-9._-]{1,128}$/

/** The effective configuration of one mount. */
export interface SshProviderSettings {
  /** Master switch of the extension. */
  enabled: boolean
  /** Host a card opens with when neither the card nor the browser pins one. */
  defaultHost: string
  /** Agent CLI a card opens with. */
  defaultAgent: SshAgentKind
  /** Execution mode a card opens with. */
  defaultMode: SshExecutionMode
  /** How many runs one host executes at once; the rest wait in the queue. */
  perHostCap: number
  /** Per-agent command templates that replace the built-in command line. */
  agentCommands: Partial<Record<SshAgentKind, SshCustomTemplates>>
}

/** What a deployment that configured nothing gets. */
export const DEFAULT_SSH_SETTINGS: SshProviderSettings = {
  enabled: true,
  defaultHost: '',
  defaultAgent: DEFAULT_AGENT_KIND,
  defaultMode: DEFAULT_EXECUTION_MODE,
  perHostCap: DEFAULT_PER_HOST_CAP,
  agentCommands: {},
}

/**
 * Read one config field's live value.
 *
 * A `volatile()` field arrives as a live reference the Loader updates in place,
 * so it is unwrapped on every read instead of being captured once.
 * @param field - the field as the Loader handed it.
 * @param fallback - value when the field is absent.
 * @returns the effective value.
 */
export function readConfigField<T>(field: unknown, fallback: T): T {
  if (field === undefined || field === null) return fallback
  if (typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function') {
    return (field as { get: () => unknown }).get() as T
  }
  return field as T
}

/** Read one configured agent-command row. */
function readAgentCommandRow(row: unknown): { kind: SshAgentKind; templates: SshCustomTemplates } | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const record = row as Record<string, unknown>
  const kind = (SSH_AGENT_KINDS as readonly string[]).includes(String(record.kind))
    ? String(record.kind) as SshAgentKind
    : undefined
  const command = typeof record.command === 'string' ? record.command : ''
  const resumeCommand = typeof record.resumeCommand === 'string' ? record.resumeCommand : ''
  if (kind === undefined || command.trim() === '') return undefined
  if (validateCustomTemplate(command) !== undefined) return undefined
  if (resumeCommand.trim() !== '' && validateCustomTemplate(resumeCommand) !== undefined) return undefined
  return {
    kind,
    templates: {
      command,
      ...(resumeCommand.trim() === '' ? {} : { resumeCommand }),
    },
  }
}

/**
 * Normalize the row's own configuration.
 * @param config - the config the Loader activated this row with.
 * @returns the settings every consumer reads.
 */
export function parseSshSettings(config: unknown): SshProviderSettings {
  const source = typeof config === 'object' && config !== null ? config as Record<string, unknown> : {}
  const agent = readConfigField<unknown>(source.defaultAgent, DEFAULT_AGENT_KIND)
  const mode = readConfigField<unknown>(source.defaultMode, DEFAULT_EXECUTION_MODE)
  const host = readConfigField<unknown>(source.defaultHost, '')
  const rows = readConfigField<unknown>(source.agentCommands, [])
  const agentCommands: Partial<Record<SshAgentKind, SshCustomTemplates>> = {}
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const parsed = readAgentCommandRow(row)
      if (parsed !== undefined) agentCommands[parsed.kind] = parsed.templates
    }
  }
  return {
    enabled: readConfigField<unknown>(source.enabled, true) !== false,
    defaultHost: typeof host === 'string' && HOST_ALIAS_RE.test(host.trim()) ? host.trim() : '',
    defaultAgent: (SSH_AGENT_KINDS as readonly string[]).includes(String(agent)) ? String(agent) as SshAgentKind : DEFAULT_AGENT_KIND,
    defaultMode: mode === 'proxy' ? 'proxy' : DEFAULT_EXECUTION_MODE,
    perHostCap: normalizePerHostCap(readConfigField<unknown>(source.perHostCap, DEFAULT_PER_HOST_CAP)),
    agentCommands,
  }
}

/** One path-addressed edit the settings surface accepts. */
export type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** One entry the settings surface reports. */
export interface SettingsDescriptor {
  /** Profile entry id the form belongs to. */
  ns?: unknown
  /** Revision the form was built from. */
  revision?: unknown
}

/** The slice of the Host settings surface this extension uses. */
export interface SettingsFace {
  /** Whether the active profile accepts form edits. */
  readonly writable: boolean
  /** Read the live forms. */
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  /** Apply field edits to one entry against the revision it was read at. */
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/** A configuration write this deployment refused, in the term the caller acts on. */
export class SshSettingsError extends Error {
  /** Stable machine code the action reply and the tool carry. */
  readonly code: string

  constructor(code: string, message: string) {
    super(`task-board-ssh settings [${code}]: ${message}`)
    this.name = 'SshSettingsError'
    this.code = code
  }
}

/**
 * Read the settings surface off the injected `settings` service.
 * @param value - the service as the injected scope carries it.
 * @returns the face, or undefined when this deployment serves none.
 */
export function readSettingsFace(value: unknown): SettingsFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as { describe?: unknown; mutate?: unknown }
  if (typeof face.describe !== 'function' || typeof face.mutate !== 'function') return undefined
  return value as SettingsFace
}

/**
 * Find this extension's own entry among the settings surface's forms.
 * @param face - the settings surface.
 * @returns the entry id and its current revision, or undefined when this
 *   deployment exposes no form for this extension.
 */
export function findSshSettingsEntry(face: SettingsFace): { ns: string; revision: number } | undefined {
  let descriptors: SettingsDescriptor[]
  try {
    descriptors = face.describe({ redactSecrets: true })
  } catch {
    return undefined
  }
  for (const wanted of SSH_ENTRY_IDS) {
    const hit = descriptors.find(descriptor => descriptor.ns === wanted)
    if (hit !== undefined) {
      return { ns: wanted, revision: typeof hit.revision === 'number' ? hit.revision : 0 }
    }
  }
  return undefined
}

/** One configuration change a caller may ask for. */
export interface SshSettingsPatch {
  /** Master switch. */
  enabled?: boolean
  /** Host a card opens with. */
  defaultHost?: string
  /** Agent CLI a card opens with. */
  defaultAgent?: SshAgentKind
  /** Execution mode a card opens with. */
  defaultMode?: SshExecutionMode
  /** Concurrent runs per host. */
  perHostCap?: number
  /** Full replacement of the per-agent command overrides. */
  agentCommands?: ReadonlyArray<{ kind: SshAgentKind; command: string; resumeCommand?: string }>
}

/** What one accepted write stored. */
export interface SshSettingsWriteResult {
  /** Profile entry the write landed in. */
  entry: string
  /** Fields the write addressed, in the order they were applied. */
  fields: string[]
}

/**
 * The one write path of this extension's configuration.
 *
 * Every caller — a settings card, an action, a future host route — composes a
 * patch and hands it here; nothing else calls `settings.mutate` for this
 * extension, so there is exactly one place where a value is validated, one
 * revision it is written against, and one set of volatile fields it may name.
 */
export class SshSettingsWriter {
  private readonly face: () => SettingsFace | undefined

  constructor(face: () => SettingsFace | undefined) {
    this.face = face
  }

  /** Whether a write can be attempted at all right now. */
  available(): boolean {
    return this.face() !== undefined
  }

  /**
   * Validate one patch and write it in a single batch.
   * @param patch - the change to store.
   * @returns which entry and fields the write addressed.
   * @throws SshSettingsError when the patch is unusable or the deployment refuses.
   */
  async save(patch: SshSettingsPatch): Promise<SshSettingsWriteResult> {
    const ops: SettingsPathOp[] = []
    if (patch.enabled !== undefined) ops.push({ op: 'set', path: ['enabled'], value: patch.enabled })
    if (patch.defaultHost !== undefined) {
      const host = patch.defaultHost.trim()
      if (host !== '' && !HOST_ALIAS_RE.test(host)) {
        throw new SshSettingsError('invalid-host', 'the default host must be a dshSsh host alias of letters, digits, dots, hyphens and underscores')
      }
      ops.push({ op: 'set', path: ['defaultHost'], value: host })
    }
    if (patch.defaultAgent !== undefined) {
      if (!(SSH_AGENT_KINDS as readonly string[]).includes(patch.defaultAgent)) {
        throw new SshSettingsError('invalid-agent', `the default agent must be one of: ${SSH_AGENT_KINDS.join(', ')}`)
      }
      ops.push({ op: 'set', path: ['defaultAgent'], value: patch.defaultAgent })
    }
    if (patch.defaultMode !== undefined) {
      if (patch.defaultMode !== 'direct' && patch.defaultMode !== 'proxy') {
        throw new SshSettingsError('invalid-mode', 'the default mode must be "direct" or "proxy"')
      }
      ops.push({ op: 'set', path: ['defaultMode'], value: patch.defaultMode })
    }
    if (patch.perHostCap !== undefined) {
      if (typeof patch.perHostCap !== 'number' || !Number.isFinite(patch.perHostCap)) {
        throw new SshSettingsError('invalid-cap', 'the per-host cap must be a number')
      }
      ops.push({ op: 'set', path: ['perHostCap'], value: normalizePerHostCap(patch.perHostCap) })
    }
    if (patch.agentCommands !== undefined) {
      const rows: Array<{ kind: string; command: string; resumeCommand: string }> = []
      for (const row of patch.agentCommands) {
        if (!(SSH_AGENT_KINDS as readonly string[]).includes(row.kind)) {
          throw new SshSettingsError('invalid-agent', `a command override names an unknown agent: ${String(row.kind)}`)
        }
        const problem = validateCustomTemplate(row.command)
        if (problem !== undefined) throw new SshSettingsError('invalid-command', `the ${row.kind} command override: ${problem}`)
        const resumeCommand = row.resumeCommand?.trim() ?? ''
        if (resumeCommand !== '') {
          const resumeProblem = validateCustomTemplate(resumeCommand)
          if (resumeProblem !== undefined) throw new SshSettingsError('invalid-command', `the ${row.kind} resume override: ${resumeProblem}`)
        }
        rows.push({ kind: row.kind, command: row.command, resumeCommand })
      }
      ops.push({ op: 'set', path: ['agentCommands'], value: rows })
    }
    if (ops.length === 0) throw new SshSettingsError('empty-patch', 'the patch addresses no configuration field')
    const face = this.face()
    if (face === undefined) throw new SshSettingsError('settings-unavailable', 'this deployment serves no settings surface')
    if (face.writable === false) throw new SshSettingsError('settings-readonly', 'this deployment serves configuration read-only')
    const entry = findSshSettingsEntry(face)
    if (entry === undefined) throw new SshSettingsError('settings-entry-missing', 'this deployment exposes no settings form for the SSH extension')
    await face.mutate(entry.ns, ops, entry.revision)
    return { entry: entry.ns, fields: ops.map(op => op.path.join('.')) }
  }
}
