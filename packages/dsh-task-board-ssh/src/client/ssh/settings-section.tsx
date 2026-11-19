/**
 * The provider's settings section, rendered inside the task board's own
 * settings card.
 *
 * It is the surface that turns this provider on: the board declares the
 * provider-settings seat, and this extension is a provider of that board, so its
 * configuration belongs where the board it configures is configured. The section
 * is therefore NOT gated by the extension's own switch — a section gated by the
 * switch could never turn it back on — and it reads nothing but the settings
 * namespace and the board service.
 *
 * The field names are the Host's own Config schema (`src/index.ts`): `enabled`,
 * `defaultHost`, `defaultAgent`, `defaultMode`, `perHostCap` and the
 * `agentCommands` rows. They are volatile on the Host side, so every write here
 * binds the next run without a restart, and every control is staged by the
 * family card's form: a pick writes when it is made, typed text writes once
 * typing pauses or the field is left.
 *
 * @module dsh-task-board-ssh/client/ssh/settings-section
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { BooleanField, ChoiceField, PluginSettingsCard, ValueField } from '../PluginSettingsCard.tsx'
import {
  booleanField,
  CardForm,
  choiceField,
  numberField,
  textField,
  type CardActions,
  type CardShell,
  type FieldSpec,
  type FieldState,
} from '../settings-form.ts'
import { validateCustomTemplate } from '../../core/adapters/index.ts'
import { SSH_AGENT_KINDS, type SshAgentKind, type SshExecutionMode } from '../../core/target.ts'
import { t, type TaskBoardSshKey } from '../locales.ts'
import css from '../ssh.module.css'

/** One agent whose built-in command line an operator may replace. */
export const OVERRIDE_AGENTS: readonly SshAgentKind[] = ['dsh', 'claude', 'codex']

/** One stored command override, as the Host's Config carries it. */
export interface SshAgentCommandRow {
  /** Agent the override applies to. */
  kind: SshAgentKind
  /** Start template; must reference `{prompt_file}`. */
  command: string
  /** Resume template, kept as stored when the card does not edit it. */
  resumeCommand?: string
}

/** The extension fields this section edits (the Host's Config schema). */
export interface SshSettings {
  /** Master switch for the extension. */
  enabled?: boolean
  /** Host alias a card's target form opens with. */
  defaultHost?: string
  /** Execution mode a new target opens on. */
  defaultMode?: SshExecutionMode
  /** Agent CLI a new target opens on. */
  defaultAgent?: SshAgentKind
  /** How many cards may run at once on one host. */
  perHostCap?: number
  /** Per-agent command templates that replace the built-in command line. */
  agentCommands?: SshAgentCommandRow[]
}

/** What the section renders. */
export interface SshSettingsCardState extends CardShell {
  /** The master switch. */
  enabled: FieldState
  /** The default host alias. */
  defaultHost: FieldState
  /** The default execution mode. */
  defaultMode: FieldState
  /** The default agent CLI. */
  defaultAgent: FieldState
  /** The per-host running cap. */
  perHostCap: FieldState
  /** The agent command overrides, as one JSON draft. */
  agentCommands: FieldState
}

/** The registration-side face the section's slot entry injects. */
export interface SshSettingsCardFace extends CardActions {
  hooks: {
    /** Section snapshot bound by the renderer as useSshSettingsCard. */
    sshSettingsCard: SnapshotStore<SshSettingsCardState>
  }
}

/** Bounds of the per-host cap, matching the Host's own normalization. */
const HOST_CAP = { min: 1, max: 8, step: 1, fallback: 2 } as const

/** Whether a value is a plain object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the stored override rows; anything unreadable reads as no override.
 * @param value - the stored field value.
 * @returns the rows, one per agent at most.
 */
export function readAgentRows(value: unknown): SshAgentCommandRow[] {
  if (!Array.isArray(value)) return []
  const rows: SshAgentCommandRow[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) continue
    const kind = SSH_AGENT_KINDS.find(candidate => candidate === entry.kind)
    const command = typeof entry.command === 'string' ? entry.command : ''
    if (kind === undefined || command.trim() === '') continue
    const row: SshAgentCommandRow = { kind, command }
    if (typeof entry.resumeCommand === 'string' && entry.resumeCommand.trim() !== '') row.resumeCommand = entry.resumeCommand
    rows.push(row)
  }
  return rows
}

