/**
 * Same-shape restatement of the three child seats the task board declares.
 *
 * The board owns these owner-prop shapes (`packages/dsh-task-board/src/core/extension.ts`);
 * this package may not import them as values, and `src/core/` is the frozen
 * protocol slice of the previous delivery step, so the restatement lives beside
 * the seats that consume it. Only the props are restated: every board type they
 * mention already has one home in `src/core/`.
 *
 * @module dsh-task-board-ssh/client/seat-props
 */
import type { TaskBoardExtensionDispatch } from '../core/contract.ts'
import type { TaskRecord } from '../core/task-record.ts'

/** Owner props of the task-detail seat. */
export interface SshDetailSectionProps {
  /** The card whose detail panel is open. */
  task: TaskRecord
  /** The board's same-origin action channel; the section's only way out. */
  dispatch: TaskBoardExtensionDispatch
}

/** Owner props of the settings seat inside the board's own settings card. */
export interface SshSettingsSectionProps {
  /** The board's same-origin action channel. */
  dispatch: TaskBoardExtensionDispatch
}

/** Owner props of the card-decoration seat. */
export interface SshCardDecorationProps {
  /** The card being decorated. */
  task: TaskRecord
}
