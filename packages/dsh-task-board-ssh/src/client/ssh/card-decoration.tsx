/**
 * The card-decoration seat: one chip that says where the card runs and how the
 * run stands.
 *
 * It is a pure function of the card's ledger payload — no request, no timer, no
 * subscription — because the board renders it on every card of every column on
 * every mirror frame, and a provider's badge may not become the board's cost.
 * An untargeted card renders nothing at all, so the chip always means "this card
 * is pinned somewhere".
 *
 * @module dsh-task-board-ssh/client/ssh/card-decoration
 */
import type { SshCardDecorationProps } from '../seat-props.ts'
import { sshCardView, type SshCardPhase } from './model.ts'
import { t, type TaskBoardSshKey } from '../locales.ts'
import css from '../ssh.module.css'

/** Short plugin name the semantic attributes carry. */
const PLUGIN_ATTR = 'task-board-ssh'

/** Copy key naming one phase; the detail section's pill reads the same table. */
export function phaseKey(phase: SshCardPhase): TaskBoardSshKey {
  return `run.${phase}`
}

/**
 * Render the card badge.
 * @param props - the card being decorated.
 * @returns the chip, or nothing when the card pins no target.
 */
export function SshCardDecoration({ task }: SshCardDecorationProps) {
  const view = sshCardView(task)
  const target = view.target
  if (target === undefined) return null
  const state = t(phaseKey(view.phase))
  return (
    <span
      className={css.badge}
      data-dsh-plugin={PLUGIN_ATTR}
      data-dsh-part="badge"
      data-run={view.phase}
      title={t('card.badgeTitle', { host: target.host, state })}
    >
      <span className={css.badgeDot} aria-hidden="true" />
      {state}
    </span>
  )
}
