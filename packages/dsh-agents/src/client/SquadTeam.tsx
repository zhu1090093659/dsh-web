/**
 * "What is this squad doing now": the Lead of the newest whole-squad run and the
 * teammates it has started so far.
 *
 * The roster is the Host's own subagent catalog (through `team-source.ts`): every
 * direct child of the Lead session, with the mode it was started under and, when
 * the store reports it, whether it is running. This file only joins that catalog
 * with the squad's definitions and renders it. The join key is the LABEL the Lead
 * passed to the subagent tool, which the squad context tells it to set to the
 * member name; a teammate started under another label keeps its row and reads its
 * pins as inherited.
 *
 * Each row's session entry point is the teammate session id the catalog reports,
 * so opening a teammate needs no extra host call. The Lead row is rendered beside
 * them from the squad's own pin, because the catalog describes children only.
 */
import type { ReactNode } from 'react'
import { t } from './locales.ts'
import { permissionLabel } from './permissions.ts'
import { SessionRow } from './SessionRow.tsx'
import type { SessionRowFact } from './SessionRow.tsx'
import type { StatusTone } from './runs.ts'
import type { TeamDefinition, MemberDefinition } from '../protocol.ts'
import type { SquadTeammateRow, SquadTeamSnapshot } from './team-source.ts'
import css from './agents.module.css'

/** The label and tone one teammate row reads as. */
interface RowStatus {
  label: string
  tone: StatusTone
}

const MODE_KEY = {
  'one-shot': 'squad.mode.oneShot',
  'continuable': 'squad.mode.continuable',
  'external': 'squad.mode.external',
  'unknown': 'squad.mode.unknown',
} as const

/**
 * Read one row's status: the Host's activity when it reports one, else the mode
 * the child was started under. A teammate whose session is running is stated as
 * running; a session the store says nothing about is stated by how it was started.
 * @param row - the catalog row.
 * @returns the label and tone to render.
 */
function statusOf(row: SquadTeammateRow): RowStatus {
  if (row.running === true) return { label: t('squad.status.running'), tone: 'active' }
  if (row.running === false) return { label: t('squad.status.idle'), tone: 'pending' }
  return { label: t(MODE_KEY[row.mode]), tone: 'pending' }
}

/** The member definition a teammate session runs as, matched by the label the Lead was told to pass. */
function definitionFor(team: TeamDefinition, row: SquadTeammateRow): MemberDefinition | undefined {
  const key = row.label ?? row.name
  return key === undefined ? undefined : team.members.find(member => member.name === key)
}

/** A row title: the definition's name, the label the Lead passed, then the session id. */
function titleOf(row: SquadTeammateRow, definition: MemberDefinition | undefined): string {
  return definition?.name ?? row.label ?? row.name ?? row.id.slice(0, 8)
}

/** The pinned facts of one row; an unpinned value reads as inherited, never blank. */
function factsOf(preset: string | undefined, permission: MemberDefinition['permission'], model: string | undefined): SessionRowFact[] {
  return [
    { label: t('member.preset'), value: preset === undefined || preset === '' ? t('member.inherit') : preset },
    { label: t('member.permission'), value: permissionLabel(permission) },
    { label: t('member.model'), value: model === undefined || model === '' ? t('member.inherit') : model },
  ]
}

export interface SquadTeamSectionProps {
  team: TeamDefinition
  /** The live-team snapshot; undefined while this squad never ran as a whole. */
  snapshot: SquadTeamSnapshot | undefined
  /** Switch the GUI to an existing session; absent when the deployment has none. */
  openSession?: (sessionId: string) => void
}

/**
 * Render the live roster of the newest squad run.
 * @param props - the squad, the live snapshot and the session opener.
 */
export function SquadTeamSection({ team, snapshot, openSession }: SquadTeamSectionProps): ReactNode {
  const header = <h4 className={css.membersTitle}>{t('squad.liveTitle')}</h4>
  if (snapshot === undefined) {
    return (
      <section className={css.section} data-dsh-part="squad-team" aria-label={t('squad.liveTitle')}>
        {header}
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t('squad.liveNoRun')}</p>
          <p className={css.emptyHint}>{t('squad.liveNoRunHint')}</p>
        </div>
      </section>
    )
  }
  if (snapshot.state === 'unavailable') {
    return (
      <section className={css.section} data-dsh-part="squad-team" aria-label={t('squad.liveTitle')}>
        {header}
        <p className={css.runStatus} role="status" data-dsh-part="squad-team-state">{t('squad.liveUnavailable')}</p>
      </section>
    )
  }
  if (snapshot.state === 'pending') {
    return (
      <section className={css.section} data-dsh-part="squad-team" aria-label={t('squad.liveTitle')}>
        {header}
        <p className={css.runStatus} role="status" data-dsh-part="squad-team-state">{t('squad.livePending')}</p>
      </section>
    )
  }
  const leadStatus: RowStatus = snapshot.leadRunning === undefined
    ? { label: t('squad.lead'), tone: 'active' }
    : snapshot.leadRunning
      ? { label: t('squad.status.running'), tone: 'active' }
      : { label: t('squad.status.idle'), tone: 'pending' }
  return (
    <section className={css.section} data-dsh-part="squad-team" aria-label={t('squad.liveTitle')}>
      {header}
      <ul className={css.teamGrid}>
        <li className={css.memberItem}>
          <SessionRow
            variant="lead"
            title={team.name}
            badge={t('squad.lead')}
            status={leadStatus}
            facts={factsOf(team.leadPreset, undefined, undefined)}
            onOpenSession={openSession === undefined ? undefined : () => { openSession(snapshot.leadSessionId) }}
            openLabel={t('member.openSession')}
          />
        </li>
        {snapshot.rows.map(row => {
          const definition = definitionFor(team, row)
          return (
            <li key={row.id} className={css.memberItem}>
              <SessionRow
                variant="teammate"
                title={titleOf(row, definition)}
                badge={t('squad.teammate')}
                status={statusOf(row)}
                facts={factsOf(definition?.preset, definition?.permission, definition?.model)}
                {...(row.mode === 'external' ? { openable: false } : { onOpenSession: openSession === undefined ? undefined : () => { openSession(row.id) } })}
                openLabel={t('member.openSession')}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
