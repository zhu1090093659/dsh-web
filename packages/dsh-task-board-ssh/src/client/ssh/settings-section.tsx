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
 * Every control is staged by the family card's form: a pick writes when it is
 * made, typed text writes once typing pauses or the field is left. The
 * provider's own defaults live here so a card's target form opens on them.
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
  type FieldState,
} from '../settings-form.ts'
import type { SshAgentKind } from '../../core/target.ts'
import { t, type TaskBoardSshKey } from '../locales.ts'
import css from '../ssh.module.css'

/** The extension fields this section edits (the namespace's schema). */
export interface SshSettings {
  /** Master switch for the extension. */
  enabled?: boolean
  /** Execution mode a new target opens on. */
  defaultMode?: 'direct' | 'proxy'
  /** Agent CLI a new target opens on. */
  defaultAgent?: SshAgentKind
  /** How many cards may run at once on one host. */
  hostCap?: number
  /** Start template of a custom agent. */
  customCommand?: string
  /** Resume template of a custom agent. */
  customResumeCommand?: string
}

/** What the section renders. */
export interface SshSettingsCardState extends CardShell {
  /** The master switch. */
  enabled: FieldState
  /** The default execution mode. */
  defaultMode: FieldState
  /** The default agent CLI. */
  defaultAgent: FieldState
  /** The per-host running cap. */
  hostCap: FieldState
  /** The custom agent's start template. */
  customCommand: FieldState
  /** The custom agent's resume template. */
  customResumeCommand: FieldState
}

/** The registration-side face the section's slot entry injects. */
export interface SshSettingsCardFace extends CardActions {
  hooks: {
    /** Section snapshot bound by the renderer as useSshSettingsCard. */
    sshSettingsCard: SnapshotStore<SshSettingsCardState>
  }
}

/** Default and bounds of the per-host cap, matching the provider's own range. */
const HOST_CAP = { min: 1, max: 8, step: 1, fallback: 2 } as const

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
      choiceField('defaultMode', ['direct', 'proxy']),
      choiceField('defaultAgent', ['dsh', 'claude', 'codex', 'custom']),
      numberField('hostCap', { integer: true, min: HOST_CAP.min }),
      textField('customCommand'),
      textField('customResumeCommand'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SshSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      defaultMode: this.form.field('defaultMode'),
      defaultAgent: this.form.field('defaultAgent'),
      hostCap: this.form.field('hostCap'),
      customCommand: this.form.field('customCommand'),
      customResumeCommand: this.form.field('customResumeCommand'),
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

/** Display name of one agent CLI, for the default-agent choices. */
function agentOption(kind: SshAgentKind): { value: string, label: string } {
  return { value: kind, label: t(`detail.agent.${kind}`) }
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
  const custom = state.defaultAgent.text === 'custom'
  const fieldCopy = {
    overriddenLabel: label('settings.overridden'),
    resetLabel: label('settings.reset'),
    invalidLabel: label('settings.invalidValue'),
    disabled: !state.writable,
  }
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
                  { value: 'direct', label: label('detail.mode.direct') },
                  { value: 'proxy', label: label('detail.mode.proxy') },
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
                choices={[
                  agentOption('dsh'),
                  agentOption('claude'),
                  agentOption('codex'),
                  agentOption('custom'),
                ]}
                {...fieldCopy}
                {...state.defaultAgent}
                onEdit={text => props.edit('defaultAgent', text)}
                onReset={() => props.resetField('defaultAgent')}
              />
              <ValueField
                id="settings-task-board-ssh-cap"
                label={label('settings.hostCap')}
                hint={label('settings.hostCapHint')}
                numeric
                placeholder={String(HOST_CAP.fallback)}
                range={{ min: HOST_CAP.min, max: HOST_CAP.max, step: HOST_CAP.step }}
                {...fieldCopy}
                {...state.hostCap}
                onEdit={text => props.edit('hostCap', text)}
                onReset={() => props.resetField('hostCap')}
              />
              {custom && (
                <>
                  <ValueField
                    id="settings-task-board-ssh-command"
                    label={label('settings.customCommand')}
                    hint={label('settings.customCommandHint')}
                    placeholder="{prompt_file}"
                    {...fieldCopy}
                    {...state.customCommand}
                    onEdit={text => props.edit('customCommand', text)}
                    onReset={() => props.resetField('customCommand')}
                  />
                  <ValueField
                    id="settings-task-board-ssh-resume"
                    label={label('settings.customResumeCommand')}
                    hint={label('settings.customResumeCommandHint')}
                    {...fieldCopy}
                    {...state.customResumeCommand}
                    onEdit={text => props.edit('customResumeCommand', text)}
                    onReset={() => props.resetField('customResumeCommand')}
                  />
                </>
              )}
            </>
          )
        : <p className={css.sectionHint}>{label('settings.disabledNotice')}</p>}
    </PluginSettingsCard>
  )
}
