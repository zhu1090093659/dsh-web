/**
 * The team configuration block inside the board's own settings card.
 *
 * It renders what the Host published (hub URL, team id, hostname, whether a Host
 * Token is configured, the live connection state and which optional board
 * capabilities this deployment really serves) and it writes through the board's
 * same-origin action channel, which is the only channel a provider has. A token
 * value travels exactly once, from this input to the Host, and is never read
 * back: the field always renders empty and the status line says whether one is
 * stored.
 *
 * The block is one nested settings card of the board's topic list, exactly like
 * the sibling provider sections: the family card chrome supplies the border, the
 * header, the body insets and the hairline between rows, so this module owns only
 * the rows themselves. Its rows use the shared field grid (label and hint on the
 * left, the control at the trailing edge) instead of a hand-rolled flex row, so a
 * label is never squeezed into a character-per-line column by the control beside
 * it.
 *
 * The block stays reachable while the extension is switched off, because it is
 * where the switch is turned back on; it only reports that fact instead of
 * pretending the forms still apply.
 *
 * @module dsh-task-board-team/client/team/settings
 */
import { useState, type ReactElement } from 'react'
import type { CardShell } from '../settings-form.ts'
import { PluginSettingsCard } from '../PluginSettingsCard.tsx'
import card from '../settings-card.module.css'
import type { TaskBoardExtensionDispatch, TaskBoardSettingsSectionProps } from '../../core/contract.ts'
import { TEAM_EXTENSION_ID } from '../../core/identity.ts'
import type { TeamExtensionSummary } from '../../host/service.ts'
import { t, type TeamKey } from '../locales.ts'
import { useTeamSummary } from './summary.ts'
import styles from './team.module.css'

/** What the published summary carries about the configuration itself. */
interface PublishedConfiguration {
  hubUrl?: string
  teamId?: string
  hostname?: string
  tokenConfigured?: boolean
  questionWaitMinutes?: number
}

/**
 * The card state this block reports: the chrome asks for the family shape, and
 * this block answers every field immediately through its own action channel, so
 * there is never a pending draft or an invalid one.
 * @param failed - whether the last write was refused.
 * @returns the shell the card renders.
 */
function shellOf(failed: boolean): CardShell {
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed,
  }
}

/**
 * Read the configuration half of one summary.
 * @param summary - the published summary, or undefined.
 * @returns the configuration fields the card renders.
 */
export function readConfiguration(summary: TeamExtensionSummary | undefined): PublishedConfiguration {
  const configuration = summary?.configuration
  if (configuration === undefined) return {}
  return {
    ...(configuration.hubUrl === undefined ? {} : { hubUrl: configuration.hubUrl }),
    ...(configuration.teamId === undefined ? {} : { teamId: configuration.teamId }),
    ...(configuration.hostname === undefined ? {} : { hostname: configuration.hostname }),
    ...(configuration.tokenConfigured === undefined ? {} : { tokenConfigured: configuration.tokenConfigured }),
    ...(configuration.questionWaitMinutes === undefined ? {} : { questionWaitMinutes: configuration.questionWaitMinutes }),
  }
}

/**
 * Dispatch one action of this extension.
 * @param dispatch - the board's action dispatcher.
 * @param action - provider-owned action name.
 * @param payload - opaque payload.
 * @returns whether the board accepted the action.
 */
async function send(
  dispatch: TaskBoardExtensionDispatch,
  action: string,
  payload?: Record<string, unknown>,
): Promise<boolean> {
  try {
    return await dispatch({
      extensionId: TEAM_EXTENSION_ID,
      action,
      ...(payload === undefined ? {} : { payload }),
    })
  } catch {
    return false
  }
}

/** A label with its control at the row's trailing edge. */
function ValueRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className={card.field}>
      <span className={card.head}><span className={card.label}>{label}</span></span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}

