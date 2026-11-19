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
import { composeDraftPayload } from '../../core/ledger.ts'
import { t } from '../locales.ts'
import type { SshComposeSectionProps } from '../seat-props.ts'
import { draftOf, validateDraft, type SshTargetDraft } from './model.ts'
import { useHostHalfStatus, usePublishedSummary } from './summary.ts'
import { SshTargetFields } from './target-form.tsx'
import css from '../ssh.module.css'

/** Short plugin name the semantic attributes carry. */
const PLUGIN_ATTR = 'task-board-ssh'

/**
 * Render the SSH provider's new-card seat.
 * @param props - the board's draft channel.
 * @returns the picker while the host half is mounted, nothing otherwise.
 */
export function SshComposeSection({ contribute }: SshComposeSectionProps) {
  const summary = usePublishedSummary()
  const hostHalf = useHostHalfStatus()
  const [chosen, setChosen] = useState(false)
  // Only the reader's own edits live here: until the first one the draft is
  // derived from whatever the provider publishes, so a summary that arrives
  // with defaults after the first render still prefills the fields.
  const [edited, setEdited] = useState<SshTargetDraft | undefined>(undefined)
  const defaults = summary?.defaults
  const draft = useMemo(() => edited ?? draftOf(undefined, defaults), [edited, defaults])
  const validation = useMemo(() => validateDraft(draft), [draft])
  const fieldsId = `${useId()}-fields`
  const mounted = hostHalf === 'mounted'
  const live = chosen && mounted

  // Every change is the draft this card carries: a complete target is reported
  // as the payload its host half reads, and anything else withdraws the draft so
  // the board never stores a target the seat is not showing. The instant is the
  // report's own, because that is what the payload stamps.
  useEffect(() => {
    if (!live || validation.target === undefined) {
      contribute(SSH_EXTENSION_ID, undefined)
      return
    }
    const payload = composeDraftPayload(validation.target, Date.now())
    contribute(SSH_EXTENSION_ID, payload === undefined ? undefined : { ...payload })
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
            errors={validation.errors}
            hosts={summary?.hosts ?? []}
            onChange={patch => { setEdited({ ...draft, ...patch }) }}
          />
        </div>
      )}
    </div>
  )
}
