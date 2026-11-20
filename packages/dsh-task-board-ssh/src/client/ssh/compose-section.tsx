/**
 * The create dialog's own rows: pin this new card to a remote target before it
 * exists, instead of creating it untargeted and opening its detail seat.
 *
 * The seat renders nothing at all unless the provider can actually run the card:
 * the extension's own switch is followed by the seat registration itself (the
 * board drops every seat this provider owns when the switch goes off), and the
 * host half is proved mounted by a published summary having arrived. A
 * deployment that ships `dsh-ssh` disabled therefore contributes no rows here —
 * the same judgement the detail seat makes when it says which plugin to enable,
 * minus the sentence: creating a card has nothing to do with SSH, and a dialog
 * about a card is no place to explain a missing host half.
 *
 * The default is no target at all: an unchecked switch that expands into the
 * same field set the detail seat renders, starts from the provider's published
 * defaults, and reports the draft this card will carry on every change. Invalid
 * input is never reported — the board would otherwise store a target this build
 * cannot read back — and its refusal lands under the field that carries it.
 *
 * @module dsh-task-board-ssh/client/ssh/compose-section
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { SSH_EXTENSION_ID } from '../../core/action.ts'
import { composeDraftPayload, parseSshLedgerPayload } from '../../core/ledger.ts'
import type { SshTarget } from '../../core/target.ts'
import { t } from '../locales.ts'
import type { SshComposeSectionProps } from '../seat-props.ts'
import { draftOf, targetSummaryParts, validateDraft, type SshDraftField, type SshTargetDraft } from './model.ts'
import { useHostHalfStatus, usePublishedSummary } from './summary.ts'
import { refusalText, SshTargetFields } from './target-form.tsx'
import css from '../ssh.module.css'

/** Short plugin name the semantic attributes carry. */
const PLUGIN_ATTR = 'task-board-ssh'

/** Extract a pinned SSH target from a duplicated card's integrations container. */
function initialTargetFrom(integrations: Readonly<Record<string, unknown>> | undefined): SshTarget | undefined {
  const raw = integrations?.[SSH_EXTENSION_ID]
  if (raw === undefined) return undefined
  const parsed = parseSshLedgerPayload(raw)
  return parsed.ok ? parsed.value.target : undefined
}

/**
 * Render the SSH provider's new-card seat.
 * @param props - the board's draft channel, optional duplicate source and submit counter.
 * @returns the picker while the host half is mounted, nothing otherwise.
 */
export function SshComposeSection({ contribute, initialIntegrations, submitAttempt = 0 }: SshComposeSectionProps) {
  const summary = usePublishedSummary()
  const hostHalf = useHostHalfStatus()
  const [initialTarget] = useState<SshTarget | undefined>(() => initialTargetFrom(initialIntegrations))
  const [chosen, setChosen] = useState(() => initialTarget !== undefined)
  // Only the reader's own edits live here: until the first one the draft is
  // derived from the duplicated target or whatever the provider publishes, so
  // a summary that arrives with defaults after the first render still prefills.
  const [edited, setEdited] = useState<SshTargetDraft | undefined>(() => (
    initialTarget === undefined ? undefined : draftOf(initialTarget)
  ))
  const [touched, setTouched] = useState<ReadonlySet<SshDraftField>>(() => new Set())
  const defaults = summary?.defaults
  const draft = useMemo(() => edited ?? draftOf(initialTarget, defaults), [edited, initialTarget, defaults])
  const validation = useMemo(() => validateDraft(draft), [draft])
  const fieldsId = `${useId()}-fields`
  const mounted = hostHalf === 'mounted' && summary !== undefined
  const live = chosen && mounted

  const visibleErrors = useMemo(() => {
    if (submitAttempt > 0) return validation.errors
    const filtered: typeof validation.errors = {}
    for (const [field, issue] of Object.entries(validation.errors) as Array<[SshDraftField, (typeof validation.errors)[SshDraftField]]>) {
      if (issue !== undefined && touched.has(field)) filtered[field] = issue
    }
    return filtered
  }, [validation.errors, touched, submitAttempt])

  // Report both the payload (when complete) and the summary/blocking error so
  // collapsing "Run Mode" keeps a clear preview and an incomplete target stops
  // "Create and Run" from silently falling back to local execution.
  useEffect(() => {
    if (!live) {
      contribute(SSH_EXTENSION_ID, undefined)
      return
    }
    if (validation.target === undefined) {
      const firstEntry = (Object.entries(validation.errors) as Array<[SshDraftField, (typeof validation.errors)[SshDraftField]]>)
        .find(([, issue]) => issue !== undefined)
      const blocker = firstEntry !== undefined && firstEntry[1] !== undefined
        ? refusalText(firstEntry[0], firstEntry[1])
        : t('detail.error.host')
      contribute(SSH_EXTENSION_ID, undefined, { summary: t('compose.remote'), error: blocker })
      return
    }
    const payload = composeDraftPayload(validation.target, Date.now())
    if (payload === undefined) {
      contribute(SSH_EXTENSION_ID, undefined, { summary: t('compose.remote'), error: t('detail.rejected') })
      return
    }
    const parts = targetSummaryParts(validation.target)
    const label = validation.target.mode === 'proxy'
      ? `${parts.host} · ${t('detail.mode.proxy')}`
      : `${parts.host} · ${t(`detail.agent.${parts.agent}`)}`
    contribute(SSH_EXTENSION_ID, { ...payload }, { summary: label })
  }, [live, validation, contribute])

  if (!mounted) return null

  return (
    <div className={css.compose} data-dsh-plugin={PLUGIN_ATTR} data-dsh-part="compose">
      <label className={css.composeToggle}>
        <input
          type="checkbox"
          checked={chosen}
          aria-controls={live ? fieldsId : undefined}
          onChange={event => { setChosen(event.target.checked) }}
        />
        <span>{t('compose.remote')}</span>
      </label>
      {live && (
        <div className={css.composeFields} id={fieldsId}>
          <SshTargetFields
            draft={draft}
            errors={visibleErrors}
            hosts={summary?.hosts ?? []}
            modeHint={t(draft.mode === 'direct' ? 'detail.modeHintDirect' : 'detail.modeHintProxy')}
            onTouch={field => {
              setTouched(current => {
                if (current.has(field)) return current
                const next = new Set(current)
                next.add(field)
                return next
              })
            }}
            onChange={patch => {
              setEdited({ ...draft, ...patch })
              setTouched(current => {
                const next = new Set(current)
                for (const key of Object.keys(patch)) next.add(key as SshDraftField)
                return next
              })
            }}
          />
        </div>
      )}
    </div>
  )
}