/**
 * Read the override rows out of their JSON draft.
 * @param text - the field's draft text.
 * @returns the rows; an unreadable draft reads as no override.
 */
export function parseAgentRowsText(text: string): SshAgentCommandRow[] {
  if (text.trim() === '') return []
  try {
    return readAgentRows(JSON.parse(text))
  } catch {
    return []
  }
}

/**
 * Replace one agent's start template, keeping everything else the row stores.
 *
 * A cleared template removes the row: an override without a command means "use
 * the built-in command line", and storing an empty one would ask the Host to
 * start nothing.
 * @param text - the field's current draft text.
 * @param kind - agent the edit belongs to.
 * @param command - the new template.
 * @returns the new draft text.
 */
export function withAgentCommand(text: string, kind: SshAgentKind, command: string): string {
  const rows = parseAgentRowsText(text).filter(row => row.kind !== kind)
  if (command.trim() !== '') rows.push({ kind, command })
  const ordered = OVERRIDE_AGENTS
    .map(candidate => rows.find(row => row.kind === candidate))
    .filter((row): row is SshAgentCommandRow => row !== undefined)
  return JSON.stringify(ordered)
}

/**
 * The list field as one JSON draft, so the card's form stays the only writer.
 *
 * A draft whose template cannot start anything (it does not reference the
 * prompt file) stays unwritten and shows as an unacceptable value, which is the
 * card's own way of refusing a draft.
 */
function agentCommandsField(): FieldSpec {
  return {
    field: 'agentCommands',
    entry: 'type',
    format: value => {
      const rows = readAgentRows(value)
      return rows.length === 0 ? '' : JSON.stringify(rows)
    },
    parse: text => {
      if (text.trim() === '') return { kind: 'clear' }
      const rows = parseAgentRowsText(text)
      for (const row of rows) {
        if (validateCustomTemplate(row.command) !== undefined) return undefined
        if (row.resumeCommand !== undefined && validateCustomTemplate(row.resumeCommand) !== undefined) return undefined
      }
      return { kind: 'set', value: rows }
    },
  }
}

/** Bridges the extension's settings form onto the card's staged form. */
export class SshSettingsCardController {
  private readonly form: CardForm<SshSettings>
  private readonly store: SnapshotStore<SshSettingsCardState>

  /**
   * @param scope - the bound configuration form of the entry that owns this namespace.
   */
  constructor(scope: ConfigForm<SshSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      textField('defaultHost'),
      choiceField('defaultMode', ['direct', 'proxy']),
      choiceField('defaultAgent', [...SSH_AGENT_KINDS]),
      numberField('perHostCap', { integer: true, min: HOST_CAP.min }),
      agentCommandsField(),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SshSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      defaultHost: this.form.field('defaultHost'),
      defaultMode: this.form.field('defaultMode'),
      defaultAgent: this.form.field('defaultAgent'),
      perHostCap: this.form.field('perHostCap'),
      agentCommands: this.form.field('agentCommands'),
    }
  }

  /**
   * Build the face the section's slot registration injects.
   * @returns the section's snapshot store and its form actions.
   */
  inject(): SshSettingsCardFace {
    return { hooks: { sshSettingsCard: this.store }, ...this.form.actions() }
  }

  /** Release the card's scope subscription and bound stores. */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the board's provider-settings seat. */
export type SshSettingsSectionProps =
  PropsRuntime<'task-board.settings.section'>
  & PropsLocale<'task-board-ssh'>
  & InjectFace<SshSettingsCardFace>

/** Display name of one agent CLI. */
function agentName(kind: SshAgentKind): string {
  return t(`detail.agent.${kind}`)
}

/** Hint of one agent's command row: what its built-in command line is. */
function agentCommandHint(kind: SshAgentKind): TaskBoardSshKey {
  if (kind === 'claude') return 'settings.agentCommandHint.claude'
  if (kind === 'codex') return 'settings.agentCommandHint.codex'
  return 'settings.agentCommandHint.dsh'
}

/** Display name of one execution mode. */
function modeName(mode: SshExecutionMode): string {
  return t(mode === 'direct' ? 'detail.mode.direct' : 'detail.mode.proxy')
}

/**
 * Render the SSH provider's settings section.
 * @param props - locale copy, the section snapshot, and its form actions.
 * @returns the section.
 */
