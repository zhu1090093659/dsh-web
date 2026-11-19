/**
 * What this package adds to the frozen workspace-strategy interface.
 *
 * `src/core/workspace.ts` is the seam both halves were written against and it
 * stays frozen: a strategy returns the directory the agent runs in, and the
 * collection either carries a branch or does not. The one fact the card has to
 * explain is how many local files the run did not receive, so the strategies
 * here return a preparation that may carry that note, and the factory hands
 * back a strategy narrowed to it. The narrowing is assignable to the frozen
 * interface, so an engine written against `SshWorkspaceStrategy` accepts it
 * unchanged.
 *
 * @module dsh-task-board-ssh/host/workspace/types
 */
import type {
  SshWorkspacePreparation,
  SshWorkspaceRun,
  SshWorkspaceStrategy,
} from '../../core/workspace.ts'

/** What preparing a run produced, with the note this package adds to it. */
export interface SshWorkspacePreparationNote extends SshWorkspacePreparation {
  /**
   * Untracked files the run did not receive, because a bundle carries commits
   * and not the untracked working tree. Absent for a strategy that never looks
   * at a local repository, so `0` always means "counted, none".
   */
  untrackedFiles?: number
}

/** The strategy this package's factory builds: the frozen interface, sourced. */
export interface SshWorkspaceStrategyWithNote extends SshWorkspaceStrategy {
  prepare(run: SshWorkspaceRun): Promise<SshWorkspacePreparationNote>
}
