/**
 * Same-shape restatement of the four child seats the task board declares.
 *
 * The board owns these owner-prop shapes (`packages/dsh-task-board/src/core/extension.ts`);
 * this package may not import them as values, and `src/core/` restates that
 * protocol one-for-one, so the restatement lives beside the seats that consume
 * it. Only the props are restated: every board type they mention already has one
 * home in `src/core/`.
 *
 * @module dsh-task-board-ssh/client/seat-props
 */
import type { TaskBoardExtensionDispatch, TaskBoardExtensionPayload } from '../core/contract.ts'
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

/**
 * Owner props of the new-card seat inside the board's create dialog.
 *
 * The dialog is about to create a card, so there is nothing to read yet: the
 * seat has exactly one channel out, and it writes the draft the board stores on
 * the card it creates.
 */
export interface SshComposeSectionProps {
  /**
   * Report what this new card pins under `ssh`: one ledger payload carrying the
   * target and no run account, or undefined to leave the card untargeted so its
   * detail seat sets a target after the fact. A later call replaces the earlier
   * draft, and the board reads the last one when the dialog submits.
   */
  contribute(extensionId: string, payload: TaskBoardExtensionPayload | undefined): void
}
