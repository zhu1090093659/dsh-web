/**
 * The execution history of one card.
 *
 * A card accumulates dozens of runs, and each run carried the full acceptance
 * report inline: the same machine explanation repeated once per row buried the
 * one row a reader needed. The history therefore renders newest first, keeps
 * the five latest rows visible and puts the rest behind one disclosure that
 * opens and closes as one motion pair (the presence hook keeps the extra rows
 * mounted through the exit leg instead of pulling them out on the click's
 * tick). Each row is two lines: identity on top (status, start/end in one
 * format, the session jump) and the evidence the run produced underneath.
 *
 * Deliberately adds no new `data-dsh-part` value: the part enum belongs to the
 * cross-repository semantic-attribute contract.
 */
import { useId, useState } from 'react'
import type { ExecutionRecord } from '../../core/tasks.ts'
import { isLegacyAgentTeamsReason } from '../../core/subtask.ts'
import { isMissingWorkspaceReason } from '../../core/workspace-target.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import css from '../board.module.css'
import { IconSession } from './icons.tsx'
import { usePresence } from './overlay.tsx'
import { formatTime } from './TaskCard.tsx'
import { VerificationReport } from './VerificationReport.tsx'

/** Rows shown before the history asks to be expanded. */
export const VISIBLE_EXECUTIONS = 5

/** Execution outcome → locale key, shared with the history's folded summary. */
/**
 * A recorded failure text in the reader's own language, for the refusals the
 * board itself produces and can therefore translate. Any other text is the
 * Host's own sentence and is printed verbatim.
 * @param error - the execution's recorded failure text.
 * @returns the localized refusal, or the original text.
 */
export function failureText(error: string): string {
  if (isMissingWorkspaceReason(error)) return t('exec.error.noWorkspace')
  if (isLegacyAgentTeamsReason(error)) return t('exec.error.legacyAgentTeams')
  return error
}

export const EXECUTION_RESULT_KEY: Record<NonNullable<ExecutionRecord['result']>, TaskBoardKey> = {
  succeeded: 'detail.result.succeeded',
  failed: 'detail.result.failed',
  cancelled: 'detail.result.cancelled',
}

/** One execution-history row: identity on the head line, evidence below it. */
function ExecutionRow({ execution, timeZone, onOpen }: {
  execution: ExecutionRecord
  timeZone?: string
  onOpen: (sessionId: string) => void
}) {
  const result = execution.result
  // An external record is one the Host never observed running: no session, no
  // spinner, and a named outside agent instead of the initiating session. The
  // data attribute keeps the distinction machine-readable too.
  const external = execution.external === true
  return (
    <li
      className={css.executionRow}
      data-result={result}
      data-execution-id={execution.id}
      data-external={external ? 'true' : undefined}
    >
      <div className={css.executionRowHead}>
        <span className={css.executionBadge} data-result={result}>
          {result === undefined ? t('detail.result.running') : t(EXECUTION_RESULT_KEY[result])}
        </span>
        <span className={css.executionTimes}>
          {t('detail.executionStarted')} {formatTime(execution.startedAt, timeZone)}
          {execution.endedAt !== undefined && ` · ${t('detail.executionEnded')} ${formatTime(execution.endedAt, timeZone)}`}
        </span>
        {execution.sessionId !== undefined && (
          <button
            type="button"
            className={css.executionSession}
            onClick={() => { onOpen(execution.sessionId as string) }}
            title={execution.sessionId}
          >
            {t('detail.viewSession')}
            <IconSession size={13} />
          </button>
        )}
      </div>
      <div className={css.executionRowEvidence}>
        {external && execution.initiatedBy !== undefined && (
          <span className={css.executionTimes} title={execution.initiatedBy}>
            {t('detail.execution.external', { agent: execution.initiatedBy })}
          </span>
        )}
        {!external && execution.initiatedBy !== undefined && (
          <span className={css.executionTimes} title={execution.initiatedBy}>
            {t('detail.execution.initiator', { session: execution.initiatedBy })}
          </span>
        )}
        {execution.verification !== undefined && <VerificationReport verification={execution.verification} />}
        {execution.error !== undefined && execution.error !== '' && (
          <span className={css.executionError}>
            {failureText(execution.error)}
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * Render one card's execution history.
 * @param props - the card's executions, its time zone and the session jump.
 * @returns the newest rows, the disclosure for the rest, and nothing else.
 */
export function ExecutionLog({ executions, timeZone, onOpenSession }: {
  executions: readonly ExecutionRecord[]
  timeZone?: string
  onOpenSession: (sessionId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const presence = usePresence(expanded)
  const logId = useId()
  // Newest first: the row a reader wants is the run that just settled.
  const recent = [...executions].reverse()
  const visible = recent.slice(0, VISIBLE_EXECUTIONS)
  const older = recent.slice(VISIBLE_EXECUTIONS)
  const row = (execution: ExecutionRecord) => (
    <ExecutionRow key={execution.id} execution={execution} timeZone={timeZone} onOpen={onOpenSession} />
  )
  return (
    <div className={css.executionLog} id={logId}>
      <ul className={css.executionList}>{visible.map(row)}</ul>
      {older.length > 0 && presence.mounted && (
        <div className={css.executionExtra} data-execution-fold={presence.phase}>
          <ul className={css.executionList}>{older.map(row)}</ul>
        </div>
      )}
      {older.length > 0 && (
        <button
          type="button"
          className={`${css.linkButton} ${css.executionDisclosure}`}
          aria-expanded={expanded}
          aria-controls={logId}
          onClick={() => { setExpanded(!expanded) }}
        >
          {expanded
            ? t('detail.collapse')
            : t('detail.execution.showAll', { count: String(recent.length) })}
          <span className={css.disclosureChevron} data-open={expanded} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