export function SshSettingsSection(props: SshSettingsSectionProps) {
  const { t: translate } = props
  const label = (key: TaskBoardSshKey): string => translate(key)
  const state = props.useSshSettingsCard((snapshot: SshSettingsCardState) => snapshot)
  const enabled = state.enabled.text !== 'false'
  const fieldCopy = {
    overriddenLabel: label('settings.overridden'),
    resetLabel: label('settings.reset'),
    invalidLabel: label('settings.invalidValue'),
    disabled: !state.writable,
  }
  const rows = parseAgentRowsText(state.agentCommands.text)
  return (
    <PluginSettingsCard
      t={translate}
      titleKey="settings.title"
      descriptionKey="settings.description"
      // One topic inside the board's own settings card: the compact chrome its
      // sibling topic cards use, closed on arrival like them.
      density="nested"
      defaultOpen={false}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-task-board-ssh-enabled"
        label={label('settings.enabled')}
        hint={label('settings.enabledHintBrief')}
        hintTitle={label('settings.enabledHint')}
        onLabel={label('settings.on')}
        offLabel={label('settings.offLabel')}
        inheritLabel={label('settings.inherit')}
        {...fieldCopy}
        {...state.enabled}
        onEdit={text => props.edit('enabled', text)}
        onReset={() => props.resetField('enabled')}
      />
      {enabled
        ? (
            <>
              <ChoiceField
                id="settings-task-board-ssh-mode"
                label={label('settings.defaultMode')}
                hint={label('settings.defaultModeHint')}
                presentation="segment"
                inheritLabel={label('settings.inherit')}
                choices={[
                  { value: 'direct', label: modeName('direct') },
                  { value: 'proxy', label: modeName('proxy') },
                ]}
                {...fieldCopy}
                {...state.defaultMode}
                onEdit={text => props.edit('defaultMode', text)}
                onReset={() => props.resetField('defaultMode')}
              />
              <ChoiceField
                id="settings-task-board-ssh-agent"
                label={label('settings.defaultAgent')}
                hint={label('settings.defaultAgentHint')}
                inheritLabel={label('settings.inherit')}
                choices={SSH_AGENT_KINDS.map(kind => ({ value: kind, label: agentName(kind) }))}
                {...fieldCopy}
                {...state.defaultAgent}
                onEdit={text => props.edit('defaultAgent', text)}
                onReset={() => props.resetField('defaultAgent')}
              />
              <ValueField
                id="settings-task-board-ssh-host"
                label={label('settings.defaultHost')}
                hint={label('settings.defaultHostHint')}
                placeholder={label('settings.defaultHostPlaceholder')}
                {...fieldCopy}
                {...state.defaultHost}
                onEdit={text => props.edit('defaultHost', text)}
                onReset={() => props.resetField('defaultHost')}
              />
              <ValueField
                id="settings-task-board-ssh-cap"
                label={label('settings.perHostCap')}
                hint={label('settings.perHostCapHint')}
                numeric
                placeholder={String(HOST_CAP.fallback)}
                range={{ min: HOST_CAP.min, max: HOST_CAP.max, step: HOST_CAP.step }}
                {...fieldCopy}
                {...state.perHostCap}
                onEdit={text => props.edit('perHostCap', text)}
                onReset={() => props.resetField('perHostCap')}
              />
              {OVERRIDE_AGENTS.map(kind => {
                const row = rows.find(entry => entry.kind === kind)
                return (
                  <ValueField
                    key={kind}
                    id={`settings-task-board-ssh-command-${kind}`}
                    label={agentName(kind)}
                    hint={label(agentCommandHint(kind))}
                    placeholder={label('settings.agentCommandPlaceholder')}
                    {...fieldCopy}
                    {...state.agentCommands}
                    text={row?.command ?? ''}
                    overridden={row !== undefined}
                    invalid={state.agentCommands.invalid && row !== undefined}
                    onEdit={text => props.edit('agentCommands', withAgentCommand(state.agentCommands.text, kind, text))}
                    onReset={() => props.edit('agentCommands', withAgentCommand(state.agentCommands.text, kind, ''))}
                  />
                )
              })}
            </>
          )
        : <p className={css.sectionHint}>{label('settings.disabledNotice')}</p>}
    </PluginSettingsCard>
  )
}
