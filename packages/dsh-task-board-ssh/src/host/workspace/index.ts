/**
 * The workspace strategies behind one factory.
 *
 * `in-place` and `git` are the two mechanisms the proposal settled; the git
 * mechanism splits by where its repository comes from, because only the
 * workspace source needs a local repository and only it brings a branch back
 * into one. The split happens here and nowhere else, so the run engine holds
 * one strategy per pinned target and never a condition of its own.
 *
 * The source is read from the target, not from the run: a run's `source` field
 * repeats what the card pinned, and one authority for "which repository is this
 * run about" is what keeps `prepare` and `collect` from ever disagreeing.
 *
 * @module dsh-task-board-ssh/host/workspace
 */
import type { SshWorkspaceTarget } from '../../core/target.ts'
import { GitUrlWorkspaceStrategy, GitWorkspaceSourceStrategy } from './git.ts'
import { InPlaceWorkspaceStrategy } from './in-place.ts'
import type { SshWorkspaceStrategyWithNote } from './types.ts'

/**
 * Build the strategy one pinned target names.
 *
 * @param target - filesystem mechanism the card pins, with its source.
 * @returns the strategy for that mechanism; assignable to the frozen
 * `SshWorkspaceStrategy`, and narrowed to a preparation that carries the
 * untracked-file note.
 */
export function createSshWorkspaceStrategy(target: SshWorkspaceTarget): SshWorkspaceStrategyWithNote {
  if (target.kind === 'in-place') return new InPlaceWorkspaceStrategy(target.path)
  return target.source.kind === 'url'
    ? new GitUrlWorkspaceStrategy(target.source)
    : new GitWorkspaceSourceStrategy(target.source)
}

export type { SshWorkspacePreparationNote, SshWorkspaceStrategyWithNote } from './types.ts'
export { SshWorkspaceError } from './errors.ts'