/** A label with a text input: the hint sits under the label, the field at the trailing edge. */
function TextRow(props: {
  id: string
  label: string
  hint?: string
  value: string
  placeholder?: string
  numeric?: boolean
  onEdit: (next: string) => void
}): ReactElement {
  return (
    <div className={card.field}>
      <span className={card.head}>
        <label className={card.label} htmlFor={props.id}>{props.label}</label>
      </span>
      {props.hint === undefined ? null : <p className={card.hint}>{props.hint}</p>}
      <input
        id={props.id}
        className={card.input}
        {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        {...(props.numeric === true ? { inputMode: 'numeric' as const } : {})}
        value={props.value}
        onChange={event => { props.onEdit(event.target.value) }}
      />
    </div>
  )
}

/**
 * One capability line of the settings block: the name, whether this deployment
 * serves it, and what a reader can do when it does not.
 */
function Capability({ label, available, missing }: { label: string; available: boolean; missing: string }): ReactElement {
  return (
    <div className={card.field} data-dsh-part="team-capability">
      <span className={card.head}><span className={card.label}>{label}</span></span>
      {available ? null : <p className={card.hint}>{missing}</p>}
      <span className={styles.value}>
        {available ? t('section.capability.available') : t('section.capability.missing')}
      </span>
    </div>
  )
}

/**
 * The body of the settings card: the configuration form and what the Host
 * reports about it. It is its own component so the card can own the disclosure
 * and the write report while this half owns the drafts.
 * @param props - the board's action dispatcher, plus the write report the card
 *   renders in its footer.
 * @returns the card body.
 */
export function TeamSettingsBody({ dispatch, onSaved }: {
  dispatch: TaskBoardSettingsSectionProps['dispatch']
  onSaved: (accepted: boolean) => void
}): ReactElement {
  const summary = useTeamSummary()
  const configuration = readConfiguration(summary)
  const [hubUrl, setHubUrl] = useState<string | undefined>(undefined)
  const [teamId, setTeamId] = useState<string | undefined>(undefined)
  const [members, setMembers] = useState<string | undefined>(undefined)
  const [waitMinutes, setWaitMinutes] = useState<string | undefined>(undefined)
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState<boolean | undefined>(undefined)

  const connection = summary?.connection.state ?? 'idle'
  const membersValue = members ?? (summary?.agents ?? []).map(agent => agent.memberId).join(', ')
  const stateKey = ('section.connection.' + connection) as TeamKey

  const saveSettings = async (): Promise<void> => {
    const bindings = (membersValue ?? '')
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry !== '')
      .map(memberId => ({ memberId }))
    const ok = await send(dispatch, 'setup-save', {
      ...(hubUrl === undefined ? {} : { hubUrl }),
      ...(teamId === undefined ? {} : { teamId }),
      agents: bindings,
      questionWaitMinutes: Number.parseInt(waitMinutes ?? String(configuration.questionWaitMinutes ?? 0), 10) || 0,
    })
    setSaved(ok)
    onSaved(ok)
  }

  return (
    <div data-dsh-plugin="task-board-team" data-dsh-part="team-settings">
      <ValueRow label={t('section.connection')} value={t(stateKey)} />
      {summary?.connection.hostId === undefined
        ? null
        : <ValueRow label={t('section.host')} value={summary.connection.hostId} />}
      <TextRow
        id="task-board-team-hub"
        label={t('section.hub')}
        placeholder="https://hub.example.com"
        value={hubUrl ?? configuration.hubUrl ?? ''}
        onEdit={setHubUrl}
      />
      <TextRow
        id="task-board-team-team"
        label={t('section.team')}
        placeholder="team_..."
        value={teamId ?? configuration.teamId ?? ''}
        onEdit={setTeamId}
      />
      <div className={card.field}>
        <span className={card.head}>
          <label className={card.label} htmlFor="task-board-team-token">{t('section.token')}</label>
          <span className={styles.status} data-dsh-part="team-token-state">
            {configuration.tokenConfigured === true ? t('section.token.configured') : t('section.token.missing')}
          </span>
        </span>
        <p className={card.hint}>{t('section.token.placeholder')}</p>
        <input
          id="task-board-team-token"
          className={card.input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('section.token.placeholderShort')}
          value={token}
          onChange={event => { setToken(event.target.value) }}
        />
      </div>
      <TextRow
        id="task-board-team-agents"
        label={t('section.agents')}
        hint={t('section.agents.hint')}
        placeholder="member_..."
        value={membersValue ?? ''}
        onEdit={setMembers}
      />
      <TextRow
        id="task-board-team-wait"
        label={t('section.questionWait')}
        hint={t('section.questionWait.hint')}
        numeric
        value={waitMinutes ?? String(configuration.questionWaitMinutes ?? 0)}
        onEdit={setWaitMinutes}
      />
      {(summary?.agents ?? []).length === 0 ? <p className={styles.empty}>{t('section.agents.empty')}</p> : null}
      <div className={styles.actions}>
        <button className={styles.primaryButton} type="button" onClick={() => { void saveSettings() }}>
          {t('section.save')}
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={token.trim() === ''}
          onClick={() => {
            void send(dispatch, 'set-token', { token }).then(ok => {
              setSaved(ok)
              if (ok) setToken('')
            })
          }}
        >
          {t('section.token.save')}
        </button>
        <button className={styles.button} type="button" onClick={() => { void send(dispatch, 'clear-token') }}>
          {t('section.token.clear')}
        </button>
        <button className={styles.button} type="button" onClick={() => { void send(dispatch, 'refresh') }}>
          {t('section.refresh')}
        </button>
      </div>
      {saved === true ? <p className={styles.saved}>{t('section.saved')}</p> : null}
      <p className={styles.groupTitle}>{t('section.capabilities')}</p>
      <Capability
        label={t('section.capability.followUp')}
        available={summary?.capabilities.followUp === true}
        missing={t('section.capability.followUpMissing')}
      />
      <Capability
        label={t('section.capability.rework')}
        available={summary?.capabilities.rework === true}
        missing={t('section.capability.reworkMissing')}
      />
      <Capability
        label={t('section.capability.run')}
        available={summary?.capabilities.run === true}
        missing={t('section.capability.runMissing')}
      />
      <Capability
        label={t('section.capability.presetPin')}
        available={summary?.presetPin === 'supported'}
        missing={t('section.capability.presetPinMissing')}
      />
      {(summary?.problems ?? []).length === 0 ? null : (
        <>
          <p className={styles.groupTitle}>{t('section.problems')}</p>
          <ul className={styles.list}>
            {(summary?.problems ?? []).map(problem => (
              <li key={problem} className={styles.entry}><span className={styles.body}>{problem}</span></li>
            ))}
          </ul>
        </>
      )}
      {summary?.connection.lastError === undefined ? null : (
        <p className={styles.error}>{summary.connection.lastError}</p>
      )}
    </div>
  )
}

/**
 * The settings block: one topic of the board's own settings card.
 *
 * Closed on arrival like the sibling provider card — the settings page opens as
 * a topic list, and this topic is one of them. The body is read only by a reader
 * who opens it, and its rows are written through the board's action channel, so
 * the card holds no staged draft: save and discard are the no-ops of an
 * always-committed form, and the footer reports a refused write.
 * @param props - the board's settings seat props.
 * @returns the block.
 */
export function TeamSettingsSection({ dispatch }: TaskBoardSettingsSectionProps): ReactElement {
  const [saved, setSaved] = useState<boolean | undefined>(undefined)
  return (
    <PluginSettingsCard
      t={t}
      titleKey="section.title"
      descriptionKey="section.description"
      // One topic inside the board's own settings card, so it takes the same
      // compact chrome its sibling provider and topic cards use.
      density="nested"
      defaultOpen={false}
      state={shellOf(saved === false)}
      onSave={() => {}}
      onDiscard={() => {}}
    >
      <TeamSettingsBody dispatch={dispatch} onSaved={setSaved} />
    </PluginSettingsCard>
  )
}
